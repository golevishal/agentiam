# Agent IAM Implementation Spec

## 1. Purpose

Agent IAM is a policy and approval gateway for AI agent tool calls.

The project exists to make one pattern easy to adopt:

> Agents do not execute tools directly. Agents request authority to execute tools.

Agent IAM receives a proposed agent action, evaluates it against deterministic policy, returns a decision, and records an audit trail. It is not an agent runtime, UI framework, model wrapper, or compliance platform.

The first durable wedge is developer adoption:

> Drop Agent IAM into an existing agent stack and get policy decisions, approval requirements, and audit records in one weekend.

Evidence is part of the core wedge. Agent IAM should not only ask whether an action needs approval; it should expose what the agent is relying on, whether required evidence is present, and what remains unresolved before authority can be granted.

## 2. Product Boundary

### In Scope

- Evaluate proposed agent actions before execution.
- Return a small, stable decision schema.
- Support deterministic, inspectable policy rules.
- Provide conservative defaults.
- Emit audit records for every evaluation.
- Offer helper APIs for guarded execution.
- Provide future adapters for popular agent runtimes.
- Provide future local-first dashboard and checkpoint queue.

### Out of Scope

- Running agents.
- Calling LLMs directly.
- Replacing LangGraph, OpenAI Agents SDK, Vercel AI SDK, AG-UI, or CopilotKit.
- Owning full compliance workflows.
- Providing final legal/regulatory advice.
- Building a full UI design system.

## 3. Core Mental Model

Agent IAM sits between the agent runtime and tools. The application or runtime adapter constructs the evaluation request; the agent should not be allowed to directly self-report the full policy-relevant request.

```txt
User intent
  -> Agent runtime
  -> Proposed tool action
  -> Application/adapter normalization
  -> Agent IAM policy evaluation
  -> Decision
  -> Approval/checkpoint/clarification/block/execute
  -> Audit record
```

The agent runtime can propose actions. The application owns authority. Agent IAM makes that authority explicit and reviewable.

## 4. Primary API

The core API is `evaluate()`.

```ts
const decision = await iam.evaluate({
  actor,
  action,
  resource,
  context,
  model,
  evidence
});
```

`evaluate()` must be:

- Pure from the perspective of tool execution.
- Deterministic for a given policy and request.
- Side-effect limited to audit record creation.
- Runtime-agnostic.
- Safe to call in dry-run, staging, or production.

`evaluate()` must never execute the proposed action.

## 5. Evaluation Request Schema

```ts
type EvaluationRequest = {
  actor: Actor;
  action: AgentAction;
  resource?: Resource;
  context?: EvaluationContext;
  model?: ModelContext;
  evidence?: Evidence[];
  policy?: string;
};
```

### Actor

The actor describes who or what is requesting authority.

```ts
type Actor = {
  type: "agent" | "user" | "system" | string;
  id: string;
  userId?: string;
  orgId?: string;
  roles?: string[];
  scopes?: string[];
};
```

Examples:

```ts
{ type: "agent", id: "support-agent", userId: "user_123" }
{ type: "system", id: "nightly-ops-agent", orgId: "org_456" }
```

### Action

The action describes what the agent wants to do.

```ts
type AgentAction = {
  name: string;
  description?: string;
  input?: Record<string, unknown>;
  reversible?: boolean;
  idempotent?: boolean;
};
```

Action names should be stable and tool-like:

```txt
read_ticket
search_docs
send_email
delete_customer_record
update_billing_plan
publish_article
invite_user
change_permissions
```

### Resource

The resource describes what will be affected.

```ts
type Resource = {
  type: string;
  id?: string;
  ownerId?: string;
  sensitivity?: "public" | "internal" | "confidential" | "restricted";
  dataClasses?: string[];
};
```

Examples:

```ts
{
  type: "customer_record",
  id: "cus_123",
  sensitivity: "confidential",
  dataClasses: ["customer_data", "commercial_terms"]
}
```

### Context

The context describes where and under what operating conditions the action is being proposed.

```ts
type EvaluationContext = {
  environment?: "development" | "staging" | "production";
  surface?: string;
  customerTier?: string;
  region?: string;
  requestId?: string;
  sessionId?: string;
  [key: string]: unknown;
};
```

### Model

The model section captures relevant model/runtime information without making Agent IAM dependent on one provider.

```ts
type ModelContext = {
  provider?: string;
  model?: string;
  confidence?: number;
  runId?: string;
  traceId?: string;
};
```

Confidence is optional. Policies must not assume every runtime can produce a meaningful confidence score.

### Evidence

Evidence describes why the agent believes the action is correct.

```ts
type Evidence = {
  type: EvidenceType;
  source?: string;
  title?: string;
  text?: string;
  uri?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
};

type EvidenceType =
  | "user_instruction"
  | "retrieved_document"
  | "tool_result"
  | "memory"
  | "system_policy"
  | "approval_history"
  | (string & {});
```

Evidence is a major differentiator. Policies can require evidence before allowing high-risk actions.

Evidence is informational in v1. Agent IAM can verify presence, type, source, and metadata shape, but it does not prove that evidence semantically supports the action. Any semantic evidence validation must happen upstream or in a future optional verifier outside the deterministic core.

Example:

```ts
evidence: [
  {
    type: "user_instruction",
    text: "Follow up with Acme about renewal terms."
  },
  {
    type: "retrieved_document",
    source: "crm",
    title: "Acme renewal notes",
    confidence: 0.91
  }
]
```

## 6. Decision Schema

Agent IAM returns a decision object.

```ts
type EvaluationDecision = {
  id: string;
  timestamp: string;
  policyId: string;
  policyVersion: string;
  decision: Decision;
  risk: Risk;
  reasons: DecisionReason[];
  requirements: Requirement[];
  matchedRules: string[];
  audit: {
    required: boolean;
    recordId: string;
  };
};
```

### Decision

Keep the first decision enum intentionally small.

```ts
type Decision =
  | "allow"
  | "approval_required"
  | "clarification_required"
  | "deny";
```

Meaning:

- `allow`: The action can execute.
- `approval_required`: A human or system approver must approve.
- `clarification_required`: More context is needed before policy can allow execution.
- `deny`: The action is blocked.

Avoid adding states like `escalate`, `manual_review`, `quarantine`, or `defer` too early. Model those as requirements first.

### Risk

```ts
type Risk = "low" | "medium" | "high" | "critical";
```

Risk is explanatory, not magical. Every non-low risk decision should be traceable to matched policy rules.

### Requirements

Requirements are machine-readable obligations downstream systems can render or enforce.

Examples:

```txt
preview
human_approval
manager_approval
account_owner_approval
explain_uncertainty
recipient_check
policy_exception
two_person_review
cited_source_required
diff_required
```

Requirements make the library useful beyond a yes/no decision.

## 7. Policy Model

Policies are deterministic by default.

```ts
type Policy = {
  id?: string;
  version?: string;
  defaultDecision?: Decision;
  defaultRisk?: Risk;
  defaultRequirements?: Requirement[];
  rules?: PolicyRule[];
};
```

```ts
type PolicyRule = {
  id: string;
  description?: string;
  when?: Record<string, unknown>;
  decision?: Decision;
  risk?: Risk;
  requirements?: Requirement[];
};
```

Example:

```ts
const policy = definePolicy({
  id: "customer-facing",
  version: "2026-05-16",
  defaultDecision: "approval_required",
  defaultRisk: "medium",
  defaultRequirements: ["human_approval"],
  rules: [
    {
      id: "allow-read-only",
      when: { action: ["read_*", "search_*", "list_*"] },
      decision: "allow",
      risk: "low"
    },
    {
      id: "review-external-email",
      when: {
        action: "send_email",
        input: { to: { externalEmail: true } }
      },
      decision: "approval_required",
      risk: "medium",
      requirements: ["preview", "human_approval"]
    },
    {
      id: "block-prod-delete",
      when: {
        action: "delete_*",
        context: { environment: "production" }
      },
      decision: "deny",
      risk: "critical",
      requirements: ["policy_exception"]
    }
  ]
});
```

## 8. Rule Matching

The first matcher should remain boring and inspectable.

### Formal `when` Schema

Each policy rule has an optional `when` object. If `when` is omitted, the rule always matches. If present, every provided top-level field must match.

```ts
type RuleWhen = {
  action?: StringMatcher | StringMatcher[];
  actor?: ObjectMatcher;
  input?: ObjectMatcher;
  resource?: ObjectMatcher;
  context?: ObjectMatcher;
  model?: ObjectMatcher;
  evidence?: EvidenceMatcher;
};

type StringMatcher = string;

type ObjectMatcher = {
  [key: string]: PrimitiveMatcher | OperatorMatcher | ObjectMatcher;
};

type PrimitiveMatcher = string | number | boolean | null;

type OperatorMatcher = {
  eq?: unknown;
  neq?: unknown;
  in?: unknown[];
  exists?: boolean;
  lt?: number;
  lte?: number;
  gt?: number;
  gte?: number;
  contains?: unknown;
  externalEmail?: boolean;
};

type EvidenceMatcher = {
  any?: ObjectMatcher;
  all?: ObjectMatcher[];
  count?: OperatorMatcher;
};
```

Top-level behavior:

- `action` matches `request.action.name`.
- `input` matches `request.action.input`.
- `actor`, `resource`, `context`, and `model` match their corresponding request objects.
- `evidence.any` matches if at least one evidence item matches.
- `evidence.all` matches if each matcher has at least one matching evidence item.
- `evidence.count` matches the number of evidence items.

Object matcher behavior:

- Plain primitive values use exact equality.
- Strings containing `*` use anchored wildcard matching.
- Arrays in `action` mean "any pattern may match."
- Arrays elsewhere are literal values unless matched with an operator such as `contains` or `in`.
- Nested objects recurse.
- Operator objects must use only supported operators.

Supported matching primitives:

- Exact value equality.
- Wildcard action names.
- Nested object matching.
- Numeric operators: `lt`, `lte`, `gt`, `gte`.
- Equality operators: `eq`, `neq`.
- Collection operator: `in`.
- Presence operator: `exists`.
- String/array containment: `contains`.
- Utility operator: `externalEmail`.

Example:

```ts
{
  id: "review-enterprise-low-confidence",
  when: {
    context: { customerTier: "enterprise" },
    model: { confidence: { lt: 0.9 } }
  },
  decision: "approval_required",
  risk: "high",
  requirements: ["account_owner_approval"]
}
```

Evidence example:

```ts
{
  id: "require-cited-source-for-customer-email",
  when: {
    action: "send_email",
    input: { to: { externalEmail: true } },
    evidence: {
      any: {
        type: "retrieved_document",
        source: { exists: true }
      }
    }
  },
  decision: "approval_required",
  risk: "medium",
  requirements: ["preview", "cited_source_required", "human_approval"]
}
```

### Decision Precedence

When multiple rules match, the strictest decision wins.

```txt
allow < approval_required < clarification_required < deny
```

Clarification outranks approval. If required context is missing or uncertainty is too high, the system must ask for clarification before treating the action as approvable. Approval should not be used to paper over ambiguity.

Flow:

```txt
clarification_required
  -> clarification supplied
  -> re-evaluate
  -> allow / approval_required / deny
```

### Risk Precedence

When multiple rules match, the highest risk wins.

```txt
low < medium < high < critical
```

### Requirement Merge

When multiple rules match, requirements are merged and deduplicated.

## 9. Guarded Execution

`guard()` is convenience sugar over `evaluate()`.

```ts
const result = await iam.guard(request, execute);
```

Behavior:

- Calls `evaluate(request)`.
- Executes only when `decision === "allow"`.
- Creates a checkpoint by default when `decision === "approval_required"`.
- Skips execution for approval, clarification, or deny.
- Updates the audit record when execution succeeds.

`guard()` should never hide the decision object.

```ts
if (!result.executed) {
  showCheckpoint(result.decision);
}
```

Future versions may allow a custom execution policy:

```ts
iam.guard(request, execute, {
  executeWhen: ["allow"],
  createCheckpoint: true
});
```

## 10. Audit Records

Every evaluation creates an audit record.

```ts
type AuditRecord = {
  id: string;
  decisionId: string;
  timestamp: string;
  policyId: string;
  policyVersion: string;
  actor: Actor;
  action: AgentAction;
  resource?: Resource;
  context?: EvaluationContext;
  decision: Decision;
  risk: Risk;
  matchedRules: string[];
  requirements: Requirement[];
  approvedBy: string | null;
  executedAt: string | null;
  outcome: "evaluated" | "executed" | "approved" | "rejected";
};
```

Short-term implementation:

- In-memory audit log.
- `getAuditLog()` returns a copy.
- `auditSink(record)` streams records to caller-owned storage.

Future implementation:

- File-backed local audit store.
- SQLite adapter.
- Postgres adapter.
- Export to JSONL/CSV.
- Tamper-evident append-only log.

## 11. Checkpoint Store

Checkpoint management is the bridge from policy decisions to async approval workflows. The current core should include an in-memory checkpoint store; later milestones should add persistence, routing, expiration, and dashboard integration.

Proposed API:

```ts
const checkpoint = await iam.checkpoints.create({
  decision,
  request,
  status: "pending"
});

await iam.checkpoints.approve(checkpoint.id, {
  approver: { id: "user_123", type: "user" },
  note: "Looks correct."
});

await iam.checkpoints.reject(checkpoint.id, {
  approver: { id: "user_123", type: "user" },
  reason: "Wrong recipient."
});
```

Checkpoint status:

```ts
type CheckpointStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";
```

Checkpoint record:

```ts
type Checkpoint = {
  id: string;
  decisionId: string;
  request: EvaluationRequest;
  decision: EvaluationDecision;
  status: CheckpointStatus;
  createdAt: string;
  resolvedAt: string | null;
  approver: Actor | null;
  resolutionReason?: string;
};
```

`guard()` creates approval checkpoints by default. Callers may disable automatic checkpoint creation for low-level integrations, but the default path should support async approval workflows.

This is the bridge to UI, Slack, email, LangGraph interrupts, and runtime resume flows.

## 12. Runtime Adapter Strategy

Agent IAM should not compete with agent runtimes. It should adapt to them.

### Adapter Principles

- One excellent adapter beats several shallow adapters.
- Adapters should be thin.
- Core policy behavior must remain in `@agentiam/core`.
- Runtime-specific concepts must be normalized into `EvaluationRequest`.
- Adapter output must preserve the full `EvaluationDecision`.

### Phase 1 Adapter: LangGraph

LangGraph is the recommended first adapter because it already has strong interrupt and resume semantics.

Package:

```txt
@agentiam/langgraph
```

Possible API:

```ts
import { withAgentIAM } from "@agentiam/langgraph";

const guardedGraph = withAgentIAM(graph, {
  iam,
  mapToolCall(toolCall, state) {
    return {
      actor: { type: "agent", id: state.agentId },
      action: {
        name: toolCall.name,
        input: toolCall.args
      },
      context: {
        environment: process.env.NODE_ENV
      },
      model: {
        provider: state.modelProvider,
        model: state.modelName
      }
    };
  }
});
```

Expected behavior:

- On `allow`, execute tool normally.
- On `approval_required`, create checkpoint and interrupt graph.
- On `clarification_required`, interrupt graph with clarification requirement.
- On `deny`, return policy error or graph-level blocked state.

### Future Adapters

- `@agentiam/openai-agents`
- `@agentiam/vercel-ai`
- `@agentiam/ag-ui`
- `@agentiam/mastra`
- `@agentiam/react`

The React adapter should only expose hooks and headless primitives. It should not be the core product.

## 13. Local Dashboard

The dashboard is a proof mechanism, not the initial product.

Purpose:

- Show every proposed action.
- Show decision, risk, matched rules, and requirements.
- Show pending checkpoints.
- Export audit log.
- Make Agent IAM demoable to engineering managers, security, and compliance.

Initial dashboard constraints:

- Local-first.
- No hosted backend required.
- Reads audit/checkpoint data from local store or dev server.
- Can be started with one command.

Possible command:

```bash
npx agentiam dashboard
```

MVP views:

- Action timeline.
- Pending approvals.
- Rule match inspector.
- Audit export.

## 14. Policy Packs

Policy packs should come after real usage patterns emerge.

Candidate packages:

```txt
@agentiam/policies-customer-support
@agentiam/policies-internal-ops
@agentiam/policies-finance
@agentiam/policies-healthcare
```

Policy packs must be framed as implementation defaults, not legal guarantees.

Each pack should include:

- Policy rules.
- Rationale.
- Example actions.
- Test fixtures.
- Customization guide.
- Explicit non-guarantee disclaimer.

## 15. Security and Trust Considerations

Agent IAM must assume agent input is untrusted.

### Trust Boundary

The agent may propose a tool call, but the application or adapter must construct the `EvaluationRequest`.

```txt
Agent output / tool call proposal      untrusted
Application state and auth context     trusted by app
Runtime adapter normalization          trusted boundary
Agent IAM policy evaluation           deterministic authority layer
Tool execution                         allowed only after decision
```

Required architectural rule:

> Do not let the model directly author policy-relevant fields such as environment, actor roles, resource sensitivity, data classes, reversibility, or internal/external target classification.

Those fields must come from the application, runtime adapter, tool registry, auth system, or resource metadata. Agent-provided descriptions can be included as evidence or action description, but not as authoritative policy facts.

Implications:

- Never trust agent-provided risk classification as authoritative.
- Never use agent-provided context when application context is available.
- Prefer application-supplied context over model-supplied context.
- Keep policy deterministic and auditable.
- Make override paths explicit.
- Log policy exceptions.
- Avoid silent downgrade from `approval_required` to `allow`.

Future hardening:

- Policy schema validation.
- Signed policies.
- Immutable audit log.
- Explicit override records.
- Role-based approval.
- Two-person approval.
- Policy test runner.

## 16. Testing Strategy

Core tests should cover:

- Request validation.
- Exact matches.
- Wildcard action matches.
- Nested object matches.
- Operator matches.
- Multiple rule precedence.
- Requirement merging.
- Default policy behavior.
- Guarded execution.
- Audit record creation.
- Audit sink behavior.

Adapter tests should use fake runtimes first, then integration fixtures.

Policy pack tests should be snapshot-like but readable:

```txt
Given external email to customer
When confidence below threshold
Then approval_required with preview and human_approval
```

## 17. Repository Roadmap

### Milestone 0: Core Evaluator

Status: started.

Includes:

- `createAgentIAM()`
- `evaluate()`
- `guard()`
- conservative default policy
- audit log
- in-memory checkpoint store
- TypeScript declarations
- tests

### Milestone 1: Checkpoint Hardening

Add:

- checkpoint audit updates
- expiration support
- checkpoint resume payloads
- checkpoint persistence interface
- tests

### Milestone 2: Persistence

Add:

- file-backed store
- JSONL audit export
- optional SQLite adapter

### Milestone 3: LangGraph Adapter

Add:

- tool-call mapping
- interrupt integration
- resume integration
- example LangGraph app

### Milestone 4: Local Dashboard

Add:

- local dev dashboard
- audit timeline
- checkpoint queue
- rule inspector
- export button

### Milestone 5: Policy Packs

Add:

- customer support policy pack
- internal ops policy pack
- policy fixture tests

## 18. Non-Negotiable Design Rules

- Core stays runtime-agnostic.
- `evaluate()` stays small and central.
- Tool execution remains separate from policy evaluation.
- The policy engine stays deterministic; no LLM calls in core classification.
- Application/adapters construct evaluation requests; agents do not self-author authority.
- Decisions are explainable.
- Policies are inspectable.
- Defaults are conservative.
- Overrides are visible.
- Audit records are created for every evaluation.
- Decision and audit records include `policyId` and `policyVersion`.
- Clarification blocks approval until resolved and re-evaluated.
- `guard()` creates approval checkpoints by default.
- UI remains downstream of authority, not the source of authority.

## 19. Resolved Core Decisions

- Clarification outranks approval: `allow < approval_required < clarification_required < deny`.
- Core risk classification must not use an LLM. Probabilistic or model-derived signals can be passed into request context, but core policy evaluation remains deterministic.
- `guard()` creates a checkpoint by default for `approval_required` decisions.
- Audit and decision records include both `policyId` and `policyVersion`.
- Evidence is first-class but informational in v1; presence and metadata can be checked, semantic support is not verified by core.
- The application or adapter constructs `EvaluationRequest`; the agent must not self-author trusted policy fields.

## 20. Remaining Open Questions

- Should default policy be conservative globally, or environment-aware by default?
- How should internal vs external email domains be configured?
- Should policies support user/org scopes in core or via adapters?
- Should audit records include redacted payloads by default?

## 21. Success Criteria

The project is working if a developer can:

1. Install the package.
2. Wrap a high-risk tool call.
3. See an `approval_required` decision with reasons.
4. Show an audit record to another person.
5. Customize one policy rule.
6. Keep their existing agent runtime.

The long-term bet is not that Agent IAM is the only policy system. The bet is that every serious agentic application needs an authority layer, and Agent IAM can become the simplest reference implementation developers reach for first.
