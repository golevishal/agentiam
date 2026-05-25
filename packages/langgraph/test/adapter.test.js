import test from "node:test";
import assert from "node:assert";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { StateGraph, MemorySaver, Annotation, Command } from "@langchain/langgraph";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { createAgentIAM } from "@agentiam/core";
import { createGuardedToolNode } from "../src/index.js";

const StateAnnotation = Annotation.Root({
  messages: Annotation({
    reducer: (state, update) => state.concat(update),
    default: () => [],
  }),
});

function setupGraph(iamOpts = {}) {
  const iam = createAgentIAM(iamOpts);
  
  let execCount = 0;
  
  const mockTool = tool(
    async ({ arg }) => {
      execCount++;
      return `executed-${arg}`;
    },
    {
      name: "mock_tool",
      description: "A mock tool",
      schema: z.object({ arg: z.string() })
    }
  );

  const guardedNode = createGuardedToolNode({
    tools: [mockTool],
    iam,
    mapToolCall(toolCall) {
      return {
        actor: { type: "agent", id: "langgraph-bot" },
        action: { name: toolCall.name, input: toolCall.args }
      };
    }
  });

  const workflow = new StateGraph(StateAnnotation)
    .addNode("tools", guardedNode)
    .addEdge("__start__", "tools")
    .addEdge("tools", "__end__");

  const checkpointer = new MemorySaver();
  const graph = workflow.compile({ checkpointer });

  return { graph, iam, mockTool, getExecCount: () => execCount };
}

test("adapter allows execution without interrupt if policy matches", async () => {
  const { graph, getExecCount } = setupGraph({ policy: { defaultDecision: "allow", rules: [] } });
  const config = { configurable: { thread_id: "1" } };

  const res = await graph.invoke(
    {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [{ id: "call_1", name: "mock_tool", args: { arg: "allow-me" } }]
        })
      ]
    },
    config
  );

  assert.equal(getExecCount(), 1);
  const lastMsg = res.messages[res.messages.length - 1];
  assert.equal(lastMsg._getType(), "tool");
  assert.equal(lastMsg.tool_call_id, "call_1");
  assert.equal(lastMsg.content, "executed-allow-me");
});

test("adapter denies execution and returns blocked message", async () => {
  const { graph, getExecCount } = setupGraph({
    policy: {
      id: "test",
      rules: [
        {
          id: "deny-rule",
          when: { action: "mock_tool", input: { arg: "deny" } },
          decision: "deny"
        }
      ]
    }
  });

  const config = { configurable: { thread_id: "2" } };

  const res = await graph.invoke({
    messages: [
      new AIMessage({ content: "", tool_calls: [{ id: "call_deny", name: "mock_tool", args: { arg: "deny" } }] })
    ]
  }, config);

  const lastMsg = res.messages[res.messages.length - 1];
  assert.equal(lastMsg._getType(), "tool");
  assert.equal(lastMsg.tool_call_id, "call_deny");
  assert.equal(lastMsg.content, "Blocked by policy");
});

test("adapter interrupts for approval_required, and resumes with payload", async () => {
  const { graph, iam, getExecCount } = setupGraph();
  const config = { configurable: { thread_id: "2" } };

  const promise = graph.invoke(
    {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [{ id: "call_2", name: "mock_tool", args: { arg: "requires-approval" } }]
        })
      ]
    },
    config
  );

  await promise;
  assert.equal(getExecCount(), 0);

  const state = await graph.getState(config);
  assert.equal(state.tasks[0]?.interrupts?.length, 1);
  const interruptPayload = state.tasks[0].interrupts[0].value;
  assert.equal(interruptPayload.decision, "approval_required");
  
  const cpId = interruptPayload.checkpointId;
  await iam.checkpoints.approve(cpId, { resumePayload: { mocked: "response" } });

  const res = await graph.invoke(new Command({ resume: cpId }), config);

  assert.equal(getExecCount(), 0); 
  const lastMsg = res.messages[res.messages.length - 1];
  assert.equal(lastMsg._getType(), "tool");
  assert.equal(lastMsg.tool_call_id, "call_2");
  assert.equal(lastMsg.content, '{"mocked":"response"}');
});

test("adapter resumes execution if approved without payload", async () => {
  const { graph, iam, getExecCount } = setupGraph();
  const config = { configurable: { thread_id: "3" } };

  await graph.invoke(
    {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [{ id: "call_3", name: "mock_tool", args: { arg: "requires-approval" } }]
        })
      ]
    },
    config
  );

  const state = await graph.getState(config);
  const cpId = state.tasks[0].interrupts[0].value.checkpointId;

  await iam.checkpoints.approve(cpId);

  const res = await graph.invoke(new Command({ resume: cpId }), config);

  assert.equal(getExecCount(), 1);
  const lastMsg = res.messages[res.messages.length - 1];
  assert.equal(lastMsg._getType(), "tool");
  assert.equal(lastMsg.content, "executed-requires-approval");
});

test("adapter fails closed on mismatch/replay", async () => {
  const { graph, iam, getExecCount } = setupGraph();
  const config = { configurable: { thread_id: "4" } };

  await graph.invoke(
    {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [{ id: "call_4", name: "mock_tool", args: { arg: "requires-approval" } }]
        })
      ]
    },
    config
  );

  const state = await graph.getState(config);
  const cpId = state.tasks[0].interrupts[0].value.checkpointId;

  await iam.checkpoints.approve(cpId);
  await graph.invoke(new Command({ resume: cpId }), config);
  
  const config5 = { configurable: { thread_id: "5" } };
  await graph.invoke(
    {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [{ id: "call_5", name: "mock_tool", args: { arg: "bad-one" } }]
        })
      ]
    },
    config5
  );

  const state5 = await graph.getState(config5);
  const cpId5 = state5.tasks[0].interrupts[0].value.checkpointId;
  await iam.checkpoints.reject(cpId5);

  const res = await graph.invoke(new Command({ resume: cpId5 }), config5);

  assert.equal(getExecCount(), 1); 
  const lastMsg = res.messages[res.messages.length - 1];
  assert.equal(lastMsg._getType(), "tool");
  assert.ok(lastMsg.content.includes("Execution skipped because checkpoint"));
});



test("adapter does not leak pending checkpoints on resume", async () => {
  const { graph, iam } = setupGraph();
  const config = { configurable: { thread_id: "6" } };

  await graph.invoke(
    {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [{ id: "call_6", name: "mock_tool", args: { arg: "requires-approval" } }]
        })
      ]
    },
    config
  );

  const state = await graph.getState(config);
  const cpId = state.tasks[0].interrupts[0].value.checkpointId;

  await iam.checkpoints.approve(cpId);
  await graph.invoke(new Command({ resume: cpId }), config);

  const pending = await iam.checkpoints.list({ status: "pending" });
  const leakedCheckpoints = pending.filter(cp => cp.request.action.input.arg === "requires-approval");
  
  if (leakedCheckpoints.length > 0) {
     console.log("LEAKED CHECKPOINTS:", JSON.stringify(leakedCheckpoints, null, 2));
  }
  
  assert.equal(leakedCheckpoints.length, 0, "Should not leak any pending checkpoints on resume");
});

test("adapter interrupts for clarification_required", async () => {
  const { graph, iam } = setupGraph({
    policy: {
      id: "clarify",
      rules: [
        {
          id: "clarify-rule",
          when: { action: "mock_tool" },
          decision: "clarification_required"
        }
      ]
    }
  });
  
  const config = { configurable: { thread_id: "7" } };

  await graph.invoke(
    {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [{ id: "call_7", name: "mock_tool", args: { arg: "clarify" } }]
        })
      ]
    },
    config
  );

  const state = await graph.getState(config);
  assert.equal(state.tasks[0]?.interrupts?.length, 1);
  const interruptPayload = state.tasks[0].interrupts[0].value;
  assert.equal(interruptPayload.decision, "clarification_required");
  
  const cpId = interruptPayload.checkpointId;
  
  // Try to approve it WITHOUT a payload -> should return a reason and block execution
  await iam.checkpoints.approve(cpId);
  const res = await graph.invoke(new Command({ resume: cpId }), config);
  const lastMsg = res.messages[res.messages.length - 1];
  assert.ok(lastMsg.content.includes("must be resumed with a payload"));
});
