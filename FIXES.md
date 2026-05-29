# Tier 1 Hardening — Change Log

Tier 1 ("Credibility blockers") of the [ROADMAP](./ROADMAP.md) is complete on branch `chore/tier-1-hardening`. This pass established a type-safety gate, adopted linting/formatting, strengthened CI, bumped the Node baseline to `>=20`, normalized published-package metadata across all eight workspaces, and cleaned up repo hygiene. Along the way the new gates surfaced and fixed several genuine type-safety bugs (including a broken discriminated union in `@agentiam/core`'s public `.d.ts` and unguarded null dereferences in three adapters). All changes are behavior-preserving on exercised code paths. Final verification across the monorepo: **56 tests pass across 8 workspaces, `tsc --noEmit` is clean, `biome lint` is clean on 48 files, and `biome format --check` is clean on 48 files.**

## Tooling & configuration

- Added root `tsconfig.json` with `allowJs` + `checkJs` + `strictNullChecks` + `noEmit`; `include` scope is `packages/*/src/**`.
- Added root `biome.json` (lint + format) and `.editorconfig`.
- Added root npm scripts: `typecheck`, `lint`, `format`, `format:check`, `check`, and `test:coverage`.
- Installed dev dependencies: `typescript`, `@biomejs/biome`, `@types/node`, `@types/pg`, `@types/better-sqlite3`, and peer SDK type providers (`ai`, `openai`, `@anthropic-ai/sdk`).
- **Root cause uncovered:** discriminated-union narrowing silently degraded under `strict: false`. Enabling `strictNullChecks` restored correct narrowing and surfaced 10 genuine null-safety gaps in the adapters (where `checkpoint` can be `null`).

## Type-safety fixes (bugs)

- **`packages/core/src/index.d.ts` — broken discriminated union (public API):** `guard()`'s return union had `resumedFromPayload` on only one member, so TypeScript could not narrow it; every TS consumer of `guard()` hit errors. Added `resumedFromPayload?: false` to the other members so the union narrows correctly.
- **`packages/core/src/index.d.ts` — `resume()` signature:** changed `resume(id: string, payload: any)` to `payload: unknown` (~line 209) to match the `resumePayload?: unknown` type used elsewhere in the file. `unknown` is a strict-superset tightening — any caller value remains assignable, so the public API is not narrowed and runtime is unaffected.
- **`packages/openai/src/index.js` — unguarded null dereference (TS18047):** in the `approval_required` branch (lines 88/93/94), `result.checkpoint.id` was dereferenced three times even though `guard()` types the non-executed `checkpoint` as `Checkpoint | null`. Added `const cpId = result.checkpoint ? result.checkpoint.id : "unknown"` and routed all three uses through it, mirroring the adjacent `clarification_required` branch.
- **`packages/anthropic/src/index.js` — unguarded null dereference (TS18047):** same defect in the `approval_required` branch (lines 82/87/88). Fixed identically with `const cpId = result.checkpoint ? result.checkpoint.id : "unknown"`.
- **`packages/vercel-ai/src/index.js` — unguarded null dereference (TS18047):** same defect in the `approval_required` branch (~lines 65/67). Fixed identically with `const cpId = result.checkpoint ? result.checkpoint.id : "unknown"`, used in both the `ApprovalRequiredError` throw and `formatPendingResponse`.
- **`packages/vercel-ai/src/index.js` — `tool.execute` possibly undefined (TS2722, x2):** inside the closures in `wrapGuardedTools` (~line 49) and `resumeGuardedTool` (~line 143), TS widened the optional `tool.execute` back to possibly-undefined across the closure boundary. Captured the narrowed reference (`const execute = tool.execute;`) after the existing `typeof` guard and called `execute(...)` in the closure. Behavior identical.
- **`@agentiam/sqlite` — proactive type hardening (no prior tsc errors):** DB params were untyped (implicitly `any`), which suppressed errors. Added JSDoc `@param`/`@returns`/`@typedef` across `src/audit.js`, `src/schema.js`, and `src/checkpoints.js` (typed against `better-sqlite3` `Database` and `@agentiam/core` `AuditRecord`/`Checkpoint`/`CheckpointStatus`/`CheckpointListFilters`). Added two precise JSDoc row-shape casts in `checkpoints.js` (`@type {CheckpointRow | undefined}` on `.get()`, `@type {CheckpointRow[]}` on `.all()`) because `better-sqlite3`'s `Statement<Result=unknown>` returns `unknown` once the DB is typed. These are precise casts, not `any`/`@ts-ignore` silencing.

> No `@ts-ignore`, `@ts-expect-error`, or new `any` casts were introduced anywhere. The `any -> unknown` changes are tightenings, and no `biome --unsafe` autofixes were used.

## Lint fixes

All lint and formatting work used Biome's **safe** fixes via `biome check --write`; the handful of unsafe-classified style fixes were applied by hand and are semantically inert. Formatting normalization (double quotes, arrow-param parens, line-wrapping to width 100, `organizeImports` sorting, trailing-whitespace cleanup) was applied broadly across each package's source, tests, and `package.json` with no logic changes.

Notable rule-driven fixes (beyond pure formatting):

- **`packages/core/src/index.js`** — `lint/style/noUselessElse` in the `guard()` resume path: removed the redundant `else` by de-indenting the body into a fall-through (the preceding `if` returns unconditionally, so behavior is preserved; covered by the two passing `guard resumes…` / `guard runs execute()…` tests).
- **`packages/core/src/index.d.ts`** — `lint/suspicious/noExplicitAny` resolved via the `any -> unknown` change above.
- **`packages/cli/bin/agentiam.js`** — `lint/style/useNumberNamespace` (`parseInt` -> `Number.parseInt`) and `lint/style/useNodejsImportProtocol` (`"url"` -> `"node:url"`).
- **`packages/cli/test/cli.test.js`** — `lint/style/useTemplate` (x2): replaced string concatenation with template literals.
- **`packages/langgraph/src/index.d.ts`** — 6x `lint/suspicious/noExplicitAny` resolved with real types: introduced a structural `GuardedTool` interface (`name`, `invoke(input, config)`) and used `unknown` for opaque LangGraph runtime values (`mapToolCall` params, the node fn's `state`/`config`, and the `messages: unknown[]` return).
- **`packages/pg/src/checkpoints.js`** — `lint/style/noUnusedTemplateLiteral` (`` query += `RETURNING *` `` -> `query += " RETURNING *"`; other `+=` template literals containing single-quote SQL literals were correctly left as-is) and `lint/style/noUselessElse` in the `update()` error path (converted the `} else if (...)` after an unconditional `throw` into a standalone `if`).
- **`packages/sqlite/src/checkpoints.js`** — `lint/style/noUnusedTemplateLiteral` (line 36, SELECT query -> double-quoted string) and `lint/style/noUselessElse` (line 108, `} else if` after a throwing branch -> standalone `if`).
- **`packages/vercel-ai/src/index.js`** — `lint/complexity/useOptionalChain` (line 46): the autofix was unsafe (wrapped in a JSDoc `@type` cast), so fixed by hand to `/** @type {{ toolCallId?: string } | undefined} */ (options)?.toolCallId`.

## Package metadata normalization

Brought every published package up to the `@agentiam/core` standard.

- **All packages:** `engines.node` bumped from `>=18` to `>=20`.
- **`packages/core/package.json`:** added `"agentiam"` to `keywords`. All other standard fields (`repository`, `bugs`, `homepage`, `author`, `license`, `publishConfig`, `files`) were already present and correct.
- **`packages/cli/package.json`:** added `keywords` (`agentiam, ai, agents, cli, checkpoints, audit, authorization, policy`). Other standard fields were already present.
- **`packages/langgraph/package.json`:** added `keywords` (`agentiam, ai, agents, langgraph, langchain, authorization, policy, tool-calling`). Other standard fields were already present.
- **`packages/pg/package.json`:** added `keywords` (`agentiam, ai, agents, postgres, postgresql, pg, persistence, checkpoints, audit`). Other standard fields were already present.
- **`packages/openai/package.json`:** added `repository`, `bugs`, `homepage`, `engines`, `publishConfig.access: public`, `keywords` (`agentiam, ai, agents, openai, tool-calls, function-calling, authorization, policy, guardrails`), and `files: [src, README.md]`; changed `author` from `"Vishal Gole"` to `"Agent IAM Contributors"`.
- **`packages/anthropic/package.json`:** added `repository`, `bugs`, `homepage`, `publishConfig.access: public`, `keywords` (`agentiam, ai, agents, anthropic, claude, tool-use, authorization, policy, guardrails`), and `files: [src]`; changed `author` to `"Agent IAM Contributors"`.
- **`packages/sqlite/package.json`:** added `repository`, `bugs`, `homepage`, `publishConfig.access: public`, `keywords` (`agentiam, ai, agents, sqlite, better-sqlite3, persistence, checkpoints, audit, authorization, policy`), and `files: [src]`; changed `author` to `"Agent IAM Contributors"`.
- **`packages/vercel-ai/package.json`:** added `repository`, `bugs`, `homepage`, `publishConfig.access: public`, `keywords` (`agentiam, ai, agents, vercel, vercel-ai, tool-use, authorization, policy, guardrails`), and `files: [src]`; changed `author` to `"Agent IAM Contributors"`.

> `types`/`exports.types` fields were **kept** for the packages that already ship a hand-authored `.d.ts` (`core`, `langgraph`, `pg`) and **deliberately not added** for the JSDoc-only packages (`openai`, `anthropic`, `sqlite`, `vercel-ai`) that ship no `.d.ts` — see follow-ups.

## CI & repo hygiene

- Rewrote `.github/workflows/ci.yml` into two jobs (triggers unchanged: `push` + `pull_request` on `main`):
  - **`quality`** (ubuntu-latest, node 22.x): `npm ci` then separate steps for `npm run typecheck`, `npm run lint`, and `npm run format:check`.
  - **`test`** (ubuntu-latest): node matrix bumped from `[18.x, 20.x, 22.x]` to `[20.x, 22.x, 24.x]`; runs `npm ci` then `npm test`, plus a `npm run test:coverage` step gated by `if: matrix.node-version == '22.x'`.
- Added a YAML comment noting `@agentiam/pg` tests run against `pg-mem` (in-memory) today, with a real-Postgres `services:` integration job flagged as a Tier 3 follow-up.
- Ran `biome format --write .` from the repo root: 48 files formatted, 2 root files fixed (`package.json` and `tsconfig.json` — both pure whitespace, no source logic touched). `examples/` and `tmp/` are ignored by `biome.json`.
- **Committed artifact (`examples/sqlite-terminal/agentiam-demo.db`):** verified it is **not** tracked by git (`git ls-files` empty; not in `HEAD`; already matched by `.gitignore:7:*.db`). The roadmap's premise that it was committed did not match the actual repo state — no `git rm --cached` was needed; it is already untracked and ignored. `.gitignore` already contained `*.db`, so no change was required.

## Latent bugs surfaced

The `strictNullChecks` gate surfaced a real, runtime-reachable defect duplicated across three adapters:

- **`packages/openai/src/index.js`, `packages/anthropic/src/index.js`, `packages/vercel-ai/src/index.js` — `runGuardedTools()` `approval_required` branch:** `result.checkpoint.id` was dereferenced unconditionally even though `@agentiam/core` types the non-executed result as `checkpoint: Checkpoint | null`. If `guard()` ever returned `approval_required` with `checkpoint === null` (e.g. when checkpoint creation is disabled or fails), this threw `TypeError: Cannot read properties of null (reading 'id')` at runtime — masking the real approval-required outcome. Fixed minimally by falling back to the string `"unknown"`, matching the existing `clarification_required` branch. Not caught by existing tests because the test policy always creates a checkpoint, so the happy path is unaffected. (Listed here in addition to "Type-safety fixes" because the type error corresponded to a genuine runtime crash.)

No other latent runtime bugs were found. Null-safety in `core`, `pg`, and `langgraph` is already well-guarded, and a prior commit (`09da1d6`) had already fixed the real SQLite audit-sink UPSERT constraint bug.

## Deferred to later tiers (follow-ups)

- **Emit `.d.ts` for the JSDoc-only adapters** (`@agentiam/openai`, `@agentiam/anthropic`, `@agentiam/sqlite`, `@agentiam/vercel-ai`): they ship JSDoc but no declaration files, so no `types`/`exports.types` field was added and consumers currently get no type declarations. Add a build step (e.g. `tsc --emitDeclarationOnly`) and then the `types` field, consistent with how `@agentiam/core` ships `./src/index.d.ts`.
- **Emit `.d.ts` for `@agentiam/cli`**: ships plain JS with no `.d.ts` and no JSDoc-emitted declarations; consumers get no type declarations.
- **`packages/cli/src/` is empty** (zero files) yet `src` is listed in `files`. Either populate `src/` or drop it from `files` to avoid publishing an empty/absent directory entry.
- **Resume-with-payload wiring (`@agentiam/vercel-ai`):** `resumeGuardedTool` previously accepted a `resumePayload` argument that `core.guard()` silently ignores (core reads the payload from the stored checkpoint, not from guard options). The dead parameter was removed; properly wiring resume-with-payload is a Tier 2 follow-up.
- **Real-Postgres CI integration job:** `@agentiam/pg` tests run against `pg-mem` in CI; a job with a Postgres `services:` container (Tier 3 / roadmap 1.3 & 3) would exercise the headline concurrency guarantee against a live database.
- **Test directories are not type-checked:** the root `tsconfig` `include` scope is `packages/*/src/**`, so `packages/*/test/**` is linted/formatted by Biome but not type-checked by `tsc`. This matches the configured scope; expanding it is optional future work.
- **`@agentiam/anthropic`:** `resumeGuardedTool()` is exported from `src/index.js` but not listed in the named export block and is not covered by tests — flagged as informational; left untouched to avoid a public-API change.
- **Workspace package versions are mixed** (e.g. `@agentiam/sqlite@0.1.2`, `@agentiam/vercel-ai@0.1.2`); version normalization was out of scope for Tier 1.
