import test from "node:test";
import assert from "node:assert";
import { createAgentIAM } from "../src/index.js";
import { InMemoryCheckpointStore } from "../src/checkpoints.js";

test("checkpoint expires based on expiresAt", async () => {
  // Use a very short expiration
  const iam = createAgentIAM({ checkpointExpirationMs: 50 });

  const result = await iam.guard(
    {
      actor: { type: "agent", id: "test" },
      action: { name: "send_email", input: { to: { externalEmail: true } } }
    },
    () => {}
  );

  assert.equal(result.checkpoint.status, "pending");
  assert.ok(result.checkpoint.expiresAt);

  // Wait for it to expire
  await new Promise((resolve) => setTimeout(resolve, 60));

  // Retrieving it should auto-expire it
  const cp = await iam.checkpoints.get(result.checkpoint.id);
  
  assert.equal(cp.status, "expired");
  assert.ok(cp.resolvedAt);
});

test("custom checkpoint store can be provided", async () => {
  const customStore = new InMemoryCheckpointStore();
  const iam = createAgentIAM({ checkpointStore: customStore });

  const result = await iam.guard(
    {
      actor: { type: "agent", id: "test" },
      action: { name: "send_email", input: { to: { externalEmail: true } } }
    },
    () => {}
  );

  const fromCustom = await customStore.get(result.checkpoint.id);
  assert.equal(fromCustom.id, result.checkpoint.id);
});

test("audit sink receives distinct snapshots across lifecycle changes", async () => {
  const sinkEvents = [];
  const iam = createAgentIAM({
    auditSink: (record) => sinkEvents.push(record)
  });

  const result = await iam.guard(
    {
      actor: { type: "agent", id: "test" },
      action: { name: "send_email", input: { to: { externalEmail: true } } }
    },
    () => {}
  );

  assert.equal(sinkEvents.length, 1);
  assert.equal(sinkEvents[0].outcome, "evaluated");

  await iam.checkpoints.approve(result.checkpoint.id, {
    approver: { id: "user_123", type: "user" }
  });

  assert.equal(sinkEvents.length, 2);
  assert.equal(sinkEvents[0].outcome, "evaluated", "Original event should not have mutated");
  assert.equal(sinkEvents[1].outcome, "approved");
});

