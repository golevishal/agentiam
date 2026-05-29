import assert from "node:assert";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteCheckpointStore, createSqliteAuditSink, initAgentIAMSQLite } from "../src/index.js";

function setup() {
  const db = new Database(":memory:");
  initAgentIAMSQLite(db);
  const store = new SqliteCheckpointStore(db);
  const auditSink = createSqliteAuditSink(db);
  return { db, store, auditSink };
}

test("Schema initialization", () => {
  const { db } = setup();
  const cpTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agentiam_checkpoints'")
    .get();
  assert.ok(cpTable, "agentiam_checkpoints table should exist");

  const auditTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agentiam_audit_log'")
    .get();
  assert.ok(auditTable, "agentiam_audit_log table should exist");
});

test("Checkpoint persistence and retrieval", async () => {
  const { store } = setup();

  const mockCheckpoint = {
    id: "chk_123",
    decisionId: "dec_123",
    auditRecordId: "aud_123",
    request: { action: { name: "test" } },
    decision: { decision: "approval_required" },
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10000).toISOString() // 10 seconds in future
  };

  await store.save(mockCheckpoint);
  const fetched = await store.get("chk_123");

  assert.strictEqual(fetched.id, "chk_123");
  assert.strictEqual(fetched.status, "pending");
  assert.deepStrictEqual(fetched.request, mockCheckpoint.request);
});

test("Checkpoint expiration is enforced on get()", async () => {
  const { store } = setup();

  const mockCheckpoint = {
    id: "chk_expired",
    decisionId: "dec_1",
    auditRecordId: "aud_1",
    request: {},
    decision: {},
    status: "pending",
    createdAt: new Date(Date.now() - 20000).toISOString(),
    expiresAt: new Date(Date.now() - 10000).toISOString() // Expired 10 seconds ago
  };

  await store.save(mockCheckpoint);

  const fetched = await store.get("chk_expired");
  assert.strictEqual(fetched.status, "expired", "Should dynamically return expired status");
});

test("Atomic consumption via update()", async () => {
  const { store } = setup();

  const mockCheckpoint = {
    id: "chk_atomic",
    decisionId: "dec_1",
    auditRecordId: "aud_1",
    request: {},
    decision: {},
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10000).toISOString()
  };

  await store.save(mockCheckpoint);

  // Approve it first
  await store.update("chk_atomic", { status: "approved" });

  // Consume it
  await store.update("chk_atomic", { status: "consumed" });

  // Try to consume it again
  await assert.rejects(async () => {
    await store.update("chk_atomic", { status: "consumed" });
  }, /already been consumed/);
});

test("Concurrency check: simultaneous update() calls", async () => {
  const { store } = setup();

  const mockCheckpoint = {
    id: "chk_concurrent",
    decisionId: "dec_1",
    auditRecordId: "aud_1",
    request: {},
    decision: {},
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10000).toISOString()
  };

  await store.save(mockCheckpoint);

  // Both try to approve the same checkpoint
  // Only one should succeed, the other should throw
  const [result1, result2] = await Promise.allSettled([
    store.update("chk_concurrent", { status: "approved" }),
    store.update("chk_concurrent", { status: "approved" })
  ]);

  assert.ok(
    [result1, result2].filter((r) => r.status === "fulfilled").length === 1,
    "Only one concurrent update should succeed"
  );
});

test("Audit log persistence", async () => {
  const { db, auditSink } = setup();

  const record = {
    id: "aud_123",
    decisionId: "dec_123",
    timestamp: new Date().toISOString(),
    policyId: "pol_1",
    policyVersion: "1.0",
    actor: { id: "user1" },
    action: { name: "read" },
    resource: null,
    context: {},
    decision: "allow",
    risk: "low",
    matchedRules: ["rule1"],
    requirements: [],
    outcome: "executed"
  };

  await auditSink(record);

  const row = db.prepare("SELECT * FROM agentiam_audit_log WHERE id = ?").get("aud_123");
  assert.strictEqual(row.id, "aud_123");
  assert.strictEqual(row.decision, "allow");
});
