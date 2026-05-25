import type { AgentIAM, EvaluationRequest } from "@agentiam/core";

export interface GuardedToolNodeOptions {
  tools: any[];
  iam: AgentIAM;
  mapToolCall: (toolCall: any, state: any) => EvaluationRequest;
}

export function createGuardedToolNode(options: GuardedToolNodeOptions): (state: any, config?: any) => Promise<{ messages: any[] }>;
