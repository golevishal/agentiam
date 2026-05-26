export function defaultMapToolCall(toolCall, options = {}) {
  const { actorId = "default" } = options;

  if (toolCall.type !== "function" || !toolCall.function) {
    throw new TypeError("toolCall must be an OpenAI function tool call");
  }

  let input = {};
  try {
    input = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
  } catch (e) {
    // If OpenAI returned malformed JSON, pass it as a raw string so the tool/policy can reject it
    input = { rawArgs: toolCall.function.arguments };
  }

  return {
    actor: { type: "agent", id: actorId },
    action: {
      name: toolCall.function.name,
      input
    }
  };
}
