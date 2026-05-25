# @agentiam/core

The core policy engine, evaluation logic, and authorization gateway for Agent IAM.

`@agentiam/core` provides the foundational structures to build human-in-the-loop and policy-driven boundaries around LLM tool calls. It intercepts tool executions, evaluates them against declarative policies, and persists their state via customizable Checkpoint Stores and Audit Sinks.

## Installation

```bash
npm install @agentiam/core
```

## Quick Start

```javascript
import { createAgentIAM, definePolicy } from "@agentiam/core";

// 1. Define an authorization policy
const policy = definePolicy({
  id: "default-policy",
  rules: [
    {
      id: "require-approval",
      when: { action: "delete_database" },
      decision: "approval_required",
      requirements: ["human_approval"]
    }
  ]
});

// 2. Initialize the IAM engine
const iam = createAgentIAM({ policy });

// 3. Guard a tool execution
const request = {
  actor: { type: "agent", id: "assistant" },
  action: { name: "delete_database", input: { db: "prod" } }
};

const result = await iam.guard(request, async () => {
  return await db.delete("prod");
});

console.log(result.executed); // false (approval required)
```

## Architecture
This package exports the interfaces for `CheckpointStore` and `AuditSink`. You can use the provided `InMemoryCheckpointStore` for local development, or adapt your own databases using these interfaces. See `@agentiam/pg` for a production-ready Postgres adapter.

For integration with LangGraph, use the `@agentiam/langgraph` package.

## License
MIT
