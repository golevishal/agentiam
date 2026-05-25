import assert from "node:assert/strict";
import test from "node:test";
import { createAgentIAM, definePolicy } from "../src/index.js";

test("allows read-only actions under the conservative default policy", async () => {
  const iam = createAgentIAM();

  const decision = await iam.evaluate({
    actor: { type: "agent", id: "research-agent" },
    action: { name: "search_docs", input: { query: "renewal terms" } }
  });

  assert.equal(decision.decision, "allow");
  assert.equal(decision.risk, "low");
  assert.deepEqual(decision.matchedRules, ["allow-read-only-actions"]);
});

test("requires clarification before approval for low-confidence external email", async () => {
  const iam = createAgentIAM();

  const decision = await iam.evaluate({
    actor: { type: "agent", id: "support-agent" },
    action: {
      name: "send_email",
      input: { to: "customer@acme.com" }
    },
    model: { confidence: 0.72 }
  });

  assert.equal(decision.decision, "clarification_required");
  assert.equal(decision.risk, "medium");
  assert.deepEqual(decision.matchedRules, ["review-external-email", "review-low-confidence"]);
  assert.deepEqual(decision.requirements.sort(), ["explain_uncertainty", "human_approval", "preview"].sort());
});

test("includes policy version in decisions and audit records", async () => {
  const iam = createAgentIAM({
    policy: {
      id: "versioned-policy",
      version: "2026-05-16",
      defaultDecision: "allow",
      defaultRisk: "low",
      rules: []
    }
  });

  const decision = await iam.evaluate({
    actor: { type: "agent", id: "research-agent" },
    action: { name: "read_ticket" }
  });

  assert.equal(decision.policyId, "versioned-policy");
  assert.equal(decision.policyVersion, "2026-05-16");
  assert.equal(iam.getAuditLog()[0].policyVersion, "2026-05-16");
});

test("denies production deletes", async () => {
  const iam = createAgentIAM();

  const decision = await iam.evaluate({
    actor: { type: "agent", id: "ops-agent" },
    action: { name: "delete_customer_record", input: { id: "cus_123" } },
    context: { environment: "production" }
  });

  assert.equal(decision.decision, "deny");
  assert.equal(decision.risk, "critical");
  assert.deepEqual(decision.matchedRules, ["block-production-delete"]);
});

test("guard executes only when policy allows", async () => {
  const iam = createAgentIAM();
  let executed = false;

  const result = await iam.guard(
    {
      actor: { type: "agent", id: "research-agent" },
      action: { name: "read_ticket", input: { id: "tic_123" } }
    },
    () => {
      executed = true;
      return { ok: true };
    }
  );

  assert.equal(result.executed, true);
  assert.equal(executed, true);
  assert.deepEqual(result.value, { ok: true });
  assert.equal(iam.getAuditLog()[0].outcome, "executed");
});

test("guard creates a checkpoint by default when approval is required", async () => {
  const iam = createAgentIAM();

  const result = await iam.guard(
    {
      actor: { type: "agent", id: "support-agent" },
      action: {
        name: "send_email",
        input: { to: "customer@acme.com" }
      },
      model: { confidence: 0.92 }
    },
    () => {
      throw new Error("should not execute");
    }
  );

  assert.equal(result.executed, false);
  assert.equal(result.decision.decision, "approval_required");
  assert.equal(result.checkpoint.status, "pending");
  assert.equal((await iam.checkpoints.list()).length, 1);

  const approved = await iam.checkpoints.approve(result.checkpoint.id, {
    approver: { type: "user", id: "user_123" },
    note: "Reviewed"
  });

  assert.equal(approved.status, "approved");
  assert.equal(iam.getAuditLog()[0].outcome, "approved");
  assert.equal(iam.getAuditLog()[0].approvedBy, "user_123");
});

test("guard can skip automatic checkpoint creation", async () => {
  const iam = createAgentIAM();

  const result = await iam.guard(
    {
      actor: { type: "agent", id: "support-agent" },
      action: {
        name: "send_email",
        input: { to: "customer@acme.com" }
      },
      model: { confidence: 0.92 }
    },
    () => {
      throw new Error("should not execute");
    },
    { createCheckpoint: false }
  );

  assert.equal(result.executed, false);
  assert.equal(result.checkpoint, null);
  assert.equal((await iam.checkpoints.list()).length, 0);
});

test("custom policies can match nested context and numeric operators", async () => {
  const policy = definePolicy({
    id: "customer-facing",
    defaultDecision: "allow",
    defaultRisk: "low",
    rules: [
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
    ]
  });

  const iam = createAgentIAM({ policy });
  const decision = await iam.evaluate({
    actor: { type: "agent", id: "support-agent" },
    action: { name: "draft_reply" },
    context: { customerTier: "enterprise" },
    model: { confidence: 0.84 }
  });

  assert.equal(decision.decision, "approval_required");
  assert.equal(decision.risk, "high");
  assert.deepEqual(decision.requirements, ["account_owner_approval"]);
});

test("policies can match evidence presence and metadata", async () => {
  const policy = definePolicy({
    id: "evidence-policy",
    version: "1",
    defaultDecision: "clarification_required",
    defaultRisk: "medium",
    defaultRequirements: ["cited_source_required"],
    rules: [
      {
        id: "allow-with-retrieved-source",
        when: {
          evidence: {
            any: {
              type: "retrieved_document",
              source: { exists: true }
            },
            count: { gte: 1 }
          }
        },
        decision: "allow",
        risk: "low"
      }
    ]
  });

  const iam = createAgentIAM({ policy });
  const decision = await iam.evaluate({
    actor: { type: "agent", id: "support-agent" },
    action: { name: "draft_customer_reply" },
    evidence: [
      {
        type: "retrieved_document",
        source: "crm",
        title: "Acme renewal notes"
      }
    ]
  });

  assert.equal(decision.decision, "allow");
  assert.deepEqual(decision.matchedRules, ["allow-with-retrieved-source"]);
});

test("evidence all matcher requires every matcher to have support", async () => {
  const iam = createAgentIAM({
    policy: {
      id: "multi-evidence-policy",
      rules: [
        {
          id: "needs-instruction-and-tool-result",
          when: {
            evidence: {
              all: [
                { type: "user_instruction" },
                { type: "tool_result", source: "crm" }
              ]
            }
          },
          decision: "allow",
          risk: "low"
        }
      ]
    }
  });

  const decision = await iam.evaluate({
    actor: { type: "agent", id: "support-agent" },
    action: { name: "draft_customer_reply" },
    evidence: [
      { type: "user_instruction", text: "Reply to Acme." },
      { type: "tool_result", source: "crm" }
    ]
  });

  assert.equal(decision.decision, "allow");
  assert.deepEqual(decision.matchedRules, ["needs-instruction-and-tool-result"]);
});

test("default approval policies include default requirements when no rule matches", async () => {
  const iam = createAgentIAM({
    policy: {
      id: "default-review",
      defaultDecision: "approval_required",
      defaultRisk: "medium",
      defaultRequirements: ["human_approval", "preview"],
      rules: []
    }
  });

  const decision = await iam.evaluate({
    actor: { type: "agent", id: "general-agent" },
    action: { name: "update_crm_note" }
  });

  assert.equal(decision.decision, "approval_required");
  assert.deepEqual(decision.requirements, ["human_approval", "preview"]);
});
