import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "process";
import { StateGraph, MessagesAnnotation, MemorySaver, Command } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { createGuardedToolNode } from "@agentiam/langgraph";
import { iam, pool } from "./iam.js";
import { allTools } from "./tools.js";

// Setup the terminal interface
const rl = readline.createInterface({ input, output });

// 1. Create the guarded tool node
const guardedTools = createGuardedToolNode({
  tools: allTools,
  iam,
  mapToolCall: (toolCall, state) => ({
    actor: { type: "agent", id: "demo-agent" },
    action: { name: toolCall.name, input: toolCall.args }
  })
});

// 2. Setup the LLM or Mock
const isMock = process.env.AGENTIAM_EXAMPLE_MODEL === "mock";
const llm = isMock ? null : new ChatOpenAI({ modelName: "gpt-4o-mini" }).bindTools(allTools);

async function callModel(state) {
  const messages = state.messages;
  
  if (isMock) {
    // If mocking, just blindly call the tools the user asked for based on the last message
    const lastMsg = messages[messages.length - 1].content.toLowerCase();
    const toolCalls = [];
    
    if (lastMsg.includes("read logs")) {
      toolCalls.push({ name: "read_logs", args: { limit: 5 }, id: "call_1" });
    } else if (lastMsg.includes("email")) {
      toolCalls.push({ name: "send_email", args: { to: "boss@company.com", body: "We have a problem." }, id: "call_2" });
    } else if (lastMsg.includes("drop")) {
      toolCalls.push({ name: "drop_tables", args: { confirm: true }, id: "call_3" });
    } else {
      return { messages: [new AIMessage("I am a mock agent. Say 'read logs', 'email', or 'drop' to trigger tools.")] };
    }
    
    return { messages: [new AIMessage({ content: "", tool_calls: toolCalls })] };
  }

  // Real LLM call
  const response = await llm.invoke(messages);
  return { messages: [response] };
}

// 3. Build the LangGraph
const workflow = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", guardedTools)
  .addEdge("__start__", "agent")
  .addConditionalEdges("agent", (state) => {
    const lastMessage = state.messages[state.messages.length - 1];
    return lastMessage.tool_calls?.length ? "tools" : "__end__";
  })
  .addEdge("tools", "agent");

const checkpointer = new MemorySaver(); // LangGraph's internal thread checkpointer
const app = workflow.compile({ checkpointer });

// 4. Run the Terminal Loop
async function main() {
  console.log("=== Agent IAM Terminal Demo ===");
  if (isMock) {
    console.log("Running in MOCK mode. Type 'read logs', 'email', or 'drop' to test policy rules.");
  } else {
    console.log("Running with OpenAI. Type your prompt.");
  }

  const threadId = "thread_" + Math.random().toString(36).substring(7);
  const config = { configurable: { thread_id: threadId } };

  while (true) {
    const userInput = await rl.question("\nUser: ");
    if (userInput.toLowerCase() === "exit") break;

    // Run the graph
    try {
      const stream = await app.stream({ messages: [new HumanMessage(userInput)] }, config);

      for await (const chunk of stream) {
        if (chunk.agent) {
          const msg = chunk.agent.messages[0];
          if (msg.content) console.log(`Agent: ${msg.content}`);
          if (msg.tool_calls?.length) {
            console.log(`Agent decided to call: ${msg.tool_calls.map(tc => tc.name).join(", ")}`);
          }
        }
      }
    } catch (e) {
      // Agent IAM creates LangGraph interrupts by throwing specialized Command objects or Errors.
      // LangGraph 0.2 handles interrupt() automatically if compiled correctly, but just in case,
      // let's check the state to see if it's interrupted.
      if (!e.message?.includes("GraphInterrupt")) {
        console.error("Graph execution crashed:", e);
        break;
      }
    }

    // Check if the graph is paused due to an IAM checkpoint
    const state = await app.getState(config);
    if (state.next && state.next.includes("tools") && state.tasks?.length > 0) {
      // The graph is paused at the 'tools' node.
      // Inspect the LangGraph interrupt payload, which contains the IAM Checkpoint.
      const task = state.tasks[0];
      const interruptPayload = task.interrupts?.[0]?.value;

      if (interruptPayload && interruptPayload.checkpointId) {
        console.log(`\n⏸️  GRAPH PAUSED by Agent IAM!`);
        console.log(`Checkpoint ID: ${interruptPayload.checkpointId}`);
        console.log(`Reason: ${interruptPayload.reason}`);

        const answer = await rl.question("Approve this action? (y/n): ");
        
        if (answer.toLowerCase() === "y") {
          console.log("✅ Approving checkpoint...");
          await iam.checkpoints.approve(interruptPayload.checkpointId);
        } else {
          console.log("❌ Rejecting checkpoint...");
          await iam.checkpoints.reject(interruptPayload.checkpointId);
        }

        // Resume the graph. 
        // We pass the checkpoint ID back to the node using `Command(resume: id)`.
        const resumeStream = await app.stream(new Command({
          resume: interruptPayload.checkpointId
        }), config);
        
        for await (const chunk of resumeStream) {
          if (chunk.agent) {
            const msg = chunk.agent.messages[0];
            if (msg.content) console.log(`Agent: ${msg.content}`);
          }
        }
      }
    }
  }

  rl.close();
  await pool.end(); // close db connection
}

// Resume handled by Langchain's internal thread system via Command object.

main().catch(console.error);
