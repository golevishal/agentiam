import { createAgentIAM, definePolicy } from "@agentiam/core";
import { PostgresCheckpointStore, createPostgresAuditSink, initAgentIAMPostgres } from "@agentiam/pg";
import pkg from 'pg';
const { Pool } = pkg;

// Define the IAM policy
const policy = definePolicy({
  id: "example-policy",
  rules: [
    {
      id: "allow-read",
      when: { action: "read_logs" },
      decision: "allow"
    },
    {
      id: "deny-drop",
      when: { action: "drop_tables" },
      decision: "deny"
    },
    {
      id: "require-approval-email",
      when: { action: "send_email" },
      decision: "approval_required",
      requirements: ["manager_approval"]
    }
  ]
});

// Setup the Postgres connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://postgres:password@localhost:5432/agentiam_demo"
});

// Ensure tables exist for the demo
await initAgentIAMPostgres(pool);

// Initialize Agent IAM with Postgres persistence
export const iam = createAgentIAM({
  policy,
  checkpointStore: new PostgresCheckpointStore(pool),
  auditSink: createPostgresAuditSink(pool)
});

export { pool };
