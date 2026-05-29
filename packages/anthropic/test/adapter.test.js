import assert from "node:assert";
import test from "node:test";
import { createAgentIAM, definePolicy } from "@agentiam/core";
import { ApprovalRequiredError, runGuardedTools } from "../src/index.js";

function setupIAM() {
  const policy = definePolicy({
    rules: [
      { id: "read", when: { action: "read_file" }, decision: "allow" },
      { id: "delete", when: { action: "delete_file" }, decision: "approval_required" },
      { id: "db", when: { action: "drop_db" }, decision: "deny" }
    ]
  });
  return createAgentIAM({ policy });
}

test("runGuardedTools - executes allowed tool", async () => {
  const iam = setupIAM();
  const tools = {
    read_file: async ({ path }) => `Read: ${path}`
  };

  const toolCalls = [
    {
      type: "tool_use",
      id: "toolu_abc123",
      name: "read_file",
      input: { path: "/tmp/test.txt" }
    }
  ];

  const results = await runGuardedTools({ iam, toolCalls, tools });

  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].tool_use_id, "toolu_abc123");
  assert.strictEqual(results[0].status, "executed");
  assert.strictEqual(results[0].output, "Read: /tmp/test.txt");
});

test("runGuardedTools - handles approval_required gracefully", async () => {
  const iam = setupIAM();
  const tools = {
    delete_file: async () => "Deleted"
  };

  const toolCalls = [
    {
      type: "tool_use",
      id: "toolu_def456",
      name: "delete_file",
      input: { path: "/tmp/important.txt" }
    }
  ];

  const results = await runGuardedTools({ iam, toolCalls, tools });

  assert.strictEqual(results[0].tool_use_id, "toolu_def456");
  assert.strictEqual(results[0].status, "pending");
  assert.ok(results[0].checkpointId.startsWith("chk_"));
  assert.match(results[0].output, /Approval required/);
});

test("runGuardedTools - throws error in strict mode", async () => {
  const iam = setupIAM();
  const tools = {
    delete_file: async () => "Deleted"
  };

  const toolCalls = [
    {
      type: "tool_use",
      id: "toolu_xyz",
      name: "delete_file",
      input: { path: "/tmp/important.txt" }
    }
  ];

  await assert.rejects(async () => {
    await runGuardedTools({ iam, toolCalls, tools, strict: true });
  }, ApprovalRequiredError);
});

test("runGuardedTools - ignores non-tool_use blocks", async () => {
  const iam = setupIAM();
  const tools = { read_file: async () => "Done" };

  const toolCalls = [
    { type: "text", text: "I will use a tool now." },
    { type: "tool_use", id: "toolu_1", name: "read_file", input: {} }
  ];

  const results = await runGuardedTools({ iam, toolCalls, tools });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].tool_use_id, "toolu_1");
});

test("runGuardedTools - multi-turn arrays map IDs correctly", async () => {
  const iam = setupIAM();
  const tools = {
    read_file: async ({ path }) => `Read: ${path}`,
    delete_file: async () => "Deleted"
  };

  // Claude often returns multiple tool requests in a single generation
  const toolCalls = [
    {
      type: "tool_use",
      id: "toolu_req1",
      name: "read_file",
      input: { path: "a.txt" }
    },
    {
      type: "tool_use",
      id: "toolu_req2",
      name: "delete_file",
      input: { path: "b.txt" }
    }
  ];

  const results = await runGuardedTools({ iam, toolCalls, tools });

  assert.strictEqual(results.length, 2);

  // Verify tool_result blocks match tool_use_id from input
  assert.strictEqual(results[0].tool_use_id, toolCalls[0].id);
  assert.strictEqual(results[1].tool_use_id, toolCalls[1].id);

  assert.strictEqual(results[0].status, "executed");
  assert.strictEqual(results[1].status, "pending");
});
