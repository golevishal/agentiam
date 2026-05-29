import assert from "node:assert";
import test from "node:test";
import {
  PostgresCheckpointStore,
  createPostgresAuditSink,
  initAgentIAMPostgres
} from "@agentiam/pg";
import { newDb } from "pg-mem";
import { createCLI } from "../bin/agentiam.js";

function setup() {
  const db = newDb();
  const pool = db.adapters.createPg().Pool;
  return { db, pool: new pool() };
}

test("CLI handles checkpoints list, approve, and audit tail", async () => {
  const { pool } = setup();
  await initAgentIAMPostgres(pool);

  // Seed data
  const store = new PostgresCheckpointStore(pool);
  const sink = createPostgresAuditSink(pool);

  await sink({
    id: "aud_1",
    decisionId: "dec_1",
    policyId: "pol_1",
    policyVersion: "1",
    decision: "approval_required",
    risk: "high",
    matchedRules: [],
    requirements: ["manager_approval"],
    action: { name: "send_email", input: { to: "test@example.com" } },
    outcome: "pending",
    actor: { type: "agent", id: "agent_1" },
    timestamp: new Date().toISOString()
  });

  await store.save({
    id: "chk_1",
    decisionId: "dec_1",
    auditRecordId: "aud_1",
    request: { action: { name: "send_email" } },
    decision: { decision: "approval_required" },
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10000).toISOString(),
    resolvedAt: null,
    approver: null,
    resolutionReason: null
  });

  const cli = createCLI(pool, true);

  // Capture stdout
  let stdoutData = "";
  const originalLog = console.log;
  const originalTable = console.table;
  console.log = (msg) => {
    stdoutData += `${msg}\n`;
  };
  console.table = (data) => {
    stdoutData += `${JSON.stringify(data)}\n`;
  };

  try {
    // 1. Test checkpoints list
    stdoutData = "";
    await cli.parseAsync(["node", "agentiam", "checkpoints", "list"]);
    assert.match(stdoutData, /chk_1/);
    assert.match(stdoutData, /send_email/);

    // 2. Test checkpoints approve
    stdoutData = "";
    await cli.parseAsync([
      "node",
      "agentiam",
      "checkpoints",
      "approve",
      "chk_1",
      "-n",
      "Looks good"
    ]);
    assert.match(stdoutData, /Approved checkpoint chk_1/);

    const cp = await store.get("chk_1");
    assert.strictEqual(cp.status, "approved");
    assert.strictEqual(cp.resolutionReason, "Looks good");

    // 3. Test audit tail
    stdoutData = "";
    await cli.parseAsync(["node", "agentiam", "audit", "tail", "-l", "5"]);
    assert.match(stdoutData, /aud_1/);
    assert.match(stdoutData, /send_email/);
  } finally {
    // Restore stdout
    console.log = originalLog;
    console.table = originalTable;
    await pool.end();
  }
});

test("CLI --json emits machine-readable JSON for list and tail", async () => {
  const { pool } = setup();
  await initAgentIAMPostgres(pool);

  const store = new PostgresCheckpointStore(pool);
  const sink = createPostgresAuditSink(pool);

  await sink({
    id: "aud_json",
    decisionId: "dec_json",
    policyId: "pol_1",
    policyVersion: "1",
    decision: "approval_required",
    risk: "high",
    matchedRules: [],
    requirements: [],
    action: { name: "send_email", input: { to: "test@example.com" } },
    outcome: "pending",
    actor: { type: "agent", id: "agent_1" },
    timestamp: new Date().toISOString()
  });

  await store.save({
    id: "chk_json",
    decisionId: "dec_json",
    auditRecordId: "aud_json",
    request: { action: { name: "send_email" } },
    decision: { decision: "approval_required" },
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10000).toISOString(),
    resolvedAt: null,
    approver: null,
    resolutionReason: null
  });

  const cli = createCLI(pool, true);

  const logs = [];
  const tables = [];
  const originalLog = console.log;
  const originalTable = console.table;
  console.log = (msg) => {
    logs.push(msg);
  };
  console.table = (data) => {
    tables.push(data);
  };

  try {
    // checkpoints list --json
    logs.length = 0;
    tables.length = 0;
    await cli.parseAsync(["node", "agentiam", "checkpoints", "list", "--json"]);
    assert.strictEqual(tables.length, 0, "console.table should not be called in --json mode");
    assert.strictEqual(logs.length, 1);
    const cpRows = JSON.parse(logs[0]);
    assert.ok(Array.isArray(cpRows));
    assert.strictEqual(cpRows.length, 1);
    assert.strictEqual(cpRows[0].id, "chk_json");
    assert.strictEqual(cpRows[0].action, "send_email");
    assert.ok(cpRows[0].createdAt);

    // audit tail --json
    logs.length = 0;
    tables.length = 0;
    await cli.parseAsync(["node", "agentiam", "audit", "tail", "-l", "5", "--json"]);
    assert.strictEqual(tables.length, 0, "console.table should not be called in --json mode");
    assert.strictEqual(logs.length, 1);
    const auditRows = JSON.parse(logs[0]);
    assert.ok(Array.isArray(auditRows));
    assert.ok(auditRows.some((r) => r.id === "aud_json"));

    // empty --json output should still be a valid JSON array
    logs.length = 0;
    tables.length = 0;
    await store.update("chk_json", {
      status: "approved",
      resolutionReason: null,
      resolvedAt: new Date().toISOString()
    });
    await cli.parseAsync(["node", "agentiam", "checkpoints", "list", "--json"]);
    assert.strictEqual(tables.length, 0);
    assert.strictEqual(logs.length, 1);
    assert.deepStrictEqual(JSON.parse(logs[0]), []);
  } finally {
    console.log = originalLog;
    console.table = originalTable;
    await pool.end();
  }
});
