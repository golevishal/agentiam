export class PostgresCheckpointStore {
  constructor(pool) {
    this.pool = pool;
  }

  async save(checkpoint) {
    const query = `
      INSERT INTO agentiam_checkpoints (
        id, "decisionId", "auditRecordId", request, decision, status,
        "createdAt", "expiresAt", "resolvedAt", approver, "resolutionReason", "resumePayload"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;

    const values = [
      checkpoint.id,
      checkpoint.decisionId,
      checkpoint.auditRecordId,
      JSON.stringify(checkpoint.request),
      JSON.stringify(checkpoint.decision),
      checkpoint.status,
      checkpoint.createdAt,
      checkpoint.expiresAt,
      checkpoint.resolvedAt || null,
      checkpoint.approver ? JSON.stringify(checkpoint.approver) : null,
      checkpoint.resolutionReason || null,
      checkpoint.resumePayload !== undefined ? JSON.stringify({ payload: checkpoint.resumePayload }) : null
    ];

    const result = await this.pool.query(query, values);
    return this._mapRow(result.rows[0]);
  }

  async get(id) {
    const result = await this.pool.query('SELECT * FROM agentiam_checkpoints WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    return this._mapRow(result.rows[0]);
  }

  async update(id, updates) {
    const setClauses = [];
    const values = [id];
    let idx = 2;

    const fields = {
      status: updates.status,
      "resolvedAt": updates.resolvedAt,
      approver: updates.approver ? JSON.stringify(updates.approver) : undefined,
      "resolutionReason": updates.resolutionReason,
      "resumePayload": updates.resumePayload !== undefined ? JSON.stringify({ payload: updates.resumePayload }) : undefined
    };

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        setClauses.push(`"${key}" = $${idx}`);
        values.push(value);
        idx++;
      }
    }

    if (setClauses.length === 0) {
      return this.get(id);
    }

    let query = `UPDATE agentiam_checkpoints SET ${setClauses.join(', ')} WHERE id = $1`;

    // Atomic consumption logic
    // If we are updating status to 'consumed', we MUST ensure it is currently 'approved'
    // to prevent concurrent workers from consuming the same checkpoint.
    if (updates.status === 'consumed') {
      query += ` AND status = 'approved'`;
    } else if (updates.status === 'expired' || updates.status === 'approved' || updates.status === 'rejected') {
       query += ` AND status = 'pending'`;
    }

    query += ` RETURNING *`;

    const result = await this.pool.query(query, values);
    
    if (result.rows.length === 0) {
      if (updates.status === 'consumed') {
        throw new Error(`Failed to consume checkpoint ${id}: it may have already been consumed or is not approved.`);
      } else if (updates.status === 'approved' || updates.status === 'rejected' || updates.status === 'expired') {
        throw new Error(`Failed to resolve checkpoint ${id}: it may have already been resolved or is not pending.`);
      }
      return null;
    }

    return this._mapRow(result.rows[0]);
  }

  async list(filters = {}) {
    let query = 'SELECT * FROM agentiam_checkpoints';
    const values = [];

    if (filters.status) {
      query += ' WHERE status = $1';
      values.push(filters.status);
    }

    query += ' ORDER BY "createdAt" DESC';

    const result = await this.pool.query(query, values);
    return result.rows.map(row => this._mapRow(row));
  }

  _mapRow(row) {
    const cp = {
      id: row.id,
      decisionId: row.decisionId,
      auditRecordId: row.auditRecordId,
      request: typeof row.request === 'string' ? JSON.parse(row.request) : row.request,
      decision: typeof row.decision === 'string' ? JSON.parse(row.decision) : row.decision,
      status: row.status,
      createdAt: row.createdAt.toISOString ? row.createdAt.toISOString() : row.createdAt,
      expiresAt: row.expiresAt.toISOString ? row.expiresAt.toISOString() : row.expiresAt,
      resolvedAt: row.resolvedAt ? (row.resolvedAt.toISOString ? row.resolvedAt.toISOString() : row.resolvedAt) : null,
      approver: row.approver ? (typeof row.approver === 'string' ? JSON.parse(row.approver) : row.approver) : null,
      resolutionReason: row.resolutionReason || null,
    };

    if (row.resumePayload) {
      const parsed = typeof row.resumePayload === 'string' ? JSON.parse(row.resumePayload) : row.resumePayload;
      cp.resumePayload = parsed.payload;
    }

    return cp;
  }
}
