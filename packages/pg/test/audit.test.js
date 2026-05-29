import assert from "node:assert";
import test from "node:test";
import { newDb } from "pg-mem";
import { createPostgresAuditSink } from "../src/audit.js";
import { initAgentIAMPostgres } from "../src/schema.js";

function setup() {
  const db = newDb();
  const pool = db.adapters.createPg().Pool;
  return { db, pool: new pool() };
}

test("PostgresAuditSink inserts and upserts audit records", async () => {
  const { pool } = setup();
  await initAgentIAMPostgres(pool);

  const sink = createPostgresAuditSink(pool);

  const record = {
    id: "aud_123",
    decisionId: "dec_123",
    timestamp: new Date().toISOString(),
    policyId: "pol_1",
    policyVersion: "1.0",
    actor: { type: "user", id: "alice" },
    action: { name: "send_email", input: {} },
    resource: null,
    context: null,
    decision: "approval_required",
    risk: "high",
    matchedRules: ["rule_1"],
    requirements: ["human_approval"],
    approvedBy: null,
    executedAt: null,
    outcome: "evaluated"
  };

  await sink(record);

  let res = await pool.query("SELECT * FROM agentiam_audit_log WHERE id = $1", ["aud_123"]);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].outcome, "evaluated");

  // Upsert: simulate approval
  record.approvedBy = "bob";
  record.outcome = "approved";
  await sink(record);

  res = await pool.query("SELECT * FROM agentiam_audit_log WHERE id = $1", ["aud_123"]);
  assert.equal(res.rows[0].outcome, "approved");
  assert.equal(res.rows[0].approvedBy, "bob");

  // Upsert: simulate execution
  record.executedAt = new Date().toISOString();
  record.outcome = "executed";
  await sink(record);

  res = await pool.query("SELECT * FROM agentiam_audit_log WHERE id = $1", ["aud_123"]);
  assert.equal(res.rows[0].outcome, "executed");
  assert.ok(res.rows[0].executedAt);
});
