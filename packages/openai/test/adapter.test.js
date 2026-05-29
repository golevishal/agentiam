import assert from "node:assert";
import test from "node:test";
import { createAgentIAM, definePolicy } from "@agentiam/core";
import { ApprovalRequiredError, resumeGuardedTool, runGuardedTools } from "../src/index.js";

const toolCalls = [
  {
    id: "call_1",
    type: "function",
    function: { name: "safe_tool", arguments: "{}" }
  },
  {
    id: "call_2",
    type: "function",
    function: { name: "danger_tool", arguments: "{}" }
  },
  {
    id: "call_3",
    type: "function",
    function: { name: "approval_tool", arguments: "{}" }
  }
];

const tools = {
  safe_tool: () => "safe executed",
  danger_tool: () => "danger executed",
  approval_tool: () => "approval executed"
};

function setupIAM() {
  const policy = definePolicy({
    id: "pol_1",
    name: "Test Policy",
    defaultDecision: "deny",
    rules: [
      {
        id: "rule_safe",
        decision: "allow",
        when: { action: "safe_tool" }
      },
      {
        id: "rule_danger",
        decision: "deny",
        when: { action: "danger_tool" }
      },
      {
        id: "rule_approval",
        decision: "approval_required",
        when: { action: "approval_tool" }
      }
    ]
  });

  const iam = createAgentIAM({ policy });
  return { iam };
}

test("runGuardedTools returns structured results", async () => {
  const { iam } = setupIAM();

  const results = await runGuardedTools({
    iam,
    toolCalls,
    tools
  });

  assert.strictEqual(results.length, 3);

  assert.strictEqual(results[0].status, "executed");
  assert.strictEqual(results[0].output, "safe executed");

  assert.strictEqual(results[1].status, "denied");
  assert.strictEqual(results[1].output, "Blocked by policy");

  assert.strictEqual(results[2].status, "pending");
  assert.ok(results[2].output.includes("paused"));
  assert.ok(results[2].checkpointId);
});

test("runGuardedTools strict mode throws on pending", async () => {
  const { iam } = setupIAM();

  await assert.rejects(async () => {
    await runGuardedTools({
      iam,
      toolCalls: [toolCalls[2]], // approval_tool
      tools,
      strict: true
    });
  }, ApprovalRequiredError);
});

test("resumeGuardedTool executes after approval", async () => {
  const { iam } = setupIAM();

  const results = await runGuardedTools({
    iam,
    toolCalls: [toolCalls[2]], // approval_tool
    tools
  });

  const checkpointId = results[0].checkpointId;
  assert.ok(checkpointId);

  // Approve the checkpoint
  await iam.checkpoints.approve(checkpointId);

  const resumeResult = await resumeGuardedTool({
    iam,
    checkpointId,
    tools
  });

  assert.strictEqual(resumeResult, "approval executed");
});
