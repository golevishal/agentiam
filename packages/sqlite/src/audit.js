import { toJSON } from "./schema.js";

/**
 * @typedef {import("better-sqlite3").Database} Database
 * @typedef {import("@agentiam/core").AuditRecord} AuditRecord
 */

/**
 * Create an audit sink backed by a SQLite database.
 *
 * @param {Database} db - An open better-sqlite3 database instance.
 * @returns {(record: AuditRecord) => Promise<void>} An async sink that persists audit records.
 */
export function createSqliteAuditSink(db) {
  return async (record) => {
    const stmt = db.prepare(`
      INSERT INTO agentiam_audit_log (
        id, decision_id, timestamp, policy_id, policy_version, actor, action,
        resource, context, decision, risk, matched_rules, requirements,
        approved_by, executed_at, outcome
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        actor = excluded.actor,
        resource = excluded.resource,
        context = excluded.context,
        risk = excluded.risk,
        matched_rules = excluded.matched_rules,
        requirements = excluded.requirements,
        approved_by = excluded.approved_by,
        executed_at = excluded.executed_at,
        outcome = excluded.outcome
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
