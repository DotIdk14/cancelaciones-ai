// =============================================================================
// Capa de datos de la revisión humana (`src/server/reviews.ts`) contra un
// cliente InsForge en memoria: una revisión por caso, una comparación por
// revisión, y la fila de comparación se reabre en vez de duplicarse.
// =============================================================================

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createCaseReview,
  DUPLICATE_FINALIZATION_MESSAGE,
  finalizeCaseReview,
  getCaseReview,
  getLatestComparisonForReview,
  insertComparison,
  listComparisonsForCase,
  rearmComparison,
  updateComparisonError,
  updateComparisonResult,
} from '../src/server/reviews';
import { deriveWorkflowState } from '../src/server/dto';
import { createFakeDatabase, type FakeDatabase } from './helpers/fake-database';
import type { InsForgeClient } from '../src/server/insforge';

const INPUT = {
  caseId: 'case-1',
  auditId: 'audit-1',
  result: 'BAJA' as const,
  reviewerName: 'asesor@utel.edu.mx',
  comment: 'Se acredita la baja por solicitud posterior al inicio de ciclo.',
  userId: 'user-test',
};

const COORDINATOR = {
  caseId: 'case-1',
  coordinatorUserId: 'coordinator-test',
  comment: 'De acuerdo con la revisión del asesor.',
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

describe('finalizeCaseReview — la decisión del coordinador, separada e inmutable', () => {
  /** Crea la revisión de asesor que el coordinador va a finalizar. */
  async function seedAdvisorReview(result: 'BAJA' | 'CANCELACION_VENTA' = 'BAJA') {
    return createCaseReview(db.client, { ...INPUT, result });
  }

  it('APPROVE conserva la resolución del asesor y deja la de cambio en NULL', async () => {
    await seedAdvisorReview('BAJA');

    const finalized = await finalizeCaseReview(db.client, { ...COORDINATOR, decision: 'APPROVE', resolution: null });

    expect(finalized.coordinator_decision).toBe('APPROVE');
    // APPROVE NO es "CHANGE con la misma resolución": la columna queda vacía y la
    // del asesor sigue siendo la que gobierna el caso.
    expect(finalized.coordinator_resolution).toBeNull();
    expect(finalized.result).toBe('BAJA');
    expect(deriveWorkflowState(finalized)).toBe('FINALIZED');
    expect(db.rows('case_reviews')).toHaveLength(1);
  });

  it('CHANGE guarda una resolución DISTINTA sin sobrescribir la del asesor', async () => {
    await seedAdvisorReview('BAJA');

    const finalized = await finalizeCaseReview(db.client, {
      ...COORDINATOR,
      decision: 'CHANGE',
      resolution: 'EVIDENCIA_INSUFICIENTE',
    });

    expect(finalized.coordinator_decision).toBe('CHANGE');
    expect(finalized.coordinator_resolution).toBe('EVIDENCIA_INSUFICIENTE');
    // La decisión del asesor se conserva APARTE: no se pierde la traza.
    expect(finalized.result).toBe('BAJA');
    expect(db.rows('case_reviews')).toHaveLength(1);
  });

  it('el actor y la hora los pone el servidor, nunca el que llama', async () => {
    const before = Date.now();
    await seedAdvisorReview();

    const finalized = await finalizeCaseReview(db.client, { ...COORDINATOR, decision: 'APPROVE', resolution: null });

    expect(finalized.coordinator_created_by).toBe('coordinator-test');
    const stamped = Date.parse(finalized.coordinator_created_at ?? '');
    expect(Number.isNaN(stamped)).toBe(false);
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('sin revisión de asesor no hay nada que finalizar: 400 y cero escrituras', async () => {
    await expect(
      finalizeCaseReview(db.client, { ...COORDINATOR, decision: 'APPROVE', resolution: null }),
    ).rejects.toMatchObject({ status: 400, category: 'VALIDATION_ERROR' });
    expect(db.rows('case_reviews')).toHaveLength(0);
  });

  it('CHANGE sin resolución o con la MISMA del asesor: 400 y nada se escribe', async () => {
    for (const resolution of [null, 'BAJA'] as const) {
      db.reset();
      await seedAdvisorReview('BAJA');

      await expect(
        finalizeCaseReview(db.client, { ...COORDINATOR, decision: 'CHANGE', resolution }),
      ).rejects.toMatchObject({ status: 400 });

      const row = await getCaseReview(db.client, 'case-1');
      expect(row?.coordinator_decision ?? null).toBeNull();
      expect(row?.coordinator_created_at ?? null).toBeNull();
      expect(row?.result).toBe('BAJA');
    }
  });

  it('una segunda finalización es 409 estable y NO pisa la decisión ya registrada', async () => {
    await seedAdvisorReview('BAJA');
    const first = await finalizeCaseReview(db.client, { ...COORDINATOR, decision: 'APPROVE', resolution: null });

    await expect(
      finalizeCaseReview(db.client, { ...COORDINATOR, decision: 'CHANGE', resolution: 'TICKET_RECHAZADO' }),
    ).rejects.toMatchObject({ status: 409, category: 'VALIDATION_ERROR' });

    const row = await getCaseReview(db.client, 'case-1');
    expect(row?.coordinator_decision).toBe('APPROVE');
    expect(row?.coordinator_resolution).toBeNull();
    expect(row?.coordinator_created_at).toBe(first.coordinator_created_at);
    expect(row?.result).toBe('BAJA');
    expect(db.rows('case_reviews')).toHaveLength(1);
  });

  it('finalizar no crea una segunda fila de revisión ni toca la comparación', async () => {
    const review = await seedAdvisorReview('BAJA');
    const comparison = await insertComparison(db.client, {
      caseReviewId: review.id,
      auditId: review.audit_id,
      deadlineAt: 'x',
      model: 'google/gemini-2.5-flash-lite',
    });
    await updateComparisonResult(db.client, comparison.id, {
      resultJson: { agrees: true },
      provider: 'openrouter',
      model: 'google/gemini-2.5-flash-lite',
      latencyMs: 100,
    });

    await finalizeCaseReview(db.client, {
      ...COORDINATOR,
      decision: 'CHANGE',
      resolution: 'TICKET_RECHAZADO',
    });

    expect(db.rows('case_reviews')).toHaveLength(1);
    expect(db.rows('case_comparisons')).toHaveLength(1);
    // La comparación sigue siendo la del ASESOR: un CHANGE no la relanza.
    const after = await getLatestComparisonForReview(db.client, review.id);
    expect(after?.result_json).toEqual({ agrees: true });
  });

  it('la revisión recién creada está en PENDING_COORDINATOR, no en FINALIZED', async () => {
    const review = await seedAdvisorReview();
    expect(deriveWorkflowState(review)).toBe('PENDING_COORDINATOR');
    // La INSERT no escribe el bloque del coordinador: si la migración aún no está
    // aplicada la columna ni siquiera viene, y `deriveWorkflowState` lo lee igual
    // que un NULL (`?? null`).
    expect(review.coordinator_decision ?? null).toBeNull();
    expect(review.coordinator_created_by ?? null).toBeNull();
  });
});

describe('finalizeCaseReview — guarda atómica contra la carrera', () => {
  /**
   * La lectura previa y la escritura condicional pueden ver estados distintos
   * (otra finalización ganó entre ambas). `reviews.ts` ejecuta la escritura con
   * `is('coordinator_decision', null)` y traduce "0 filas afectadas" al 409
   * estable. El store en memoria es single-threaded y no puede reproducir esa
   * carrera, así que aquí se dobla SOLO el transporte con un cliente que
   * devuelve una fila libre en la lectura y el resultado que se quiera en la
   * escritura: así se ejecuta el `finalizeCaseReview` REAL.
   */
  function raceClient(write: { data: unknown; error: unknown }): InsForgeClient {
    const advisorReview = {
      id: 'review-race',
      case_id: 'case-1',
      audit_id: 'audit-1',
      result: 'BAJA',
      reviewer_name: null,
      comment: 'x',
      created_at: '2026-02-02T09:00:00.000Z',
      created_by: null,
      coordinator_decision: null,
    };
    let phase: 'read' | 'write' = 'read';
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.is = () => chain;
    chain.limit = () => chain;
    chain.update = () => {
      phase = 'write';
      return chain;
    };
    chain.then = (onOk: (value: unknown) => unknown) =>
      Promise.resolve(phase === 'read' ? { data: [advisorReview], error: null } : write).then(onOk);
    return { database: { from: () => chain } } as unknown as InsForgeClient;
  }

  const INPUT_RACE = {
    caseId: 'case-1',
    decision: 'APPROVE' as const,
    resolution: null,
    comment: 'De acuerdo.',
    coordinatorUserId: 'coordinator-test',
  };

  it('la que pierde la carrera (0 filas afectadas) recibe el MISMO 409 y no muta nada', async () => {
    const error = await finalizeCaseReview(raceClient({ data: [], error: null }), INPUT_RACE).catch(
      (caught: unknown) => caught as { status?: number; category?: string; message?: string },
    );

    expect(error).toMatchObject({ status: 409, category: 'VALIDATION_ERROR' });
    expect(error.message).toBe(DUPLICATE_FINALIZATION_MESSAGE);
  });

  it('un fallo GENUINO del proveedor en el update sigue siendo su error, no un 409', async () => {
    const error = await finalizeCaseReview(
      raceClient({ data: null, error: { statusCode: 503, message: 'proveedor caído' } }),
      INPUT_RACE,
    ).catch((caught: unknown) => caught as { status?: number; category?: string });

    expect(error).toMatchObject({ status: 503, category: 'DATABASE_ERROR' });
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