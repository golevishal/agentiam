import type { Pool, Client } from 'pg';
import type { CheckpointStore, AuditRecord, Checkpoint, CheckpointListFilters } from '@agentiam/core';

export class PostgresCheckpointStore implements CheckpointStore {
  constructor(pool: Pool | Client);
  save(checkpoint: Checkpoint): Promise<Checkpoint>;
  get(id: string): Promise<Checkpoint | null>;
  update(id: string, updates: Partial<Checkpoint>): Promise<Checkpoint | null>;
  list(filters?: CheckpointListFilters): Promise<Checkpoint[]>;
}

export function createPostgresAuditSink(pool: Pool | Client): (record: AuditRecord) => Promise<void>;

export function initAgentIAMPostgres(pool: Pool | Client): Promise<void>;

export const CHECKPOINTS_DDL: string;
export const AUDIT_LOG_DDL: string;
