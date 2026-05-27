export function defaultMapToolCall(toolCall, options = {}) {
  const actor = options.actor || { type: "agent", id: options.actorId || "default" };

  return {
    actor: {
      type: "agent",
      ...actor
    },
    action: {
      name: toolCall.name,
      input: toolCall.input || {}
    }
  };
}
