import { ApprovalRequiredError, ClarificationRequiredError } from "./errors.js";
import { formatPendingResponse, formatDeniedResponse } from "./formatter.js";

export { ApprovalRequiredError, ClarificationRequiredError };

/**
 * Wraps a record of Vercel AI SDK tools to run through AgentIAM.
 * @param {Object} options
 * @param {Record<string, import('ai').CoreTool>} options.tools - The tool definitions
 * @param {import('@agentiam/core').AgentIAM} options.iam - The AgentIAM instance
 * @param {Object} [options.actor] - The actor executing the tools
 * @param {boolean} [options.strict] - If true, throws errors on pending checkpoints
 * @returns {Record<string, import('ai').CoreTool>}
 */
export function wrapGuardedTools({ tools, iam, actor = { type: "agent", id: "default" }, strict = false }) {
  if (!iam || typeof iam.guard !== "function") {
    throw new TypeError("iam must be a valid AgentIAM instance.");
  }
  if (!tools || typeof tools !== "object") {
    throw new TypeError("tools must be an object containing Vercel AI SDK tool definitions.");
  }

  // To handle Edge Case 2 (strict mode aborts other tools in the batch), 
  // we could use an abort signal if the user passed one, or just rely on Vercel AI SDK's error propagation.
  // We'll throw immediately. If the user calls them concurrently, the first throw rejects the batch.

  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      // Edge Case 1: Client-side tool with no execute method
      if (typeof tool.execute !== "function") {
        return [name, tool];
      }

      return [
        name,
        {
          ...tool,
          execute: async (args, options) => {
            const request = {
              actor,
              action: { name, input: args },
              context: { toolCallId: options?.toolCallId }
            };

            const result = await iam.guard(request, async () => {
              return await tool.execute(args, options);
            });

            if (result.executed || result.resumedFromPayload) {
              return result.value;
            }

            const decision = result.decision.decision;
            if (decision === "deny") {
              // Denied tools don't throw an error in strict mode by default (only pending tools throw), 
              // but we return the blocked message.
              return formatDeniedResponse();
            }

            if (decision === "approval_required") {
              if (strict) {
                throw new ApprovalRequiredError(result.checkpoint.id, name);
              }
              return formatPendingResponse(decision, result.checkpoint.id);
            }

            if (decision === "clarification_required") {
              const cpId = result.checkpoint ? result.checkpoint.id : "unknown";
              if (strict) {
                throw new ClarificationRequiredError(cpId, name);
              }
              return formatPendingResponse(decision, cpId);
            }

            // Fallback
            return formatDeniedResponse();
          }
        }
      ];
    })
  );
}

/**
 * Resumes a guarded tool after it has been approved.
 * @param {Object} options
 * @param {import('@agentiam/core').AgentIAM} options.iam
 * @param {string} options.checkpointId
 * @param {Record<string, import('ai').CoreTool>} options.tools
 * @param {any} [options.resumePayload]
 * @returns {Promise<any>}
 */
export async function resumeGuardedTool({ iam, checkpointId, tools, resumePayload }) {
  if (!iam || typeof iam.guard !== "function") {
    throw new TypeError("iam must be a valid AgentIAM instance.");
  }
  if (!checkpointId) {
    throw new TypeError("checkpointId is required.");
  }
  if (!tools || typeof tools !== "object") {
    throw new TypeError("tools must be an object containing Vercel AI SDK tool definitions.");
  }
  if (!iam.checkpoints) {
    throw new Error("iam.checkpoints is required to resume tools.");
  }

  const checkpoint = await iam.checkpoints.get(checkpointId);
  if (!checkpoint) {
    throw new Error(`Checkpoint ${checkpointId} not found.`);
  }

  // Edge case 3: resumeGuardedTool called on a rejected checkpoint
  if (checkpoint.status === "rejected") {
    throw new Error(`Cannot resume checkpoint ${checkpointId} because it was rejected.`);
  }

  const toolName = checkpoint.request.action.name;
  const tool = tools[toolName];

  if (!tool) {
    throw new Error(`Tool ${toolName} not found in provided tools map.`);
  }

  if (typeof tool.execute !== "function") {
    throw new Error(`Tool ${toolName} does not have an execute function.`);
  }

  const parsedArgs = checkpoint.request.action.input || {};
  const context = checkpoint.request.context || {};
  
  // Create mock options since we don't have the original runtime options
  // The execute function expects { toolCallId, messages, etc. }
  const mockOptions = { toolCallId: context.toolCallId };

  const result = await iam.guard(
    checkpoint.request,
    async () => tool.execute(parsedArgs, mockOptions),
    { resumeCheckpointId: checkpointId, resumePayload }
  );

  if (result.executed || result.resumedFromPayload) {
    return result.value;
  }

  throw new Error(`Failed to resume checkpoint: ${result.reason || "Unknown reason"}`);
}
