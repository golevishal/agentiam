import { ApprovalRequiredError, ClarificationRequiredError } from "./errors.js";
import { formatDeniedResponse, formatPendingResponse } from "./formatter.js";

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
export function wrapGuardedTools({
  tools,
  iam,
  actor = { type: "agent", id: "default" },
  strict = false
}) {
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

      // Capture the narrowed execute reference so the async closure below keeps
      // the `function` narrowing from the guard above (TS widens `tool.execute`
      // back to optional across the closure boundary otherwise).
      const execute = tool.execute;

      return [
        name,
        {
          ...tool,
          execute: async (args, options) => {
            // `toolCallId` exists on the Vercel AI SDK execution options from v4 onward;
            // cast keeps this forward-compatible while we still target the v3 peer range.
            const toolCallId = /** @type {{ toolCallId?: string } | undefined} */ (options)
              ?.toolCallId;
            const request = {
              actor,
              action: { name, input: args },
              context: { toolCallId }
            };

            const result = await iam.guard(request, async () => {
              return await execute(args, options);
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
              const cpId = result.checkpoint ? result.checkpoint.id : "unknown";
              if (strict) {
                throw new ApprovalRequiredError(cpId, name);
              }
              return formatPendingResponse(decision, cpId);
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
 * @returns {Promise<any>}
 */
export async function resumeGuardedTool({ iam, checkpointId, tools }) {
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

  // Capture the narrowed execute reference so the async closure passed to
  // iam.guard below retains the `function` narrowing from the guard above.
  const execute = tool.execute;

  const parsedArgs = checkpoint.request.action.input || {};
  const context = checkpoint.request.context || {};

  // Create mock options since we don't have the original runtime options.
  // The execute function expects { toolCallId, messages, etc. }.
  const mockOptions = /** @type {any} */ ({ toolCallId: context.toolCallId });

  // NOTE: core.guard() reads any resume payload from the stored checkpoint
  // (set via iam.checkpoints.resume), not from these options. A previous
  // `resumePayload` argument here was silently ignored and has been removed.
  // Wiring resume-with-payload through this adapter is tracked for Tier 2.
  const result = await iam.guard(checkpoint.request, async () => execute(parsedArgs, mockOptions), {
    resumeCheckpointId: checkpointId
  });

  if (result.executed || result.resumedFromPayload) {
    return result.value;
  }

  throw new Error(`Failed to resume checkpoint: ${result.reason || "Unknown reason"}`);
}
