import test from 'node:test';
import assert from 'node:assert';
import { newDb } from 'pg-mem';
import { PostgresCheckpointStore } from '../src/checkpoints.js';
import { initAgentIAMPostgres } from '../src/schema.js';

function setup() {
  const db = newDb();
  const pool = db.adapters.createPg().Pool;
  return { db, pool: new pool() };
}

test('PostgresCheckpointStore saves and retrieves a checkpoint', async () => {
  const { pool } = setup();
  await initAgentIAMPostgres(pool);
  const store = new PostgresCheckpointStore(pool);

  const cp = {
    id: 'chk_123',
    decisionId: 'dec_123',
    auditRecordId: 'aud_123',
    request: { action: { name: 'test' } },
    decision: { decision: 'approval_required' },
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10000).toISOString(),
    resolvedAt: null,
    approver: null,
    resolutionReason: null
  };

  const saved = await store.save(cp);
  assert.equal(saved.id, 'chk_123');

  const retrieved = await store.get('chk_123');
  assert.deepEqual(retrieved.request, cp.request);
  assert.equal(retrieved.status, 'pending');
});

test('PostgresCheckpointStore handles concurrent execution correctly (atomic consume)', async () => {
  const { pool } = setup();
  await initAgentIAMPostgres(pool);
  const store = new PostgresCheckpointStore(pool);

  const cp = {
    id: 'chk_atomic',
    decisionId: 'dec_123',
    auditRecordId: 'aud_123',
    request: {},
    decision: {},
    status: 'approved',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10000).toISOString(),
  };

  await store.save(cp);

  // First worker tries to consume
  const update1 = await store.update('chk_atomic', { status: 'consumed' });
  assert.equal(update1.status, 'consumed');

  // Second worker tries to consume at the exact same time
  await assert.rejects(
    async () => {
      await store.update('chk_atomic', { status: 'consumed' });
    },
    /Failed to consume checkpoint chk_atomic/
  );
});

test('PostgresCheckpointStore list filters by status', async () => {
  const { pool } = setup();
  await initAgentIAMPostgres(pool);
  const store = new PostgresCheckpointStore(pool);

  await store.save({
    id: 'chk_1', decisionId: 'dec_1', auditRecordId: 'aud_1', request: {}, decision: {},
    status: 'pending', createdAt: new Date().toISOString(), expiresAt: new Date().toISOString()
  });
  await store.save({
    id: 'chk_2', decisionId: 'dec_2', auditRecordId: 'aud_2', request: {}, decision: {},
    status: 'consumed', createdAt: new Date().toISOString(), expiresAt: new Date().toISOString()
  });

  const pending = await store.list({ status: 'pending' });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, 'chk_1');

  const consumed = await store.list({ status: 'consumed' });
  assert.equal(consumed.length, 1);
  assert.equal(consumed[0].id, 'chk_2');
});

test('PostgresCheckpointStore handles concurrent resolution (atomic approve/reject)', async () => {
  const { pool } = setup();
  await initAgentIAMPostgres(pool);
  const store = new PostgresCheckpointStore(pool);

  const cp = {
    id: 'chk_atomic_resolve',
    decisionId: 'dec_123',
    auditRecordId: 'aud_123',
    request: {},
    decision: {},
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10000).toISOString(),
  };

  await store.save(cp);

  // First worker approves
  const update1 = await store.update('chk_atomic_resolve', { status: 'approved' });
  assert.equal(update1.status, 'approved');

  // Second worker tries to reject at the exact same time
  await assert.rejects(
    async () => {
      await store.update('chk_atomic_resolve', { status: 'rejected' });
    },
    /Failed to resolve checkpoint chk_atomic_resolve/
  );
});
