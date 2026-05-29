import assert from "node:assert";
import test from "node:test";
import { createAgentIAM } from "@agentiam/core";
import { newDb } from "pg-mem";
import { PostgresCheckpointStore } from "../src/checkpoints.js";
import { initAgentIAMPostgres } from "../src/schema.js";

function setup() {
  const db = newDb();
  const pool = db.adapters.createPg().Pool;
  return { db, pool: new pool() };
}

test("PostgresCheckpointStore handles concurrent execution correctly across core guard calls", async () => {
  const { pool } = setup();
  await initAgentIAMPostgres(pool);
  const store = new PostgresCheckpointStore(pool);

  const iam = createAgentIAM({
    checkpointStore: store,
    policy: {
      id: "concurrent",
      rules: [
        {
          id: "concurrent-rule",
          when: { action: "slow_action" },
          decision: "approval_required"
        }
      ]
    }
  });

  const request = {
    actor: { type: "agent", id: "bot" },
    action: { name: "slow_action", input: {} }
  };

  // Evaluate and create a checkpoint
  const evalResult = await iam.guard(request, async () => {
    throw new Error("Should not execute");
  });
  assert.equal(evalResult.decision.decision, "approval_required");

  const cpId = evalResult.checkpoint.id;

  // Approve the checkpoint
  await iam.checkpoints.approve(cpId);

  let executeCount = 0;

  // An execute function that resolves slowly to encourage race conditions if atomic claim fails
  async function slowExecute() {
    executeCount++;
    return new Promise((resolve) => setTimeout(() => resolve("success"), 50));
  }

  // Two workers try to resume at the same time
  const results = await Promise.all([
    iam.guard(request, slowExecute, { resumeCheckpointId: cpId }),
    iam.guard(request, slowExecute, { resumeCheckpointId: cpId })
  ]);

  // One should succeed, one should fail
  const successes = results.filter((r) => r.executed === true);
  const failures = results.filter((r) => r.executed === false);

  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.equal(executeCount, 1);

  // The failure should mention failing to claim
  assert.ok(failures[0].reason.includes("Failed to claim checkpoint"));
});
