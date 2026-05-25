# LangGraph Integration

Agent IAM provides a seamless adapter for [LangGraph JS](https://langchain-ai.github.io/langgraphjs/) via the `@agentiam/langgraph` package.

Instead of writing custom interrupt handlers or complex state reducers to pause your agent before it calls tools, Agent IAM maps its core `Checkpoint` concept directly to LangGraph's native `interrupt()` and `Command` payload system.

## Setup

Replace your standard LangGraph `ToolNode` with `createGuardedToolNode`.

```javascript
import { createGuardedToolNode } from "@agentiam/langgraph";
import { createAgentIAM } from "@agentiam/core";
import { tool } from "@langchain/core/tools";
import { Command } from "@langchain/langgraph";
import { z } from "zod";

// 1. Initialize IAM
const iam = createAgentIAM({ policy: myPolicy });

// 2. Define your LangChain tools
const myTools = [
  tool(async () => "Done", { name: "send_email", schema: z.object({}) })
];

// 3. Create the guarded node
const guardedTools = createGuardedToolNode({
  tools: myTools,
  iam,
  // Map the raw LangChain tool call to your IAM action structure
  mapToolCall(toolCall, state) {
    return {
      actor: { type: "agent", id: state.agentId || "agent" },
      action: { name: toolCall.name, input: toolCall.args },
      context: { threadId: state.threadId } // inject graph state here!
    };
  }
});
```

Now, wire `guardedTools` into your `StateGraph` just like you would a regular `ToolNode`. 

**Make sure you provide a `checkpointer` (e.g. `MemorySaver` or `PostgresSaver`) when compiling your graph**, as LangGraph requires it to support interrupts!

## Resuming from an Interrupt

When the graph hits a tool call that your policy marks as `approval_required` or `clarification_required`, the `guardedTools` node automatically calls `interrupt()` and suspends the thread.

The payload of the interrupt contains the IAM `Checkpoint ID`. 

```javascript
// Check if the graph is paused
const state = await app.getState(config);

if (state.next && state.next.includes("tools") && state.tasks[0]?.interrupts) {
  const interruptPayload = state.tasks[0].interrupts[0].value;
  console.log(`Paused! Needs approval for checkpoint: ${interruptPayload.checkpointId}`);
  
  // 1. A human approves the action
  await iam.checkpoints.approve(interruptPayload.checkpointId);
  
  // 2. Resume the graph by passing the checkpoint ID back
  // via a Command
  
  await app.stream(new Command({
    resume: interruptPayload.checkpointId
  }), config);
}
```

The `guardedTools` node will automatically intercept the resumed payload, detect that the checkpoint is now `approved`, execute the physical tool, and append a valid `ToolMessage` to your graph's state for the agent to continue.
