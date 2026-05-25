# Quickstart: Guarding a Tool Call

This guide shows you how to add Agent IAM to a standalone tool call in under 10 minutes.

## 1. Install the Core Library

```bash
npm install @agentiam/core
```

## 2. Define Your Policy

Policies tell Agent IAM what is allowed, what is denied, and what requires human intervention. 

Create a file named `iam.js`:

```javascript
import { definePolicy, createAgentIAM } from "@agentiam/core";

const policy = definePolicy({
  id: "quickstart-policy",
  rules: [
    {
      id: "safe-read",
      when: { action: "read_logs" },
      decision: "allow"
    },
    {
      id: "dangerous-update",
      when: { action: "send_email" },
      decision: "approval_required",
      requirements: ["manager_approval"]
    }
  ]
});

// Initialize the engine (uses in-memory storage by default)
export const iam = createAgentIAM({ policy });
```

## 3. Wrap Your Tool Call

Instead of calling your tool directly, wrap it in `iam.guard`. 

```javascript
import { iam } from "./iam.js";

async function runAgent() {
  // 1. The agent decides it wants to send an email
  const request = {
    actor: { type: "agent", id: "support-bot" },
    action: { name: "send_email", input: { to: "user@example.com" } }
  };

  console.log("Agent is attempting to send an email...");

  // 2. We guard the execution
  const result = await iam.guard(request, async () => {
    // This only runs if the policy says "allow", 
    // or if a human has approved the checkpoint!
    console.log("-> 📧 Email physically sent!");
    return { success: true };
  });

  // 3. Handle the result
  if (!result.executed) {
    console.log(`Execution paused. Decision: ${result.decision.decision}`);
    console.log(`Checkpoint ID: ${result.checkpoint.id}`);
  } else {
    console.log("Tool executed successfully.");
  }
}

runAgent();
```

## 4. Approve and Resume

Run the script above, and you'll see it pauses because `send_email` requires approval. It generates a **Checkpoint ID**.

To resume it, a human (or a separate UI process) must approve the checkpoint, and then the agent can re-attempt the exact same guard call:

```javascript
// A human approves the action
await iam.checkpoints.approve(checkpointId);

// The agent retries the exact same guard call
const retryResult = await iam.guard(request, async () => {
  console.log("-> 📧 Email physically sent!");
  return { success: true };
}, { resumeCheckpointId: checkpointId });

console.log(retryResult.executed); // true!
```

## Next Steps

- Using LangChain/LangGraph? See the [LangGraph Integration Guide](./langgraph.md).
- Need this to survive server restarts? See the [Postgres Persistence Guide](./postgres.md).
