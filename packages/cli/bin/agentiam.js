#!/usr/bin/env node
import { Command } from "commander";
import { PostgresCheckpointStore } from "@agentiam/pg";
import pkg from "pg";
const { Pool } = pkg;

export function createCLI(pool, exitOverride = false) {
  const program = new Command();
  
  if (exitOverride) {
    program.exitOverride();
  }

  program
    .name("agentiam")
    .description("CLI to manage Agent IAM checkpoints and audits")
    .version("0.1.1");

  const checkpoints = program.command("checkpoints").description("Manage checkpoints");

  checkpoints
    .command("list")
    .description("List all pending checkpoints")
    .action(async () => {
      const store = new PostgresCheckpointStore(pool);
      try {
        const pending = await store.list({ status: "pending" });
        if (pending.length === 0) {
          console.log("No pending checkpoints found.");
        } else {
          console.table(pending.map(cp => ({
            ID: cp.id,
            Action: cp.request?.action?.name,
            Created: cp.createdAt
          })));
        }
      } catch (e) {
        console.error(e.message);
      }
    });

  checkpoints
    .command("approve <id>")
    .description("Approve a pending checkpoint")
    .option("-n, --note <note>", "Optional approval note")
    .action(async (id, options) => {
      const store = new PostgresCheckpointStore(pool);
      try {
        const updated = await store.update(id, { status: "approved", resolutionReason: options.note || null, resolvedAt: new Date().toISOString() });
        if (!updated) {
          console.error(`Failed to approve checkpoint ${id}. It may not exist or is no longer pending.`);
        } else {
          console.log(`✅ Approved checkpoint ${id}`);
        }
      } catch (e) {
        console.error(e.message);
      }
    });

  const audit = program.command("audit").description("Manage audit logs");

  audit
    .command("tail")
    .description("Tail recent audit logs")
    .option("-l, --limit <limit>", "Number of records to fetch", "10")
    .action(async (options) => {
      try {
        const result = await pool.query(
          `SELECT id, action->>'name' as "action", outcome, "timestamp" FROM agentiam_audit_log ORDER BY "timestamp" DESC LIMIT $1`,
          [parseInt(options.limit, 10)]
        );
        if (result.rows.length === 0) {
          console.log("No audit records found.");
        } else {
          console.table(result.rows);
        }
      } catch (e) {
        console.error(e.message);
      }
    });

  return program;
}

// Only execute automatically if this file is run directly
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Error: DATABASE_URL environment variable is required.");
    process.exit(1);
  }
  const pool = new Pool({ connectionString });
  createCLI(pool).parseAsync(process.argv).finally(() => pool.end());
}
