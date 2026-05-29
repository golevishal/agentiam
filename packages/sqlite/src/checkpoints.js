import { fromJSON, toJSON } from "./schema.js";

/**
 * @typedef {import("better-sqlite3").Database} Database
 * @typedef {import("@agentiam/core").Checkpoint} Checkpoint
 * @typedef {import("@agentiam/core").CheckpointStatus} CheckpointStatus
 * @typedef {import("@agentiam/core").CheckpointListFilters} CheckpointListFilters
 */

/**
 * Raw shape of a row in the `agentiam_checkpoints` table.
 *
 * @typedef {Object} CheckpointRow
 * @property {string} id
 * @property {string} decision_id
 * @property {string} audit_record_id
 * @property {string} request
 * @property {string} decision
 * @property {CheckpointStatus} status
 * @property {string} created_at
 * @property {string} expires_at
 * @property {string | null} resolved_at
 * @property {string | null} approver
 * @property {string | null} resolution_reason
 * @property {string | null} resume_payload
 * @property {number | null} updated_at
 */

/**
 * SQLite-backed implementation of the Agent IAM checkpoint store.
 */
export class SqliteCheckpointStore {
  /**
   * @param {Database} db - An open better-sqlite3 database instance.
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Persist a checkpoint and return the stored record.
   *
   * @param {Checkpoint} checkpoint
   * @returns {Promise<Checkpoint | null>}
   */
  async save(checkpoint) {
    const stmt = this.db.prepare(`
      INSERT INTO agentiam_checkpoints (
        id, decision_id, audit_record_id, request, decision, status,
        created_at, expires_at, resolved_at, approver, resolution_reason, resume_payload, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      checkpoint.id,
      checkpoint.decisionId,
      checkpoint.auditRecordId,
      toJSON(checkpoint.request),
      toJSON(checkpoint.decision),
      checkpoint.status,
      checkpoint.createdAt,
      checkpoint.expiresAt,
      checkpoint.resolvedAt || null,
      toJSON(checkpoint.approver),
      checkpoint.resolutionReason || null,
      checkpoint.resumePayload !== undefined ? toJSON({ payload: checkpoint.resumePayload }) : null,
      Date.now()
    );

    return this.get(checkpoint.id);
  }

  /**
   * Fetch a checkpoint by id. Expired pending checkpoints are reported as `expired`.
   *
   * @param {string} id
   * @returns {Promise<Checkpoint | null>}
   */
  async get(id) {
    const row = /** @type {CheckpointRow | undefined} */ (
      this.db.prepare("SELECT * FROM agentiam_checkpoints WHERE id = ?").get(id)
    );

    if (!row) return null;

    const cp = this._mapRow(row);

    // Enforce expiration
    if (cp.status === "pending" && cp.expiresAt && Date.now() > new Date(cp.expiresAt).getTime()) {
      return { ...cp, status: "expired" };
    }

    return cp;
  }

  /**
   * Apply a partial update to a checkpoint. State transitions are enforced atomically
   * at the database level (e.g. only an `approved` checkpoint may become `consumed`).
   *
   * @param {string} id
   * @param {Partial<Checkpoint>} updates
   * @returns {Promise<Checkpoint | null>}
   */
  async update(id, updates) {
    /** @type {string[]} */
    const fields = [];
    /** @type {unknown[]} */
    const values = [];

    if (updates.status !== undefined) {
      fields.push("status = ?");
      values.push(updates.status);
    }
    if (updates.resolvedAt !== undefined) {
      fields.push("resolved_at = ?");
      values.push(updates.resolvedAt);
    }
    if (updates.approver !== undefined) {
      fields.push("approver = ?");
      values.push(toJSON(updates.approver));
    }
    if (updates.resolutionReason !== undefined) {
      fields.push("resolution_reason = ?");
      values.push(updates.resolutionReason);
    }
    if (updates.resumePayload !== undefined) {
      fields.push("resume_payload = ?");
      values.push(toJSON({ payload: updates.resumePayload }));
    }

    if (fields.length === 0) {
      return this.get(id);
    }

    fields.push("updated_at = ?");
    values.push(Date.now());

    let query = `UPDATE agentiam_checkpoints SET ${fields.join(", ")} WHERE id = ?`;
    values.push(id);

    // Atomic consumption logic
    // If we are updating status to 'consumed', we MUST ensure it is currently 'approved'
    if (updates.status === "consumed") {
      query += ` AND status = 'approved'`;
    } else if (
      updates.status === "expired" ||
      updates.status === "approved" ||
      updates.status === "rejected"
    ) {
      query += ` AND status = 'pending'`;
      // Also ensure we only resolve if not expired natively in DB
      // (or let it fail if the user attempts to approve an expired one).
      // We will check expiration in JS space if needed, but DB level is simpler.
    }

    const stmt = this.db.prepare(query);
    const result = stmt.run(...values);

    if (result.changes === 0) {
      if (updates.status === "consumed") {
        throw new Error(
          `Failed to consume checkpoint ${id}: it may have already been consumed or is not approved.`
        );
      }
      if (
        updates.status === "approved" ||
        updates.status === "rejected" ||
        updates.status === "expired"
      ) {
        throw new Error(
          `Failed to resolve checkpoint ${id}: it may have already been resolved or is not pending.`
        );
      }
      return null;
    }

    return this.get(id);
  }

  /**
   * List checkpoints, optionally filtered by status. Expired pending checkpoints are
   * reported as `expired`.
   *
   * @param {CheckpointListFilters} [filters]
   * @returns {Promise<Checkpoint[]>}
   */
  async list(filters = {}) {
    let query = "SELECT * FROM agentiam_checkpoints";
    /** @type {unknown[]} */
    const values = [];

    if (filters.status) {
      query += " WHERE status = ?";
      values.push(filters.status);
    }

    query += " ORDER BY created_at DESC";

    const rows = /** @type {CheckpointRow[]} */ (this.db.prepare(query).all(...values));
    return rows.map((row) => {
      const cp = this._mapRow(row);
      // Enforce expiration
      if (
        cp.status === "pending" &&
        cp.expiresAt &&
        Date.now() > new Date(cp.expiresAt).getTime()
      ) {
        return { ...cp, status: "expired" };
      }
      return cp;
    });
  }

  /**
   * Map a raw database row to a {@link Checkpoint}.
   *
   * @param {CheckpointRow} row
   * @returns {Checkpoint}
   */
  _mapRow(row) {
    /** @type {Checkpoint} */
    const cp = {
      id: row.id,
      decisionId: row.decision_id,
      auditRecordId: row.audit_record_id,
      request: fromJSON(row.request),
      decision: fromJSON(row.decision),
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      resolvedAt: row.resolved_at || null,
      approver: fromJSON(row.approver),
      resolutionReason: row.resolution_reason || null
    };

    if (row.resume_payload) {
      const parsed = fromJSON(row.resume_payload);
      if (parsed && parsed.payload !== undefined) {
        cp.resumePayload = parsed.payload;
      }
    }

    return cp;
  }
}
