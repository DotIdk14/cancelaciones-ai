// =============================================================================
// Capa de datos de la revisión humana (`src/server/reviews.ts`) contra un
// cliente InsForge en memoria: una revisión por caso, una comparación por
// revisión, y la fila de comparación se reabre en vez de duplicarse.
// =============================================================================

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createCaseReview,
  getCaseReview,
  getLatestComparisonForReview,
  insertComparison,
  listComparisonsForCase,
  rearmComparison,
  updateComparisonError,
  updateComparisonResult,
} from '../src/server/reviews';
import { createFakeDatabase, type FakeDatabase } from './helpers/fake-database';

const INPUT = {
  caseId: 'case-1',
  auditId: 'audit-1',
  result: 'BAJA' as const,
  comment: 'Se acredita la baja por solicitud posterior al inicio de ciclo.',
  userId: 'user-test',
};

let db: FakeDatabase;

beforeEach(() => {
  db = createFakeDatabase();
});

describe('createCaseReview', () => {
  it('persiste la revisión con su auditoría referenciada', async () => {
    const row = await createCaseReview(db.client, INPUT);

    expect(row.case_id).toBe('case-1');
    expect(row.audit_id).toBe('audit-1');
    expect(row.result).toBe('BAJA');
    expect(db.rows('case_reviews')).toHaveLength(1);
    expect(await getCaseReview(db.client, 'case-1')).toMatchObject({ audit_id: 'audit-1', result: 'BAJA' });
  });

  it('un duplicado devuelve 409 y NO escribe una segunda fila', async () => {
    await createCaseReview(db.client, INPUT);

    await expect(createCaseReview(db.client, { ...INPUT, result: 'CANCELACION_VENTA' })).rejects.toMatchObject({
      status: 409,
      category: 'VALIDATION_ERROR',
    });

    expect(db.rows('case_reviews')).toHaveLength(1);
    // La revisión original conserva su resultado: el duplicado no la pisa ni la borra.
    expect((await getCaseReview(db.client, 'case-1'))?.result).toBe('BAJA');
  });

  it('un caso distinto sí puede tener su propia revisión', async () => {
    await createCaseReview(db.client, INPUT);

    await createCaseReview(db.client, { ...INPUT, caseId: 'case-2' });

    expect(db.rows('case_reviews')).toHaveLength(2);
  });
});

describe('ciclo durable de la comparación', () => {
  it('insertComparison nace RUNNING y el cierre guarda el resultado real', async () => {
    const review = await createCaseReview(db.client, INPUT);

    const running = await insertComparison(db.client, {
      caseReviewId: review.id,
      auditId: review.audit_id,
      deadlineAt: '2026-03-01T10:00:00.000Z',
    });

    expect(running.status).toBe('RUNNING');
    expect(await getLatestComparisonForReview(db.client, review.id)).toMatchObject({ id: running.id, status: 'RUNNING' });

    const done = await updateComparisonResult(db.client, running.id, {
      resultJson: { agrees: true },
      provider: 'openrouter',
      model: 'google/gemini-2.5-flash-lite',
      latencyMs: 4321,
    });

    expect(done.status).toBe('COMPLETED');
    expect(done.result_json).toEqual({ agrees: true });
    expect(done.model).toBe('google/gemini-2.5-flash-lite');
    expect(done.error_category).toBeNull();
    expect(done.latency_ms).toBe(4321);
  });

  it('updateComparisonError borra el resultado parcial y guarda la categoría', async () => {
    const review = await createCaseReview(db.client, INPUT);
    const running = await insertComparison(db.client, { caseReviewId: review.id, auditId: review.audit_id, deadlineAt: 'x' });

    const failed = await updateComparisonError(db.client, running.id, { errorCategory: 'AI_PROVIDER_ERROR', latencyMs: 900 });

    expect(failed.status).toBe('ERROR');
    expect(failed.result_json).toBeNull();
    expect(failed.error_category).toBe('AI_PROVIDER_ERROR');
  });

  it('rearmComparison reabre la MISMA fila: reanudar nunca duplica la comparación', async () => {
    const review = await createCaseReview(db.client, INPUT);
    const running = await insertComparison(db.client, { caseReviewId: review.id, auditId: review.audit_id, deadlineAt: 'x' });
    await updateComparisonError(db.client, running.id, { errorCategory: 'RATE_LIMIT', latencyMs: 10 });

    const rearmed = await rearmComparison(db.client, running.id, { deadlineAt: '2026-03-02T10:00:00.000Z', model: 'otro/modelo' });

    expect(rearmed.id).toBe(running.id);
    expect(rearmed.status).toBe('RUNNING');
    expect(rearmed.error_category).toBeNull();
    expect(rearmed.deadline_at).toBe('2026-03-02T10:00:00.000Z');
    expect(rearmed.model).toBe('otro/modelo');
    expect(db.rows('case_comparisons')).toHaveLength(1);
  });

  it('listComparisonsForCase devuelve la comparación de ESE caso y de ninguno más', async () => {
    const review = await createCaseReview(db.client, INPUT);
    await insertComparison(db.client, { caseReviewId: review.id, auditId: review.audit_id, deadlineAt: 'x' });
    const other = await createCaseReview(db.client, { ...INPUT, caseId: 'case-2', auditId: 'audit-2' });
    await insertComparison(db.client, { caseReviewId: other.id, auditId: other.audit_id, deadlineAt: 'y' });

    const forCase1 = await listComparisonsForCase(db.client, 'case-1');
    const forCase2 = await listComparisonsForCase(db.client, 'case-2');

    expect(forCase1).toHaveLength(1);
    expect(forCase1[0]?.case_review_id).toBe(review.id);
    expect(forCase2[0]?.case_review_id).toBe(other.id);
    expect(await listComparisonsForCase(db.client, 'case-inexistente')).toEqual([]);
  });
});