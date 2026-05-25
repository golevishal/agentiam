export function createPostgresAuditSink(pool) {
  return async function postgresAuditSink(record) {
    const query = `
      INSERT INTO agentiam_audit_log (
        id, "decisionId", timestamp, "policyId", "policyVersion",
        actor, action, resource, context, decision, risk,
        "matchedRules", requirements, "approvedBy", "executedAt", outcome
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      )
      ON CONFLICT (id) DO UPDATE SET
        actor = EXCLUDED.actor,
        resource = EXCLUDED.resource,
        context = EXCLUDED.context,
        risk = EXCLUDED.risk,
        "matchedRules" = EXCLUDED."matchedRules",
        requirements = EXCLUDED.requirements,
        "approvedBy" = EXCLUDED."approvedBy",
        "executedAt" = EXCLUDED."executedAt",
        outcome = EXCLUDED.outcome
    `;

    const values = [
      record.id,
      record.decisionId,
      record.timestamp,
      record.policyId,
      record.policyVersion,
      record.actor ? JSON.stringify(record.actor) : null,
      JSON.stringify(record.action),
      record.resource ? JSON.stringify(record.resource) : null,
      record.context ? JSON.stringify(record.context) : null,
      record.decision,
      record.risk,
      JSON.stringify(record.matchedRules),
      JSON.stringify(record.requirements),
      record.approvedBy || null,
      record.executedAt || null,
      record.outcome
    ];

    await pool.query(query, values);
  };
}
