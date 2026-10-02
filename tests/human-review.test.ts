// =============================================================================
// Revisión humana y comparación con IA — orquestación durable y endpoints.
//
// Lo que estos tests fijan, y que es la parte fácil de romper sin darse cuenta:
//
//   1. La comparación evalúa el dictamen de `case_reviews.audit_id`, NUNCA el de
//      la auditoría más reciente del caso.
//   2. Una revisión humana por caso y una comparación por revisión: reanudar o
//      reintentar abre la MISMA fila, nunca crea una segunda.
//   3. La resolución efectiva se DERIVA en lectura y NO modifica el dictamen.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest, ApiResponse } from '../src/server/http';
import type { AuditRow } from '../src/server/cases';
import { callOpenRouterAudit } from '../src/server/openrouter';
import { retryComparison, startComparison, submitCaseReview } from '../src/server/comparison-service';
import { deriveEffectiveResolution } from '../src/server/dto';
import reviewHandler from '../api/cases/[caseId]/review/index';
import comparisonHandler from '../api/cases/[caseId]/comparison/index';
import { setTestEnv } from './helpers/env';
import { validAuditResult } from './fixtures/audit-result';
import { fakeAuthContext, FAKE_USER_SUB } from './helpers/auth';
import {
  fakeClient,
  listAudits,
  listComparisons,
  listReviews,
  resetStore,
  seedAudit,
  seedCase,
  seedComparison,
  seedEvidence,
  seedReview,
  updateAuditResult,
  updateComparisonError,
} from './helpers/fake-store';

// --- Persistencia de casos/evidencias/auditorías: store en memoria -------------
vi.mock('../src/server/cases', async () => {
  const store = await import('./helpers/fake-store');
  return {
    getCaseOr404: store.getCaseOr404,
    getScopedCaseOr404: store.getScopedCaseOr404,
    derivedExtractionOf: store.derivedExtractionOf,
    persistDerivedExtraction: store.persistDerivedExtraction,
    assertCaseOwner: store.assertCaseOwner,
    listCaseSummaries: store.listCaseSummaries,
    createCase: store.createCase,
    listEvidenceRows: store.listEvidenceRows,
    getEvidenceOr404: store.getEvidenceOr404,
    insertEvidence: store.insertEvidence,
    updateEvidenceStatus: store.updateEvidenceStatus,
    deleteEvidenceRow: store.deleteEvidenceRow,
    latestAudit: store.latestAudit,
    latestCompletedAuditByFingerprint: store.latestCompletedAuditByFingerprint,
    latestRunningAuditByFingerprint: store.latestRunningAuditByFingerprint,
    countAuditsByFingerprint: store.countAuditsByFingerprint,
    insertAudit: store.insertAudit,
    updateAuditResult: store.updateAuditResult,
    updateCaseStatus: store.updateCaseStatus,
    getAuditById: store.getAuditById,
    latestCompletedAudit: store.latestCompletedAudit,
  };
});

// --- Persistencia de revisiones/comparaciones: store en memoria --------------
vi.mock('../src/server/reviews', async () => {
  const store = await import('./helpers/fake-store');
  return {
    createCaseReview: store.createCaseReview,
    getCaseReview: store.getCaseReview,
    insertComparison: store.insertComparison,
    getLatestComparisonForReview: store.getLatestComparisonForReview,
    rearmComparison: store.rearmComparison,
    updateComparisonResult: store.updateComparisonResult,
    updateComparisonError: store.updateComparisonError,
    listComparisonsForCase: store.listComparisonsForCase,
  };
});

// --- Cliente server-side de InsForge: store aislado, sin red ----------------
vi.mock('../src/server/insforge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/insforge')>();
  const store = await import('./helpers/fake-store');
  return { ...actual, createServerClient: vi.fn(() => store.fakeClient) };
});

// --- OpenRouter: el modelo responde con una comparación válida --------------
vi.mock('../src/server/openrouter', () => ({
  callOpenRouterAudit: vi.fn(),
  OpenRouterAuditError: class OpenRouterAuditError extends Error {},
}));

const mockedCall = vi.mocked(callOpenRouterAudit);

const HUMAN_COMMENT =
  'La persona responsable revisó el expediente y considera acreditado el contacto efectivo previo.';

const validComparison = {
  agrees: false,
  explanation: 'El dictamen original no consideró el contacto efectivo previo que la persona acreditó en el expediente.',
  confidence: 0.74,
  discrepancyReason: 'El dictamen original aplicó la baja sin evaluar el supuesto de solicitud previa al inicio.',
  procedureSections: ['5.3', '5.8'],
  evidenceIds: ['ev-1'],
};

const NO_USAGE = { promptTokens: 800, completionTokens: 120, totalTokens: 920, estimatedCostUSD: 0.0003 };

/** Siembra el escenario mínimo auditable: caso + evidencia READY + dictamen. */
function seedAuditableCase(options: { auditId?: string; createdAt?: string; rule?: string } = {}): AuditRow {
  seedCase();
  seedEvidence({ id: 'ev-1', processing_status: 'READY', content: 'El estudiante solicita cancelar la matrícula.' });
  return seedAudit({
    id: options.auditId ?? 'audit-1',
    created_at: options.createdAt ?? '2026-02-01T10:10:00Z',
    resultJson: options.rule
      ? { ...validAuditResult, audit: { ...validAuditResult.audit, rule: options.rule } }
      : validAuditResult,
  });
}

function makeApiResponse(): ApiResponse & { statusCode: number; body: string } {
  const fake = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader: (name: string, value: unknown) => {
      fake.headers[name] = String(value);
    },
    appendHeader: (name: string, value: unknown) => {
      fake.headers[name] = String(value);
    },
    end: (chunk?: unknown) => {
      fake.body =
        typeof chunk === 'string'
          ? chunk
          : chunk instanceof Buffer
            ? chunk.toString('utf-8')
            : '';
    },
  };
  return fake as unknown as ApiResponse & { statusCode: number; body: string };
}

function makeApiRequest(method: string, query: Record<string, string>, body?: unknown): ApiRequest {
  return { method, url: '/', headers: {}, query, body, auth: fakeAuthContext() } as unknown as ApiRequest;
}

/** System prompt + expediente tal como se enviaron al modelo en la llamada `index`. */
function sentText(call = 0): string {
  const { system, parts } = mockedCall.mock.calls[call]?.[0] as unknown as {
    system: string;
    parts: Array<{ type: string; text?: string }>;
  };
  return [system, ...parts.map((part) => part.text ?? '')].join('\n');
}

beforeEach(() => {
  setTestEnv();
  resetStore();
  mockedCall.mockReset();
  mockedCall.mockResolvedValue({
    parsed: validComparison,
    model: 'google/gemini-2.5-flash-lite',
    usage: NO_USAGE,
  });
});

// =============================================================================
describe('startComparison — los cuatro caminos', () => {
  it('sin revisión humana responde 400 y ni siquiera abre la fila de comparación', async () => {
    seedAuditableCase();

    await expect(startComparison(fakeClient, 'case-1')).rejects.toMatchObject({
      status: 400,
      category: 'VALIDATION_ERROR',
    });

    expect(listComparisons()).toHaveLength(0);
    expect(mockedCall).not.toHaveBeenCalled();
  });

  it('sin comparación previa: crea RUNNING, llama al modelo y termina en done', async () => {
    seedAuditableCase();
    seedReview({ audit_id: 'audit-1', result: 'DICTAMINACION', comment: HUMAN_COMMENT });

    const outcome = await startComparison(fakeClient, 'case-1');

    expect(outcome.phase).toBe('done');
    expect(outcome.comparison.status).toBe('COMPLETED');
    // UNA fila: se abrió en RUNNING antes del modelo y se cerró sobre esa misma fila.
    expect(listComparisons()).toHaveLength(1);
    expect(mockedCall).toHaveBeenCalledTimes(1);
  });

  it('con comparación RUNNING vigente devuelve running sin volver a llamar al modelo', async () => {
    seedAuditableCase();
    const review = seedReview({ audit_id: 'audit-1' });
    seedComparison({
      case_review_id: review.id,
      audit_id: 'audit-1',
      status: 'RUNNING',
      created_at: new Date().toISOString(),
      deadline_at: new Date(Date.now() + 60_000).toISOString(),
    });

    const outcome = await startComparison(fakeClient, 'case-1');

    expect(outcome.phase).toBe('running');
    // DO_NOT_REPROCESS_AI_UNNECESSARILY: una comparación viva no se relanza.
    expect(mockedCall).not.toHaveBeenCalled();
    expect(listComparisons()).toHaveLength(1);
  });

  it('con comparación COMPLETED devuelve done y reutiliza el resultado durable', async () => {
    seedAuditableCase();
    const review = seedReview({ audit_id: 'audit-1' });
    seedComparison({
      case_review_id: review.id,
      audit_id: 'audit-1',
      status: 'COMPLETED',
      result_json: { ...validComparison, model: { provider: 'openrouter', model: 'previo' } },
    });

    const outcome = await startComparison(fakeClient, 'case-1');

    expect(outcome.phase).toBe('done');
    expect(mockedCall).not.toHaveBeenCalled();
    expect(listComparisons()).toHaveLength(1);
  });

  it('con comparación ERROR devuelve error y NO relanza nada por su cuenta', async () => {
    seedAuditableCase();
    const review = seedReview({ audit_id: 'audit-1' });
    seedComparison({
      case_review_id: review.id,
      audit_id: 'audit-1',
      status: 'ERROR',
      error_category: 'RATE_LIMIT',
    });

    const outcome = await startComparison(fakeClient, 'case-1');

    expect(outcome.phase).toBe('error');
    expect(outcome.phase === 'error' && outcome.errorCategory).toBe('RATE_LIMIT');
    // Reintentar es una decisión EXPLÍCITA de quien llama, no un efecto secundario.
    expect(mockedCall).not.toHaveBeenCalled();
    expect(listComparisons()).toHaveLength(1);
  });

  it('una comparación RUNNING caducada se retoma SOBRE LA MISMA fila (cero duplicados)', async () => {
    seedAuditableCase();
    const review = seedReview({ audit_id: 'audit-1' });
    const stale = seedComparison({
      case_review_id: review.id,
      audit_id: 'audit-1',
      status: 'RUNNING',
      created_at: '2026-02-02T09:00:00.000Z',
      deadline_at: '2026-02-02T09:10:00.000Z',
    });

    const outcome = await startComparison(fakeClient, 'case-1');

    expect(outcome.phase).toBe('done');
    expect(mockedCall).toHaveBeenCalledTimes(1);
    expect(listComparisons()).toHaveLength(1);
    expect(listComparisons()[0]?.id).toBe(stale.id);
  });

  it('una revisión cuya auditoría no es COMPLETED no es revisable: 409', async () => {
    seedAuditableCase();
    const review = seedReview({ audit_id: 'audit-1' });
    seedComparison({ case_review_id: review.id, audit_id: 'audit-1', status: 'RUNNING' });
    // La auditoría referenciada deja de estar COMPLETED (RUNNING en curso o ERROR).
    await updateAuditResult(fakeClient, 'audit-1', {
      status: 'ERROR',
      result_json: null,
      error_category: 'AI_PROVIDER_ERROR',
      latency_ms: 0,
    });

    await expect(startComparison(fakeClient, 'case-1')).rejects.toMatchObject({ status: 409 });
    expect(mockedCall).not.toHaveBeenCalled();
  });
});

describe('startComparison — expediente desde case_reviews.audit_id', () => {
  it('compara el dictamen REFERENCIADO por la revisión, no el de la auditoría más reciente', async () => {
    seedAuditableCase({ auditId: 'audit-referenciada', createdAt: '2026-02-01T10:10:00Z', rule: 'REGLA-REFERENCIADA' });
    seedAudit({
      id: 'audit-reciente',
      created_at: '2026-02-09T10:10:00Z',
      resultJson: { ...validAuditResult, audit: { ...validAuditResult.audit, rule: 'REGLA-RECIENTE' } },
    });
    seedReview({ audit_id: 'audit-referenciada', result: 'CANCELACION_VENTA', comment: HUMAN_COMMENT });

    await startComparison(fakeClient, 'case-1');

    const text = sentText();
    expect(text).toContain('REGLA-REFERENCIADA');
    expect(text).not.toContain('REGLA-RECIENTE');
    // La resolución humana y su comentario entran al expediente...
    expect(text).toContain('CANCELACION_VENTA');
    expect(text).toContain(HUMAN_COMMENT);
    // ...junto al Procedimiento V5 completo y al bloque anti prompt-injection.
    expect(text).toContain('# Procedimiento V5');
    expect(text.toLowerCase()).toContain('no confiable');
  });

  it('rechaza que la comparación cite evidencia que no existe en el expediente', async () => {
    seedAuditableCase();
    seedReview({ audit_id: 'audit-1' });
    mockedCall.mockResolvedValue({
      parsed: { ...validComparison, evidenceIds: ['ev-inventada'] },
      model: 'google/gemini-2.5-flash-lite',
      usage: NO_USAGE,
    });

    await expect(startComparison(fakeClient, 'case-1')).rejects.toMatchObject({
      category: 'INVALID_AI_RESPONSE',
    });

    // La fila durable queda en ERROR (no huérfana en RUNNING) y es reintentable.
    expect(listComparisons()).toHaveLength(1);
    expect(listComparisons()[0]?.status).toBe('ERROR');
  });

  it('un fallo del proveedor deja la comparación en ERROR y no fabrica veredicto', async () => {
    seedAuditableCase();
    seedReview({ audit_id: 'audit-1' });
    mockedCall.mockRejectedValue(new Error('HTTP 429 rate_limit_exceeded'));

    await expect(startComparison(fakeClient, 'case-1')).rejects.toThrow();

    expect(listComparisons()[0]?.status).toBe('ERROR');
    expect(listComparisons()[0]?.result_json).toBeNull();
    // MAX_PROVIDER_ATTEMPTS = 2 vive en el transporte: el servicio no reintenta.
    expect(mockedCall).toHaveBeenCalledTimes(1);
  });
});

describe('retryComparison — sólo desde ERROR', () => {
  it('reintenta una comparación en ERROR sin duplicar revisión ni comparación', async () => {
    seedAuditableCase();
    const review = seedReview({ audit_id: 'audit-1', result: 'BAJA' });
    const failed = seedComparison({
      case_review_id: review.id,
      audit_id: 'audit-1',
      status: 'ERROR',
      error_category: 'AI_PROVIDER_ERROR',
    });

    const comparison = await retryComparison(fakeClient, 'case-1');

    expect(comparison.status).toBe('COMPLETED');
    expect(mockedCall).toHaveBeenCalledTimes(1);
    expect(listReviews()).toHaveLength(1);
    expect(listComparisons()).toHaveLength(1);
    // Se reabrió la fila existente, no se creó otra.
    expect(listComparisons()[0]?.id).toBe(failed.id);
    expect(listComparisons()[0]?.error_category).toBeNull();
  });

  it('desde COMPLETED no es reintentable: 400 y cero llamadas al modelo', async () => {
    seedAuditableCase();
    const review = seedReview({ audit_id: 'audit-1' });
    seedComparison({ case_review_id: review.id, audit_id: 'audit-1', status: 'COMPLETED' });

    await expect(retryComparison(fakeClient, 'case-1')).rejects.toMatchObject({ status: 400 });

    expect(mockedCall).not.toHaveBeenCalled();
    expect(listComparisons()).toHaveLength(1);
  });

  it('RUNNING vigente se devuelve tal cual, sin relanzar ni duplicar fila', async () => {
    seedAuditableCase();
    const review = seedReview({ audit_id: 'audit-1' });
    const running = seedComparison({
      case_review_id: review.id,
      audit_id: 'audit-1',
      status: 'RUNNING',
      deadline_at: new Date(Date.now() + 60_000).toISOString(),
    });

    const comparison = await retryComparison(fakeClient, 'case-1');

    expect(comparison.status).toBe('RUNNING');
    expect(comparison.id).toBe(running.id);
    expect(mockedCall).not.toHaveBeenCalled();
    expect(listComparisons()).toHaveLength(1);
  });

  it('RUNNING caducada se reintenta sobre la misma fila', async () => {
    seedAuditableCase();
    const review = seedReview({ audit_id: 'audit-1' });
    const stale = seedComparison({
      case_review_id: review.id,
      audit_id: 'audit-1',
      status: 'RUNNING',
      created_at: '2026-02-02T09:00:00.000Z',
      deadline_at: '2026-02-02T09:10:00.000Z',
    });

    const comparison = await retryComparison(fakeClient, 'case-1');

    expect(comparison.status).toBe('COMPLETED');
    expect(mockedCall).toHaveBeenCalledTimes(1);
    expect(listComparisons()).toHaveLength(1);
    expect(listComparisons()[0]?.id).toBe(stale.id);
  });

  it('superado el tope de reintentos devuelve 429 sin llamar al modelo', async () => {
    seedAuditableCase();
    const review = seedReview({ audit_id: 'audit-1' });
    seedComparison({
      case_review_id: review.id,
      audit_id: 'audit-1',
      status: 'ERROR',
      error_category: 'AI_PROVIDER_ERROR',
      attempt_count: 4,
    });

    await expect(retryComparison(fakeClient, 'case-1')).rejects.toMatchObject({
      status: 429,
      category: 'RATE_LIMIT',
    });
    expect(mockedCall).not.toHaveBeenCalled();
  });

  it('sin comparación previa tampoco es reintentable: 400', async () => {
    seedAuditableCase();
    seedReview({ audit_id: 'audit-1' });

    await expect(retryComparison(fakeClient, 'case-1')).rejects.toMatchObject({ status: 400 });

    expect(listComparisons()).toHaveLength(0);
    expect(mockedCall).not.toHaveBeenCalled();
  });

  it('sin revisión humana tampoco hay nada que reintentar: 400', async () => {
    seedAuditableCase();

    await expect(retryComparison(fakeClient, 'case-1')).rejects.toMatchObject({ status: 400 });

    expect(listComparisons()).toHaveLength(0);
  });
});

describe('submitCaseReview — una revisión por caso', () => {
  it('sin auditoría COMPLETED devuelve 400 y no registra nada', async () => {
    seedCase();
    seedEvidence({ id: 'ev-1', processing_status: 'READY', content: 'contenido' });
    seedAudit({ id: 'audit-error', status: 'ERROR', result_json: null });

    await expect(
      submitCaseReview(fakeClient, 'case-1', { result: 'BAJA', reviewerName: 'Revisora de pruebas', comment: HUMAN_COMMENT, userId: FAKE_USER_SUB }),
    ).rejects.toMatchObject({ status: 400, category: 'VALIDATION_ERROR' });

    expect(listReviews()).toHaveLength(0);
  });

  it('registra la revisión apuntando a la auditoría COMPLETED más reciente y arranca la comparación', async () => {
    seedAuditableCase();
    seedAudit({ id: 'audit-nueva', created_at: '2026-02-05T10:10:00Z' });

    const result = await submitCaseReview(fakeClient, 'case-1', { result: 'DICTAMINACION', reviewerName: 'Revisora de pruebas', comment: HUMAN_COMMENT, userId: FAKE_USER_SUB });

    expect(result.review.auditId).toBe('audit-nueva');
    expect(result.review.result).toBe('DICTAMINACION');
    expect(result.comparison.status).toBe('COMPLETED');
    expect(listReviews()).toHaveLength(1);
    expect(listComparisons()).toHaveLength(1);
  });

  it('una segunda revisión del mismo caso es 409 y no crea fila', async () => {
    seedAuditableCase();
    await submitCaseReview(fakeClient, 'case-1', { result: 'BAJA', reviewerName: 'Revisora de pruebas', comment: HUMAN_COMMENT, userId: FAKE_USER_SUB });

    await expect(
      submitCaseReview(fakeClient, 'case-1', { result: 'DICTAMINACION', reviewerName: 'Revisora de pruebas', comment: HUMAN_COMMENT, userId: FAKE_USER_SUB }),
    ).rejects.toMatchObject({ status: 409 });

    expect(listReviews()).toHaveLength(1);
    expect(listReviews()[0]?.result).toBe('BAJA');
  });
});

describe('endpoints de revisión y comparación', () => {
  it('POST /review sin nombre de quien revisa devuelve 400', async () => {
    seedAuditableCase();
    const res = makeApiResponse();

    await reviewHandler(makeApiRequest('POST', { caseId: 'case-1' }, { result: 'BAJA', comment: HUMAN_COMMENT }), res);

    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as { error: { category: string } }).error.category).toBe('VALIDATION_ERROR');
    expect(listReviews()).toHaveLength(0);
    expect(mockedCall).not.toHaveBeenCalled();
  });

  it('POST /review con resolución fuera del vocabulario devuelve 400', async () => {
    seedAuditableCase();
    const res = makeApiResponse();

    await reviewHandler(
      makeApiRequest('POST', { caseId: 'case-1' }, { result: 'RESULTADO_INVENTADO', reviewerName: 'Revisora de pruebas', comment: HUMAN_COMMENT }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(listReviews()).toHaveLength(0);
  });

  it('POST /review crea la revisión y arranca la comparación en la misma llamada (201)', async () => {
    seedAuditableCase();
    const res = makeApiResponse();

    await reviewHandler(makeApiRequest('POST', { caseId: 'case-1' }, { result: 'BAJA', reviewerName: 'Revisora de pruebas', comment: HUMAN_COMMENT }), res);

    expect(res.statusCode).toBe(201);
    const payload = JSON.parse(res.body) as { review: { result: string; reviewerName: string; comment: string }; comparison: { status: string } };
    expect(payload.review.result).toBe('BAJA');
    expect(payload.review.reviewerName).toBe('Revisora de pruebas');
    expect(payload.review.comment).toBe(HUMAN_COMMENT);
    expect(payload.comparison.status).toBe('COMPLETED');
  });

  it('POST /review duplicado devuelve 409 sin crear una segunda revisión', async () => {
    seedAuditableCase();
    await reviewHandler(makeApiRequest('POST', { caseId: 'case-1' }, { result: 'BAJA', reviewerName: 'Revisora de pruebas', comment: HUMAN_COMMENT }), makeApiResponse());
    const res = makeApiResponse();

    await reviewHandler(makeApiRequest('POST', { caseId: 'case-1' }, { result: 'DICTAMINACION', reviewerName: 'Revisora de pruebas', comment: HUMAN_COMMENT }), res);

    expect(res.statusCode).toBe(409);
    expect(listReviews()).toHaveLength(1);
  });

  it('GET /review devuelve revisión + comparación + resolución efectiva', async () => {
    seedAuditableCase();
    await reviewHandler(makeApiRequest('POST', { caseId: 'case-1' }, { result: 'BAJA', reviewerName: 'Revisora de pruebas', comment: HUMAN_COMMENT }), makeApiResponse());
    const res = makeApiResponse();

    await reviewHandler(makeApiRequest('GET', { caseId: 'case-1' }), res);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body) as {
      review: { result: string };
      comparison: { status: string; resultJson: { agrees: boolean } | null };
      effectiveResolution: { result: string; source: string };
    };
    expect(payload.review.result).toBe('BAJA');
    expect(payload.comparison.status).toBe('COMPLETED');
    expect(payload.comparison.resultJson?.agrees).toBe(false);
    expect(payload.effectiveResolution).toEqual({ result: 'BAJA', source: 'HUMAN' });
  });

  it('GET /review sin revisión devuelve nulls y la resolución de la IA, no un 404', async () => {
    seedAuditableCase();
    const res = makeApiResponse();

    await reviewHandler(makeApiRequest('GET', { caseId: 'case-1' }), res);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body) as {
      review: unknown;
      comparison: unknown;
      effectiveResolution: { result: string; source: string };
    };
    expect(payload.review).toBeNull();
    expect(payload.comparison).toBeNull();
    expect(payload.effectiveResolution).toEqual({ result: 'CANCELACION_VENTA', source: 'AI' });
  });

  it('GET /review sana una comparación RUNNING caducada y POST /comparison la retoma', async () => {
    seedAuditableCase();
    const review = seedReview({ audit_id: 'audit-1', result: 'BAJA' });
    seedComparison({
      case_review_id: review.id,
      audit_id: 'audit-1',
      status: 'RUNNING',
      created_at: '2026-02-02T09:00:00.000Z',
      deadline_at: '2026-02-02T09:10:00.000Z',
    });

    const getRes = makeApiResponse();
    await reviewHandler(makeApiRequest('GET', { caseId: 'case-1' }), getRes);
    expect(getRes.statusCode).toBe(200);
    const getPayload = JSON.parse(getRes.body) as { comparison: { status: string } };
    expect(getPayload.comparison.status).toBe('ERROR');
    expect(mockedCall).not.toHaveBeenCalled();

    const postRes = makeApiResponse();
    await comparisonHandler(makeApiRequest('POST', { caseId: 'case-1' }), postRes);
    expect(postRes.statusCode).toBe(200);
    const postPayload = JSON.parse(postRes.body) as { comparison: { status: string } };
    expect(postPayload.comparison.status).toBe('COMPLETED');
    expect(listComparisons()).toHaveLength(1);
  });

  it('POST /comparison reintenta sólo desde ERROR (200) y es 400 desde COMPLETED', async () => {
    seedAuditableCase();
    const review = seedReview({ audit_id: 'audit-1', result: 'BAJA' });
    const done = seedComparison({
      case_review_id: review.id,
      audit_id: 'audit-1',
      status: 'COMPLETED',
      result_json: { ...validComparison, model: { provider: 'openrouter', model: 'previo' } },
    });

    const notRetryable = makeApiResponse();
    await comparisonHandler(makeApiRequest('POST', { caseId: 'case-1' }), notRetryable);
    expect(notRetryable.statusCode).toBe(400);
    expect(mockedCall).not.toHaveBeenCalled();

    // La misma fila pasa a ERROR y entonces sí es reintentable.
    const row = listComparisons()[0];
    if (row) {
      await updateComparisonError(fakeClient, row.id, {
        errorCategory: 'AI_PROVIDER_ERROR',
        latencyMs: 0,
      });
    }
    const retried = makeApiResponse();
    await comparisonHandler(makeApiRequest('POST', { caseId: 'case-1' }), retried);

    expect(retried.statusCode).toBe(200);
    expect((JSON.parse(retried.body) as { comparison: { status: string } }).comparison.status).toBe('COMPLETED');
    expect(listReviews()).toHaveLength(1);
    expect(listComparisons()).toHaveLength(1);
    expect(listComparisons()[0]?.id).toBe(done.id);
  });

  it('POST /comparison rechaza 409 si la auditoría de la revisión no está COMPLETED', async () => {
    seedAuditableCase();
    const review = seedReview({ audit_id: 'audit-1' });
    seedComparison({ case_review_id: review.id, audit_id: 'audit-1', status: 'ERROR', error_category: 'RATE_LIMIT' });
    // Aunque la comparación esté en ERROR (reintentable), la revisabilidad se
    // comprueba ANTES: si el dictamen dejó de existir, no se reintenta.
    await updateAuditResult(fakeClient, 'audit-1', {
      status: 'ERROR',
      result_json: null,
      error_category: 'AI_PROVIDER_ERROR',
      latency_ms: 0,
    });

    const res = makeApiResponse();
    await comparisonHandler(makeApiRequest('POST', { caseId: 'case-1' }), res);

    expect(res.statusCode).toBe(409);
    expect(mockedCall).not.toHaveBeenCalled();
    expect(listReviews()).toHaveLength(1);
    expect(listComparisons()).toHaveLength(1);
    expect(listComparisons()[0]?.status).toBe('ERROR');
  });

  it('POST /comparison nunca crea una segunda revisión', async () => {
    seedAuditableCase();
    const review = seedReview({ audit_id: 'audit-1' });
    seedComparison({ case_review_id: review.id, audit_id: 'audit-1', status: 'ERROR', error_category: 'RATE_LIMIT' });

    const res = makeApiResponse();
    await comparisonHandler(makeApiRequest('POST', { caseId: 'case-1' }), res);

    expect(res.statusCode).toBe(200);
    expect(listReviews()).toHaveLength(1);
    expect(listComparisons()).toHaveLength(1);
  });

  it('PATCH /review → 405 sin tocar la base', async () => {
    const res = makeApiResponse();

    await reviewHandler(makeApiRequest('PATCH', { caseId: 'case-1' }), res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET, POST');
    expect(listReviews()).toHaveLength(0);
  });

  it('GET /comparison → 405', async () => {
    const res = makeApiResponse();

    await comparisonHandler(makeApiRequest('GET', { caseId: 'case-1' }), res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('POST');
  });
});

describe('effectiveResolution — se deriva en lectura, no muta el dictamen', () => {
  it('sin revisión humana la resolución efectiva es la de la auditoría (source AI)', () => {
    const audit = seedAuditableCase();

    expect(deriveEffectiveResolution(null, audit)).toEqual({
      result: 'CANCELACION_VENTA',
      source: 'AI',
    });
  });

  it('con revisión humana manda la persona aunque el dictamen diga otra cosa', () => {
    const audit = seedAuditableCase();
    const review = seedReview({ audit_id: 'audit-1', result: 'DICTAMINACION' });

    expect(deriveEffectiveResolution(review, audit)).toEqual({ result: 'DICTAMINACION', source: 'HUMAN' });
    // El dictamen original sigue intacto: la revisión no reescribe la auditoría.
    expect((audit.result_json as { audit: { result: string } }).audit.result).toBe('CANCELACION_VENTA');
  });

  it('sin auditoría completada no inventa resolución efectiva', () => {
    expect(deriveEffectiveResolution(null, null)).toBeNull();
    expect(deriveEffectiveResolution(null, { status: 'ERROR', result_json: null } as never)).toBeNull();
  });
});
