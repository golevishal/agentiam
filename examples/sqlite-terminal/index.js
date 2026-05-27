import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createAgentIAM, definePolicy } from "@agentiam/core";
import { SqliteCheckpointStore, createSqliteAuditSink, initAgentIAMSQLite } from "@agentiam/sqlite";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DB_PATH = path.join(process.cwd(), 'agentiam-demo.db');
console.log(`\n📁 Database: ${DB_PATH}`);

// Initialize SQLite Database
const db = new Database(DB_PATH);
initAgentIAMSQLite(db);

const checkpointStore = new SqliteCheckpointStore(db);
const auditSink = createSqliteAuditSink(db);

// Define a simple policy
const policy = definePolicy({
  id: "sqlite-example",
  name: "SQLite Example Policy",
  defaultDecision: "deny",
  rules: [
    {
      id: "allow-read",
      decision: "allow",
      when: { action: "read_file" }
    },
    {
      id: "require-approval-delete",
      decision: "approval_required",
      when: { action: "delete_file" }
    }
  ]
});

const iam = createAgentIAM({
  policy,
  checkpointStore,
  auditSink
});

async function runExample() {
  const rl = readline.createInterface({ input, output });

  console.log("\nSimulating agent actions...");

  const requestRead = { actor: { type: "agent", id: "bot1" }, action: { name: "read_file", input: { file: "test.txt" } } };
  const requestDelete = { actor: { type: "agent", id: "bot1" }, action: { name: "delete_file", input: { file: "production.db" } } };

  // 1. Allow Action
  console.log("\nAttempting to read file...");
  const resultRead = await iam.guard(requestRead, async () => {
    return "File contents: Hello World!";
  });
  console.log(resultRead.executed ? `✅ Success: ${resultRead.value}` : "❌ Failed");

  // 2. Require Approval Action
  console.log("\nAttempting to delete file...");
  const resultDelete = await iam.guard(requestDelete, async () => {
    return "File deleted successfully!";
  });

  if (resultDelete.decision.decision === "approval_required") {
    console.log(`\n⚠️ Action requires approval! Checkpoint ID: ${resultDelete.checkpoint.id}`);
    console.log("You can view this checkpoint in your SQLite viewer.");
    
    const answer = await rl.question("Approve deletion? (y/N) ");
    if (answer.toLowerCase() === "y") {
      await iam.checkpoints.approve(resultDelete.checkpoint.id, { id: "human_admin" });
      
      console.log("\nResuming checkpoint...");
      const resumeResult = await iam.guard(
        requestDelete,
        async () => { return "File deleted successfully!"; },
        { resumeCheckpointId: resultDelete.checkpoint.id }
      );
      
      console.log(resumeResult.executed ? `✅ Success: ${resumeResult.value}` : "❌ Failed to resume");
    } else {
      await iam.checkpoints.reject(resultDelete.checkpoint.id, { id: "human_admin" }, "User rejected");
      console.log("❌ Deletion rejected.");
    }
  }

  rl.close();
  db.close();
}

runExample().catch(console.error);
