import type { AgentIAM, EvaluationRequest } from "@agentiam/core";

/**
 * Minimal structural shape of a LangChain tool used by the guarded node.
 * Mirrors the runtime expectations (`name` lookup and `invoke` execution)
 * without depending on the full `@langchain/core` type surface.
 */
export interface GuardedTool {
  name: string;
  invoke(input: unknown, config?: unknown): Promise<unknown> | unknown;
  [key: string]: unknown;
}

export interface GuardedToolNodeOptions {
  tools: GuardedTool[];
  iam: AgentIAM;
  mapToolCall: (toolCall: unknown, state: unknown) => EvaluationRequest;
}

export function createGuardedToolNode(
  options: GuardedToolNodeOptions
): (state: unknown, config?: unknown) => Promise<{ messages: unknown[] }>;
