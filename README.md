# Agent IAM

Agent IAM is a tiny policy and approval gateway for AI agent tool calls.

The core idea:

> Agents do not execute tools. Agents request authority to execute tools.

This package gives existing agent stacks one small primitive:

```ts
const decision = await iam.evaluate(proposedAction);
```

It does not try to be an agent runtime, UI framework, or compliance platform. It decides whether a proposed action should be allowed, approved, clarified, or denied, then records an audit trail.

The useful bit is not just pausing for approval. Agent IAM tracks the evidence behind an action, the policy version that evaluated it, the requirements that must be satisfied, and the audit record that proves what happened.

## Install

```bash
npm install @agentiam/core
```

## Quick Start

```ts
import { createAgentIAM } from "@agentiam/core";

const iam = createAgentIAM();

const decision = await iam.evaluate({
  actor: {
    type: "agent",
    id: "support-agent",
    userId: "user_123"
  },
  action: {
    name: "send_email",
    description: "Send renewal follow-up to customer",
    input: {
      to: "alex@acme.com",
      subject: "Renewal terms",
      body: "Following up on the renewal terms we discussed."
    }
  },
  context: {
    environment: "production",
    surface: "support_dashboard",
    customerTier: "enterprise"
  },
  model: {
    provider: "openai",
    model: "gpt-5.2",
    confidence: 0.74
  },
  evidence: [
    {
      type: "user_instruction",
      text: "Follow up with Acme about renewal terms."
    }
  ]
});
```

Example result:

```json
{
  "decision": "clarification_required",
  "risk": "medium",
  "matchedRules": ["review-external-email", "review-low-confidence"],
  "requirements": ["preview", "human_approval", "explain_uncertainty"]
}
```

## Guarded Execution

Use `guard()` when you want Agent IAM to evaluate and only execute when policy allows it.

```ts
const result = await iam.guard(
  {
    actor: { type: "agent", id: "research-agent" },
    action: { name: "read_ticket", input: { id: "tic_123" } }
  },
  () => ticketClient.read("tic_123")
);

if (!result.executed) {
  // Show approval UI, ask for clarification, or block the action.
  console.log(result.decision);
  console.log(result.checkpoint);
}
```

When `decision === "approval_required"`, `guard()` creates a pending checkpoint by default. You can disable that for low-level integrations:

```ts
await iam.guard(request, execute, {
  createCheckpoint: false
});
```

## Policy

Policies are deterministic and inspectable by default.

```ts
import { createAgentIAM, definePolicy } from "@agentiam/core";

const policy = definePolicy({
  id: "customer-facing",
  version: "2026-05-16",
  defaultDecision: "approval_required",
  defaultRisk: "medium",
  defaultRequirements: ["human_approval"],
  rules: [
    {
      id: "allow-read-only",
      when: { action: ["read_*", "search_*"] },
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
      risk: "critical"
    }
  ]
});

const iam = createAgentIAM({ policy });
```

## Decision Types

Agent IAM keeps the first decision model intentionally small:

- `allow`: the action can execute
- `approval_required`: a human or system approver must approve
- `clarification_required`: the agent needs more context before proceeding
- `deny`: the action is blocked

## Audit Log

Every evaluation creates an audit record:

```ts
const audit = iam.getAuditLog();
```

You can also stream records into your own sink:

```ts
const iam = createAgentIAM({
  auditSink(record) {
    console.log(record);
  }
});
```

Audit records include both `policyId` and `policyVersion`, so old decisions remain explainable after policy changes.

## Current Scope

This seed package intentionally focuses on the core evaluator. The next practical layers are:

- `@agentiam/langgraph`
- local audit dashboard
- persistent approval checkpoint store
- policy packs for customer support, internal ops, finance, and healthcare
- adapters for OpenAI Agents SDK, Vercel AI SDK, and AG-UI
