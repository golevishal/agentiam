export const CHECKPOINTS_DDL = `
CREATE TABLE IF NOT EXISTS agentiam_checkpoints (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  audit_record_id TEXT NOT NULL,
  request TEXT NOT NULL,
  decision TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  resolved_at TEXT,
  approver TEXT,
  resolution_reason TEXT,
  resume_payload TEXT,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agentiam_checkpoints_status ON agentiam_checkpoints(status);
`;

export const AUDIT_LOG_DDL = `
CREATE TABLE IF NOT EXISTS agentiam_audit_log (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  actor TEXT,
  action TEXT NOT NULL,
  resource TEXT,
  context TEXT,
  decision TEXT NOT NULL,
  risk TEXT NOT NULL,
  matched_rules TEXT NOT NULL,
  requirements TEXT NOT NULL,
  approved_by TEXT,
  executed_at TEXT,
  outcome TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agentiam_audit_log_decision_id ON agentiam_audit_log(decision_id);
`;

export function initAgentIAMSQLite(db) {
  db.exec(CHECKPOINTS_DDL);
  db.exec(AUDIT_LOG_DDL);
}

export const toJSON = (val) => val != null ? JSON.stringify(val) : null;
export const fromJSON = (val) => val != null ? JSON.parse(val) : null;
