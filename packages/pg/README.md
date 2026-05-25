# @agentiam/pg

The Postgres persistence adapter for Agent IAM.

`@agentiam/pg` provides production-ready, highly-concurrent Postgres implementations for both `CheckpointStore` and `AuditSink` interfaces defined in `@agentiam/core`. 

## Installation

```bash
npm install @agentiam/pg @agentiam/core pg
```

## Quick Start

Pass in your own `Pool` instance from the `pg` driver.

```javascript
import { Pool } from "pg";
import { createAgentIAM } from "@agentiam/core";
import { PostgresCheckpointStore, createPostgresAuditSink } from "@agentiam/pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const iam = createAgentIAM({
  checkpointStore: new PostgresCheckpointStore(pool),
  auditSink: createPostgresAuditSink(pool),
  // ... policy config
});
```

## Schema & Migrations

This package does not auto-create tables or implicitly modify your database on startup. You have full ownership of applying the migrations.

You can import the DDL scripts to run manually or integrate into your CI:

```javascript
import { CHECKPOINTS_DDL, AUDIT_LOG_DDL } from "@agentiam/pg";

console.log(CHECKPOINTS_DDL);
```

For local development or quick-starts, an optional initialization helper is provided:

```javascript
import { initAgentIAMPostgres } from "@agentiam/pg";
await initAgentIAMPostgres(pool);
```

## Features
- **Concurrent Scaling**: The `PostgresCheckpointStore` utilizes atomic status locks (`UPDATE ... WHERE status = 'approved'`) to completely eliminate race conditions, preventing concurrent agent workers from executing the exact same approved checkpoint twice.
- **Robust Upserts**: The Audit Sink safely coalesces event updates, turning transient evaluations into hardened, auditable execution traces without duplicating records.

## License
MIT
