# Agent IAM — Hardening Roadmap

> Goal: take Agent IAM from a well-architected early-stage project to a
> professional, enterprise-grade open-source security library.
>
> This roadmap is organized into priority tiers. Tier 1 unblocks everything
> else (types + lint + CI gates make every later change safer), so do it first.
> Each item lists **what**, **why**, **where**, and **acceptance criteria** so it
> can be lifted directly into a GitHub issue.

## Current state (baseline assessment)

**Strong foundations already in place:**
- Clear product boundary and mental model (`IMPLEMENTATION_SPEC.md`).
- Clean monorepo: thin `@agentiam/core` + pluggable framework and persistence adapters.
- Correct fail-closed concurrency design — atomic "consume-only-if-approved"
  claim logic in `packages/pg/src/checkpoints.js`.
- Tests exist and pass; CI runs a Node version matrix.
- LICENSE, SECURITY.md, CONTRIBUTING.md, CHANGELOG.md present.

This is a *harden and professionalize* effort, not a re-architecture.

---

## Tier 1 — Credibility blockers

> Status: completed on branch `chore/tier-1-hardening`. See FIXES.md for the full change log.

What an enterprise evaluator or senior OSS maintainer notices in the first 10 minutes.

### 1.1 Establish type safety (no drifting hand-written `.d.ts`) — ✅ Done
- **Why:** `core` ships a 200-line hand-maintained `packages/core/src/index.d.ts`
  next to plain JS; the `openai`, `anthropic`, `sqlite`, and `vercel-ai` adapters
  ship **no types at all**. Nothing verifies types match the implementation —
  unacceptable for a security library.
- **Where:** `packages/*/src`, `packages/*/package.json` (`types` field).
- **Action:** Either (a) migrate to TypeScript with `tsc`-emitted declarations, or
  (b) keep JS but add `// @ts-check` + a `tsc --checkJs --noEmit` gate so the
  `.d.ts` is enforced against the JS. Ship `.d.ts` for every published package.
- **Acceptance:** `npm run typecheck` passes across all packages in CI; every
  published package resolves types in a consuming TS project.

### 1.2 Add linting & formatting — ✅ Done
- **Why:** No ESLint/Biome/Prettier/editorconfig. Style already diverges
  (`core` uses double quotes; `packages/pg/src/checkpoints.js` uses single quotes).
- **Action:** Adopt Biome (single fast tool) or ESLint + Prettier. Add `.editorconfig`.
- **Acceptance:** `npm run lint` and `npm run format:check` pass in CI; pre-existing
  files reformatted in one dedicated commit.

### 1.3 Strengthen CI — ✅ Done
- **Why:** `.github/workflows/ci.yml` only runs `npm test`. It does not lint,
  typecheck, measure coverage, or test against a real database — so the headline
  `pg` concurrency guarantee is not meaningfully exercised in CI.
- **Where:** `.github/workflows/ci.yml`.
- **Action:** Add jobs/steps for `lint`, `typecheck`, coverage
  (`node --test --experimental-test-coverage` with a threshold), and a Postgres
  `services:` container so `packages/pg` integration tests run for real.
- **Acceptance:** CI fails on lint/type/coverage regressions; pg tests run against
  a live Postgres in CI.

### 1.4 Bump Node baseline — ✅ Done
- **Why:** Matrix tests `[18, 20, 22]` and `engines: >=18`; Node 18 is EOL.
- **Action:** Set `engines.node` to `>=20`; matrix `[20, 22, 24]`.
- **Acceptance:** All packages declare `>=20`; CI matrix updated.

### 1.5 Remove committed artifacts — ✅ Done
- **Why:** `examples/sqlite-terminal/agentiam-demo.db` is a binary DB in git.
- **Action:** `git rm --cached` it and add a `.gitignore` rule (root already
  ignores `*.db`, but the file was committed before that rule).
- **Acceptance:** No binary DBs tracked in git.

### 1.6 Normalize published-package metadata — ✅ Done
- **Why:** `core` has full `repository`/`bugs`/`homepage`/`files`/`engines`/
  `keywords`/`publishConfig`; the adapters have almost none. Inconsistent metadata
  looks unprofessional on npmjs.com and undermines provenance.
- **Where:** every `packages/*/package.json`.
- **Action:** Bring all package.json files to the `core` standard.
- **Acceptance:** Every published package has consistent, complete metadata.

---

## Tier 2 — Correctness & security hardening

This is a security tool; these affect runtime behavior.

### 2.1 Fix the in-memory audit log (unbounded + O(n))
- **Why:** In `packages/core/src/index.js`, `auditLog` is an array that grows
  forever in-process; `markOutcome`/state transitions do a linear `.find()` on
  every operation. Memory leak + degradation in long-running services. It is also
  retained even when an external `auditSink` is configured — two sources of truth.
- **Action:** Make the audit path sink-first; the in-memory array becomes an
  optional in-memory sink. Key lookups by `Map` instead of array scan.
- **Acceptance:** No unbounded growth with an external sink configured; transition
  lookups are O(1); behavior covered by tests.

### 2.2 Make "internal email" domains configurable (no hardcoded fail-open)
- **Why:** `isExternalEmail` in `packages/core/src/index.js` hardcodes
  `company.com`/`example.com` as internal — a placeholder that will misclassify
  real deployments and silently fail open.
- **Action:** Accept an internal-domain allowlist via config; default to fail-safe
  (treat unknown as external).
- **Acceptance:** Domain set is configurable; default does not treat real domains
  as internal; covered by tests.

### 2.3 Harden request-integrity check on resume
- **Why:** A hand-rolled `deepEqual` in `packages/core/src/index.js` decides whether
  a resumed request matches the original checkpoint — a security-relevant tamper
  check with edge cases (key ordering, `undefined` vs missing, Dates, prototype
  pollution).
- **Action:** Store a canonical-serialization hash on the checkpoint at creation;
  compare hashes on resume.
- **Acceptance:** Tamper attempts (reordered keys, added/removed fields, type
  changes) are reliably detected; covered by tests.

### 2.4 Cache compiled wildcard patterns
- **Why:** `wildcardMatch` builds a new `RegExp` on every rule match on the hot path.
- **Action:** Precompile patterns at policy-normalization time.
- **Acceptance:** No per-evaluation regex compilation; benchmark shows improvement.

### 2.5 Machine-readable failure codes from `guard()`
- **Why:** `guard()` returns human-readable `reason` strings consumers must
  regex-match (e.g. "Execution skipped because…").
- **Action:** Add a stable error-code enum / discriminated union alongside (or
  replacing) the prose `reason`.
- **Acceptance:** Consumers can branch on stable codes; types updated; documented.

### 2.6 Approver authorization (at least documented)
- **Why:** `checkpoints.approve(id, { approver })` records *who* approved but does
  not authorize that they may — anyone with a checkpoint ID can approve.
- **Action:** Document as out-of-scope explicitly, and/or add an approver-policy hook.
- **Acceptance:** Behavior is documented; optional hook covered by tests if added.

---

## Tier 3 — OSS governance & supply chain

What makes it credible specifically *as an open-source security project*.

### 3.1 Fix vulnerability reporting
- **Why:** `SECURITY.md` says "email the maintainers" with no address.
- **Action:** Enable GitHub Private Vulnerability Reporting; link it; add a
  response-time SLA.
- **Acceptance:** A clear, working private reporting channel.

### 3.2 Add governance files
- **Action:** `CODE_OF_CONDUCT.md`, `.github/ISSUE_TEMPLATE/`,
  `.github/PULL_REQUEST_TEMPLATE.md`, `CODEOWNERS`.
- **Acceptance:** Files present and wired into the repo.

### 3.3 Automated dependency updates
- **Action:** Add Dependabot or Renovate (npm + GitHub Actions ecosystems).
- **Acceptance:** Update PRs open automatically.

### 3.4 Security scanning
- **Action:** Add CodeQL; add the OpenSSF Scorecard action and best-practices badge.
- **Acceptance:** CodeQL runs on PRs; Scorecard published.

### 3.5 Automated, provenance-backed releases
- **Why:** `scripts/publish.sh` is a hand-run shell script.
- **Action:** Adopt Changesets for versioning/changelogs; release workflow runs
  `npm publish --provenance`.
- **Acceptance:** Tag/merge triggers a verified publish with provenance attestation.

### 3.6 Contributor provenance (optional)
- **Action:** Consider DCO sign-off or commit signing.
- **Acceptance:** Policy documented and enforced if adopted.

---

## Tier 4 — Documentation & DX

### 4.1 Threat model document
- **Why:** Table stakes for a policy/authorization product; currently absent.
- **Action:** Document trust boundaries, what Agent IAM does/doesn't protect
  against, and fail-open vs fail-closed semantics.

### 4.2 Generated API reference + versioned docs site
- **Action:** TypeDoc-generated reference; versioned docs (the `docs/adoption/*`
  guides are good but there's no API reference).

### 4.3 Explicit policy-semantics doc
- **Why:** First-match vs all-match, `deny`-precedence (`resolveDecision` is
  "highest priority wins"), and requirement-merging are implicit in code.
- **Action:** Document evaluation semantics with examples.

### 4.4 Per-package stability / SemVer policy
- **Action:** State stability guarantees and SemVer policy in each package README.

---

## Suggested sequencing

1. **Tier 1** as one focused sprint (tooling + CI + metadata) — unblocks safe iteration.
2. **Tier 2** correctness/security fixes, each with tests, now that CI enforces quality.
3. **Tier 3** governance/supply-chain in parallel (mostly config, low code risk).
4. **Tier 4** docs as features stabilize.
