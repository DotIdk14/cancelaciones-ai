import { beforeEach, describe, expect, it } from 'vitest';
import { createAiCallLogRepository } from './ai-call-log';
import { createFakeDatabase, type FakeDatabase } from './testing/fake-db';

let db: FakeDatabase;
let log: ReturnType<typeof createAiCallLogRepository>;

beforeEach(() => {
  db = createFakeDatabase();
  log = createAiCallLogRepository(db);
});

describe('createAiCallLogRepository', () => {
  it('record inserta una llamada AI', async () => {
    await log.record({ auditId: 'audit_1', runId: 'run_1', provider: 'openrouter', model: 'm', purpose: 'test', inputTokens: 10, outputTokens: 20, estimatedCostUsd: 0.1, latencyMs: 50, errorCode: null });

    expect(db.rows('ai_call_log')).toMatchObject([{ audit_id: 'audit_1', run_id: 'run_1', provider: 'openrouter' }]);
  });

  it('record no lanza si la tabla falla', async () => {
    db.failTable('ai_call_log', 'boom');

    await expect(log.record({ provider: 'p', model: 'm', purpose: 'x', inputTokens: null, outputTokens: null, estimatedCostUsd: null, latencyMs: 1, errorCode: null })).resolves.toBeUndefined();
  });
});
