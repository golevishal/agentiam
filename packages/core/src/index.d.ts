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

export type PolicyValidationFailure = {
  path: string;
  ruleId: string | null;
  message: string;
};

export class PolicyValidationError extends TypeError {
  failures: PolicyValidationFailure[];
  constructor(failures: PolicyValidationFailure[]);
}

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
  outcome: "evaluated" | "executed" | "approved" | "rejected" | "expired" | "resumed";
};

export type CheckpointStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled"
  | "consumed";

export type Checkpoint = {
  id: string;
  decisionId: string;
  auditRecordId: string;
  request: EvaluationRequest;
  decision: EvaluationDecision;
  status: CheckpointStatus;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  approver: Actor | null;
  resolutionReason: string | null;
  resumePayload?: unknown;
};

export type AgentIAM = {
  evaluate(request: EvaluationRequest): Promise<EvaluationDecision>;
  guard<T, R = unknown>(
    request: EvaluationRequest,
    execute: () => T | Promise<T>,
    options?: { createCheckpoint?: boolean; resumeCheckpointId?: string }
  ): Promise<
    | { executed: true; resumedFromPayload?: false; decision: EvaluationDecision; value: T }
    | { executed: false; resumedFromPayload: true; decision: EvaluationDecision; value: R }
    | {
        executed: false;
        resumedFromPayload?: false;
        decision: EvaluationDecision;
        checkpoint: Checkpoint | null;
        reason: string;
      }
  >;
  getAuditLog(): AuditRecord[];
  checkpoints: {
    create(input: {
      request: EvaluationRequest;
      decision: EvaluationDecision;
    }): Promise<Checkpoint>;
    get(id: string): Promise<Checkpoint | null>;
    list(filters?: CheckpointListFilters): Promise<Checkpoint[]>;
    approve(
      id: string,
      resolution?: { approver?: Actor; note?: string; reason?: string; resumePayload?: unknown }
    ): Promise<Checkpoint>;
    reject(
      id: string,
      resolution?: { approver?: Actor; note?: string; reason?: string }
    ): Promise<Checkpoint>;
    resume(id: string, payload: unknown): Promise<Checkpoint>;
    expire(id: string): Promise<Checkpoint>;
  };
  policy: Required<Policy>;
};

export interface CheckpointListFilters {
  status?: CheckpointStatus;
}

export interface CheckpointStore {
  save(checkpoint: Checkpoint): Promise<Checkpoint>;
  get(id: string): Promise<Checkpoint | null>;
  update(id: string, updates: Partial<Checkpoint>): Promise<Checkpoint | null>;
  list(filters?: CheckpointListFilters): Promise<Checkpoint[]>;
}

export function createAgentIAM(options?: {
  checkpointStore?: CheckpointStore;
  checkpointExpirationMs?: number;
  policy?: Policy;
  auditSink?: (record: AuditRecord) => void | Promise<void>;
}): AgentIAM;

export function definePolicy(policy: Partial<Policy>): Policy;
export function validatePolicy(policy: unknown): true;
export const conservativePolicy: Required<Policy>;
