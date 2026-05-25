# @agentiam/langgraph

The LangGraph JS adapter for Agent IAM.

`@agentiam/langgraph` wraps Agent IAM's core policy engine into a seamless `Command`-driven `Node` for your LangGraph workflows. It fully maps Agent IAM Checkpoints to LangGraph Interrupts, allowing your graphs to gracefully suspend and resume upon human approval, clarification, or policy exceptions.

## Installation

```bash
npm install @agentiam/langgraph @agentiam/core
```

## Quick Start

Use `createGuardedToolNode` instead of LangGraph's standard `ToolNode`.

```javascript
import { createGuardedToolNode } from "@agentiam/langgraph";
import { createAgentIAM } from "@agentiam/core";
import { tool } from "@langchain/core/tools";

const iam = createAgentIAM({ /* ... */ });
const tools = [ /* ... */ ];

// This drop-in replacement node automatically evaluates all tools
// against your IAM policy before executing them.
const guardedTools = createGuardedToolNode({
  tools,
  iam,
  mapToolCall(toolCall, state) {
    return {
      actor: { type: "agent", id: state.agentId || "langgraph-agent" },
      action: { name: toolCall.name, input: toolCall.args },
      context: { threadId: state.threadId }
    };
  }
});
```

When a tool requires approval, the node throws a `Command` with an `interrupt()` payload matching the exact `ToolMessage` structure, enabling you to build human-in-the-loop interfaces easily.

## License
MIT
