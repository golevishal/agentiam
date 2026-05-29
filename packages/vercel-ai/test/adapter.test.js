import assert from "node:assert";
import test from "node:test";
import { createAgentIAM, definePolicy } from "@agentiam/core";
import { ApprovalRequiredError, resumeGuardedTool, wrapGuardedTools } from "../src/index.js";

const tools = {
  safe_tool: {
    description: "safe",
    parameters: {},
    execute: async () => "safe executed"
  },
  danger_tool: {
    description: "danger",
    parameters: {},
    execute: async () => "danger executed"
  },
  approval_tool: {
    description: "needs approval",
    parameters: {},
    execute: async () => "approval executed"
  },
  no_execute_tool: {
    description: "no execute",
    parameters: {}
    // execute explicitly omitted
  }
};

function setupIAM() {
  const policy = definePolicy({
    id: "test",
    name: "test policy",
    defaultDecision: "deny",
    rules: [
      {
        id: "safe-rule",
        when: { action: "safe_tool" },
        decision: "allow"
      },
      {
        id: "danger-rule",
        when: { action: "danger_tool" },
        decision: "deny"
      },
      {
        id: "approval-rule",
        when: { action: "approval_tool" },
        decision: "approval_required"
      }
    ]
  });

  const iam = createAgentIAM({ policy });
  return { iam };
}

test("wrapGuardedTools returns wrapped functions mapping to IAM decisions", async () => {
  const { iam } = setupIAM();
  const wrappedTools = wrapGuardedTools({ tools, iam });

  // 1. Allowed tool
  const safeResult = await wrappedTools.safe_tool.execute({});
  assert.strictEqual(safeResult, "safe executed");

  // 2. Denied tool
  const dangerResult = await wrappedTools.danger_tool.execute({});
  const dangerJson = JSON.parse(dangerResult);
  assert.strictEqual(dangerJson.status, "denied");

  // 3. Pending tool (graceful mode)
  const approvalResult = await wrappedTools.approval_tool.execute({});
  const approvalJson = JSON.parse(approvalResult);
  assert.strictEqual(approvalJson.status, "approval_required");
  assert.ok(approvalJson.checkpointId);
});

test("Edge case 1: tool with no execute method should not wrap", async () => {
  const { iam } = setupIAM();
  const wrappedTools = wrapGuardedTools({ tools, iam });

  assert.strictEqual(typeof wrappedTools.no_execute_tool.execute, "undefined");
});

test("Edge case 2: strict mode throws immediately", async () => {
  const { iam } = setupIAM();
  const wrappedTools = wrapGuardedTools({ tools, iam, strict: true });

  await assert.rejects(async () => {
    await wrappedTools.approval_tool.execute({});
  }, ApprovalRequiredError);
});

test("Edge case 3: resumeGuardedTool throws clearly when called on a rejected checkpoint", async () => {
  const { iam } = setupIAM();
  const wrappedTools = wrapGuardedTools({ tools, iam });

  const result = await wrappedTools.approval_tool.execute({});
  const parsed = JSON.parse(result);
  const cpId = parsed.checkpointId;

  // Reject the checkpoint
  await iam.checkpoints.reject(cpId);

  // Attempt to resume
  await assert.rejects(async () => {
    await resumeGuardedTool({ iam, checkpointId: cpId, tools });
  }, /Cannot resume checkpoint.*because it was rejected/);
});

test("resumeGuardedTool executes properly after approval", async () => {
  const { iam } = setupIAM();
  const wrappedTools = wrapGuardedTools({ tools, iam });

  const result = await wrappedTools.approval_tool.execute({});
  const parsed = JSON.parse(result);
  const cpId = parsed.checkpointId;

  // Approve the checkpoint
  await iam.checkpoints.approve(cpId);

  // Resume
  const resumeResult = await resumeGuardedTool({ iam, checkpointId: cpId, tools });
  assert.strictEqual(resumeResult, "approval executed");
});
