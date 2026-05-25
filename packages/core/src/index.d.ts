export type Decision = "allow" | "approval_required" | "clarification_required" | "deny";
export type Risk = "low" | "medium" | "high" | "critical";

export type Actor = {
  type: "agent" | "user" | "system" | string;
  id: string;
  userId?: string;
  [key: string]: unknown;
};

export type EvidenceType =
  | "user_instruction"
  | "retrieved_document"
  | "tool_result"
  | "memory"
  | "system_policy"
  | "approval_history"
  | (string & {});

export type AgentAction = {
  name: string;
  description?: string;
  input?: Record<string, unknown>;
  [key: string]: unknown;
};

export type EvaluationRequest = {
  actor: Actor;
  action: AgentAction;
  resource?: Record<string, unknown>;
  context?: Record<string, unknown>;
  model?: {
    provider?: string;
    model?: string;
    confidence?: number;
    [key: string]: unknown;
  };
  evidence?: Evidence[];
  policy?: string;
};

export type Requirement = string;

export type Evidence = {
  type: EvidenceType;
  source?: string;
  title?: string;
  text?: string;
  uri?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
};

export type PrimitiveMatcher = string | number | boolean | null;

export type OperatorMatcher = {
  eq?: unknown;
  neq?: unknown;
  in?: unknown[];
  exists?: boolean;
  lt?: number;
  lte?: number;
  gt?: number;
  gte?: number;
  contains?: unknown;
  externalEmail?: boolean;
};

export type ObjectMatcher = {
  [key: string]: PrimitiveMatcher | OperatorMatcher | ObjectMatcher | unknown[];
};

export type EvidenceMatcher = {
  any?: ObjectMatcher;
  all?: ObjectMatcher[];
  count?: OperatorMatcher;
};

export type RuleWhen = {
  action?: string | string[];
  actor?: ObjectMatcher;
  input?: ObjectMatcher;
  resource?: ObjectMatcher;
  context?: ObjectMatcher;
  model?: ObjectMatcher;
  evidence?: EvidenceMatcher | ObjectMatcher;
};

export type PolicyRule = {
  id: string;
  description?: string;
  when?: RuleWhen;
  decision?: Decision;
  risk?: Risk;
  requirements?: Requirement[];
};

export type Policy = {
  id?: string;
  version?: string;
  defaultDecision?: Decision;
  defaultRisk?: Risk;
  defaultRequirements?: Requirement[];
  rules?: PolicyRule[];
};

export type EvaluationDecision = {
  id: string;
  timestamp: string;
  policyId: string;
  policyVersion: string;
  decision: Decision;
  risk: Risk;
  reasons: Array<{ code: string; message: string }>;
  requirements: Requirement[];
  matchedRules: string[];
  audit: {
    required: boolean;
    recordId: string;
  };
};

export type AuditRecord = {
  id: string;
  decisionId: string;
  timestamp: string;
  policyId: string;
  policyVersion: string;
  actor: Actor;
  action: AgentAction;
  resource?: Record<string, unknown>;
  context?: Record<string, unknown>;
  decision: Decision;
  risk: Risk;
  matchedRules: string[];
  requirements: Requirement[];
  approvedBy: string | null;
  executedAt: string | null;
  outcome: "evaluated" | "executed" | "approved" | "rejected";
};

export type CheckpointStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled";

export type Checkpoint = {
  id: string;
  decisionId: string;
  auditRecordId: string;
  request: EvaluationRequest;
  decision: EvaluationDecision;
  status: CheckpointStatus;
  createdAt: string;
  resolvedAt: string | null;
  approver: Actor | null;
  resolutionReason: string | null;
};

export type AgentIAM = {
  evaluate(request: EvaluationRequest): Promise<EvaluationDecision>;
  guard<T>(
    request: EvaluationRequest,
    execute: () => T | Promise<T>,
    options?: { createCheckpoint?: boolean }
  ): Promise<
    | { executed: true; decision: EvaluationDecision; value: T }
    | { executed: false; decision: EvaluationDecision; checkpoint: Checkpoint | null; reason: string }
  >;
  getAuditLog(): AuditRecord[];
  checkpoints: {
    create(input: { request: EvaluationRequest; decision: EvaluationDecision }): Checkpoint;
    get(id: string): Checkpoint | null;
    list(): Checkpoint[];
    approve(id: string, resolution?: { approver?: Actor; note?: string; reason?: string }): Checkpoint;
    reject(id: string, resolution?: { approver?: Actor; note?: string; reason?: string }): Checkpoint;
  };
  policy: Required<Policy>;
};

export function createAgentIAM(options?: {
  policy?: Policy;
  auditSink?: (record: AuditRecord) => void;
}): AgentIAM;

export function definePolicy(policy: Policy): Required<Policy>;

export const conservativePolicy: Required<Policy>;
