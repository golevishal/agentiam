export class InMemoryCheckpointStore {
  constructor() {
    this.checkpoints = new Map();
  }

  async save(checkpoint) {
    this.checkpoints.set(checkpoint.id, { ...checkpoint });
    return checkpoint;
  }

  async get(id) {
    const cp = this.checkpoints.get(id);
    if (!cp) return null;
    return { ...cp };
  }

  async update(id, updates) {
    const cp = this.checkpoints.get(id);
    if (!cp) return null;

    if (updates.status === "consumed" && cp.status !== "approved") {
      throw new Error(
        `Failed to consume checkpoint ${id}: it may have already been consumed or is not approved.`
      );
    }

    if (
      (updates.status === "expired" ||
        updates.status === "approved" ||
        updates.status === "rejected") &&
      cp.status !== "pending"
    ) {
      throw new Error(`Failed to resolve checkpoint ${id}: it is not pending.`);
    }

    const updated = { ...cp, ...updates };
    this.checkpoints.set(id, updated);
    return updated;
  }

  async list(filters = {}) {
    let cps = Array.from(this.checkpoints.values()).map((cp) => ({ ...cp }));
    if (filters.status) {
      cps = cps.filter((cp) => cp.status === filters.status);
    }
    return cps;
  }
}

export function isExpired(checkpoint) {
  if (!checkpoint.expiresAt) return false;
  return new Date() > new Date(checkpoint.expiresAt);
}
