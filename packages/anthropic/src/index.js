import { ApprovalRequiredError, ClarificationRequiredError } from "./errors.js";
import { defaultMapToolCall } from "./mapper.js";

export { ApprovalRequiredError, ClarificationRequiredError, defaultMapToolCall };

/**
 * Runs a list of Anthropic tool calls through AgentIAM.
 * @param {Object} options
 * @param {import("@agentiam/core").AgentIAM} options.iam
 * @param {Array} options.toolCalls - Array of Anthropic tool_use blocks
 * @param {Record<string, Function>} options.tools - Implementation map
 * @param {Function} [options.mapToolCall] - Custom mapper
 * @param {boolean} [options.strict] - If true, throws errors on pending checkpoints
 * @param {Object} [options.actor] - The actor making the request
 * @returns {Promise<Array>} Array of result objects
 */
export async function runGuardedTools(options) {
  const {
    iam,
    toolCalls,
    tools,
    mapToolCall = defaultMapToolCall,
    strict = false,
    actor
  } = options;

  if (!iam || typeof iam.guard !== "function") {
    throw new TypeError("options.iam must be a valid AgentIAM instance.");
  }
  if (!Array.isArray(toolCalls)) {
    throw new TypeError("options.toolCalls must be an array of Anthropic tool_use blocks.");
  }

  const results = [];

  for (const toolCall of toolCalls) {
    if (toolCall.type !== "tool_use") continue;

    const toolName = toolCall.name;
    const toolFunction = tools[toolName];

    if (!toolFunction) {
      results.push({
        tool_use_id: toolCall.id,
        status: "error",
        output: `Error: Tool ${toolName} not found.`
      });
      continue;
    }

    const request = mapToolCall(toolCall, { actor });

    const parsedArgs = toolCall.input || {};

    const result = await iam.guard(request, async () => toolFunction(parsedArgs));

    if (result.executed) {
      results.push({
        tool_use_id: toolCall.id,
        status: "executed",
        output: result.value
      });
    } else if (result.resumedFromPayload) {
      results.push({
        tool_use_id: toolCall.id,
        status: "executed",
        output: result.value
      });
    } else {
      const decision = result.decision.decision;
      if (decision === "deny") {
        results.push({
          tool_use_id: toolCall.id,
          status: "denied",
          output: "Blocked by policy"
        });
      } else if (decision === "approval_required") {
        const cpId = result.checkpoint ? result.checkpoint.id : "unknown";
        if (strict) {
          throw new ApprovalRequiredError(cpId, toolName);
        }
        results.push({
          tool_use_id: toolCall.id,
          status: "pending",
          checkpointId: cpId,
          output: `Execution paused. Approval required. Checkpoint ID: ${cpId}`
        });
      } else if (decision === "clarification_required") {
        const cpId = result.checkpoint ? result.checkpoint.id : "unknown";
        if (strict) {
          throw new ClarificationRequiredError(cpId, toolName);
        }
        results.push({
          tool_use_id: toolCall.id,
          status: "pending",
          checkpointId: cpId,
          output: `Execution paused. Clarification required. Checkpoint ID: ${cpId}`
        });
      }
    }
  }

  return results;
}

/**
 * Resumes a guarded Anthropic tool after it has been approved.
 * @param {Object} options
 * @param {import("@agentiam/core").AgentIAM} options.iam
 * @param {string} options.checkpointId
 * @param {Record<string, Function>} options.tools
 * @returns {Promise<any>} The result of the tool execution
 */
export async function resumeGuardedTool(options) {
  const { iam, checkpointId, tools } = options;

  if (!iam || typeof iam.guard !== "function") {
    throw new TypeError("options.iam must be a valid AgentIAM instance.");
  }
  if (!checkpointId) {
    throw new TypeError("options.checkpointId is required.");
  }
  if (!tools || typeof tools !== "object") {
    throw new TypeError("options.tools must be an object containing tool implementations.");
  }

  if (!iam.checkpoints) {
    throw new Error("iam.checkpoints is required to resume tools.");
  }

  const checkpoint = await iam.checkpoints.get(checkpointId);
  if (!checkpoint) {
    throw new Error(`Checkpoint ${checkpointId} not found.`);
  }

  const toolName = checkpoint.request.action.name;
  const toolFunction = tools[toolName];

  if (!toolFunction) {
    throw new Error(`Tool ${toolName} not found in provided tools map.`);
  }

  const parsedArgs = checkpoint.request.action.input || {};

  const result = await iam.guard(checkpoint.request, async () => toolFunction(parsedArgs), {
    resumeCheckpointId: checkpointId
  });

  if (result.executed) {
    return result.value;
  }

  if (result.resumedFromPayload) {
    return result.value;
  }

  throw new Error(`Failed to resume checkpoint: ${result.reason || "Unknown reason"}`);
}
