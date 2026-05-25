import { ToolMessage } from "@langchain/core/messages";

export function createGuardedToolNode(options) {
  if (!options || typeof options !== "object") {
    throw new TypeError("createGuardedToolNode requires an options object.");
  }

  const { tools, iam, mapToolCall } = options;

  if (!Array.isArray(tools)) {
    throw new TypeError("options.tools must be an array of LangChain tools.");
  }
  if (!iam || typeof iam.guard !== "function") {
    throw new TypeError("options.iam must be a valid AgentIAM instance.");
  }
  if (typeof mapToolCall !== "function") {
    throw new TypeError("options.mapToolCall must be a function.");
  }

  const toolMap = new Map(tools.map((t) => [t.name, t]));

  return async function guardedToolNode(state, config) {
    const messages = Array.isArray(state.messages) ? state.messages : state;
    const lastMessage = messages[messages.length - 1];

    if (!lastMessage || lastMessage._getType() !== "ai" || !lastMessage.tool_calls?.length) {
      return { messages: [] };
    }

    const results = [];

    for (const toolCall of lastMessage.tool_calls) {
      const tool = toolMap.get(toolCall.name);
      if (!tool) {
        results.push(
          new ToolMessage({
            tool_call_id: toolCall.id,
            name: toolCall.name,
            content: `Error: Tool ${toolCall.name} not found.`
          })
        );
        continue;
      }

      const request = mapToolCall(toolCall, state);
      
      let resumeCheckpointId = undefined;
      const isResuming = !!config?.configurable?.__pregel_resuming;
      const scratchpad = config?.configurable?.__pregel_scratchpad;
      
      if (isResuming && scratchpad?.resume && scratchpad.resume.length > (scratchpad.interruptCounter ?? 0)) {
        const { interrupt } = await import("@langchain/langgraph");
        resumeCheckpointId = interrupt();
      }

      let handled = false;

      while (!handled) {
        const result = await iam.guard(
          request,
          async () => tool.invoke(toolCall.args, config),
          {
            createCheckpoint: !isResuming || !resumeCheckpointId,
            resumeCheckpointId
          }
        );

        if (!result.executed && !result.resumedFromPayload) {
          if (result.decision.decision === "deny") {
            results.push(
              new ToolMessage({
                tool_call_id: toolCall.id,
                name: toolCall.name,
                content: "Blocked by policy"
              })
            );
            handled = true;
          } else if (
            result.decision.decision === "approval_required" ||
            result.decision.decision === "clarification_required"
          ) {
            if (result.checkpoint && result.checkpoint.status === "pending") {
              const { interrupt } = await import("@langchain/langgraph");
              const resumeValue = interrupt({
                decision: result.decision.decision,
                checkpointId: result.checkpoint.id,
                action: request.action.name,
                requirements: result.decision.requirements,
                reasons: result.decision.reasons?.map((r) => r.message) ?? []
              });
              resumeCheckpointId = resumeValue;
            } else {
              results.push(
                new ToolMessage({
                  tool_call_id: toolCall.id,
                  name: toolCall.name,
                  content: result.reason || "Execution blocked."
                })
              );
              handled = true;
            }
          } else {
            results.push(
              new ToolMessage({
                tool_call_id: toolCall.id,
                name: toolCall.name,
                content: result.reason || "Execution blocked."
              })
            );
            handled = true;
          }
        } else {
          let content = result.value;
          if (typeof content !== "string") {
            content = JSON.stringify(content);
          }
          results.push(
            new ToolMessage({
              tool_call_id: toolCall.id,
              name: toolCall.name,
              content
            })
          );
          handled = true;
        }
      }
    }

    return { messages: results };
  };
}
