import { toJSON } from "./schema.js";

export function createSqliteAuditSink(db) {
  return async (record) => {
    const stmt = db.prepare(`
      INSERT INTO agentiam_audit_log (
        id, decision_id, timestamp, policy_id, policy_version, actor, action,
        resource, context, decision, risk, matched_rules, requirements,
        approved_by, executed_at, outcome
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.id,
      record.decisionId,
      record.timestamp,
      record.policyId,
      record.policyVersion,
      toJSON(record.actor),
      toJSON(record.action),
      toJSON(record.resource),
      toJSON(record.context),
      record.decision,
      record.risk,
      toJSON(record.matchedRules),
      toJSON(record.requirements),
      record.approvedBy || null,
      record.executedAt || null,
      record.outcome
    );
  };
}
