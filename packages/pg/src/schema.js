export const CHECKPOINTS_DDL = `
CREATE TABLE IF NOT EXISTS agentiam_checkpoints (
  id VARCHAR(255) PRIMARY KEY,
  "decisionId" VARCHAR(255) NOT NULL,
  "auditRecordId" VARCHAR(255) NOT NULL,
  request JSONB NOT NULL,
  decision JSONB NOT NULL,
  status VARCHAR(50) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "resolvedAt" TIMESTAMPTZ,
  approver JSONB,
  "resolutionReason" TEXT,
  "resumePayload" JSONB
);

CREATE INDEX IF NOT EXISTS idx_agentiam_checkpoints_status ON agentiam_checkpoints(status);
`;

export const AUDIT_LOG_DDL = `
CREATE TABLE IF NOT EXISTS agentiam_audit_log (
  id VARCHAR(255) PRIMARY KEY,
  "decisionId" VARCHAR(255) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  "policyId" VARCHAR(255) NOT NULL,
  "policyVersion" VARCHAR(50) NOT NULL,
  actor JSONB,
  action JSONB NOT NULL,
  resource JSONB,
  context JSONB,
  decision VARCHAR(50) NOT NULL,
  risk VARCHAR(50) NOT NULL,
  "matchedRules" JSONB NOT NULL,
  requirements JSONB NOT NULL,
  "approvedBy" VARCHAR(255),
  "executedAt" TIMESTAMPTZ,
  outcome VARCHAR(50) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agentiam_audit_log_decisionId ON agentiam_audit_log("decisionId");
`;

export async function initAgentIAMPostgres(pool) {
  await pool.query(CHECKPOINTS_DDL);
  await pool.query(AUDIT_LOG_DDL);
}
