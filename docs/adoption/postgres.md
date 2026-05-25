# Postgres Persistence

By default, Agent IAM uses an in-memory storage engine. This is great for local testing, but it means if your Node process restarts, all pending checkpoints and audit logs are lost.

For production, you should use `@agentiam/pg` to persist checkpoints and emit auditable logs directly to Postgres.

## Setup

Install the adapter and the underlying `pg` driver:

```bash
npm install @agentiam/pg pg
```

Initialize your IAM instance:

```javascript
import { Pool } from "pg";
import { createAgentIAM } from "@agentiam/core";
import { PostgresCheckpointStore, createPostgresAuditSink } from "@agentiam/pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const iam = createAgentIAM({
  policy: myPolicy,
  checkpointStore: new PostgresCheckpointStore(pool),
  auditSink: createPostgresAuditSink(pool)
});
```

## Schema & Migrations

Agent IAM does **not** auto-create tables or implicitly execute DDL on startup. You must apply the schema manually.

For local development or quick-starts, you can use the initialization helper:

```javascript
import { initAgentIAMPostgres } from "@agentiam/pg";
await initAgentIAMPostgres(pool);
```

For production, extract the DDL and run it via your standard migration pipeline (e.g. Prisma, Knex, Flyway):

```javascript
import { CHECKPOINTS_DDL, AUDIT_LOG_DDL } from "@agentiam/pg";

console.log(CHECKPOINTS_DDL);
console.log(AUDIT_LOG_DDL);
```

## Concurrency Guarantees

The `PostgresCheckpointStore` utilizes atomic row locks (`UPDATE ... WHERE status = 'approved'`) to completely eliminate race conditions. 

If you run 5 instances of your agent worker in Kubernetes, and two of them attempt to resume the exact same approved checkpoint simultaneously, one will succeed and the other will immediately receive a "Failed to claim checkpoint" error, ensuring tools cannot be doubly-executed.
