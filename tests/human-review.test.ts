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
import type { SubmitCaseReviewInput } from '../src/server/comparison-service';
import { deriveEffectiveResolution, deriveWorkflowState } from '../src/server/dto';
import reviewHandler from '../api/cases/[caseId]/review/index';
import comparisonHandler from '../api/cases/[caseId]/comparison/index';
import { setTestEnv } from './helpers/env';
import { validAuditResult } from './fixtures/audit-result';
import { fakeAuthContext, FAKE_COORDINATOR_EMAIL, FAKE_COORDINATOR_SUB, FAKE_USER_EMAIL, FAKE_USER_SUB } from './helpers/auth';
import {
  fakeClient,
  getCase,
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
    finalizeCaseReview: store.finalizeCaseReview,
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

/**
 * Entrada de la etapa de ASESOR para el servicio.
 *
 * El campo de atribución se llama `reviewerEmail` y lo rellena la SESIÓN: es el
 * contrato nuevo (antes era `reviewerName` y lo mandaba el cliente). Tener un
 * único constructor evita que un test escriba por accidente un nombre de cliente.
 */
function advisorInput(overrides: { result: SubmitCaseReviewInput['result']; comment?: string } = { result: 'BAJA' }) {
  return {
    result: overrides.result,
    comment: overrides.comment ?? HUMAN_COMMENT,
    userId: FAKE_USER_SUB,
    reviewerEmail: FAKE_USER_EMAIL,
  };
}

/** Siembra el escenario mínimo auditable: caso + evidencia READY + dictamen. */
function seedAuditableCase(options: { auditId?: string; createdAt?: string; rule?: string } = {}): AuditRow {
  seedCase({ created_by: FAKE_USER_SUB });
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

function makeApiRequest(
  method: string,
  query: Record<string, string>,
  body?: unknown,
  auth = fakeAuthContext(),
): ApiRequest {
  return { method, url: '/', headers: {}, query, body, auth } as unknown as ApiRequest;
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
    seedCase({ created_by: FAKE_USER_SUB });
    seedEvidence({ id: 'ev-1', processing_status: 'READY', content: 'contenido' });
    seedAudit({ id: 'audit-error', status: 'ERROR', result_json: null });

    await expect(
      submitCaseReview(fakeClient, 'case-1', advisorInput({ result: 'BAJA' })),
    ).rejects.toMatchObject({ status: 400, category: 'VALIDATION_ERROR' });

    expect(listReviews()).toHaveLength(0);
  });

  it('registra la revisión apuntando a la auditoría COMPLETED más reciente y arranca la comparación', async () => {
    seedAuditableCase();
    seedAudit({ id: 'audit-nueva', created_at: '2026-02-05T10:10:00Z' });

    const result = await submitCaseReview(fakeClient, 'case-1', advisorInput({ result: 'CANCELACION_VENTA' }));

    expect(result.review.auditId).toBe('audit-nueva');
    expect(result.review.result).toBe('CANCELACION_VENTA');
    expect(result.comparison.status).toBe('COMPLETED');
    // La atribución sale de la SESIÓN (correo), nunca de un nombre del cliente.
    expect(result.review.reviewerName).toBe(FAKE_USER_EMAIL);
    // Registrar la decisión del asesor abre la etapa de finalización.
    expect(result.workflowState).toBe('PENDING_COORDINATOR');
    expect(listReviews()).toHaveLength(1);
    expect(listComparisons()).toHaveLength(1);
  });

  it('una segunda revisión del mismo caso es 409 y no crea fila', async () => {
    seedAuditableCase();
    await submitCaseReview(fakeClient, 'case-1', advisorInput({ result: 'BAJA' }));

    await expect(
      submitCaseReview(fakeClient, 'case-1', advisorInput({ result: 'TICKET_RECHAZADO' })),
    ).rejects.toMatchObject({ status: 409 });

    expect(listReviews()).toHaveLength(1);
    expect(listReviews()[0]?.result).toBe('BAJA');
  });
});

describe('endpoints de revisión y comparación', () => {
  it('POST /review ya no exige nombre de quien revisa: la atribución la pone el servidor', async () => {
    // CONTRATO NUEVO (flujo de dos etapas): el nombre de quien revisa NO viaja en
    // el body. Antes era obligatorio; ahora se deriva de la sesión (`auth.email`),
    // así que un body sin nombre es válido, y no inválido.
    seedAuditableCase();
    const res = makeApiResponse();

    await reviewHandler(makeApiRequest('POST', { caseId: 'case-1' }, { result: 'BAJA', comment: HUMAN_COMMENT }), res);

    expect(res.statusCode).toBe(201);
    const payload = JSON.parse(res.body) as { review: { reviewerName: string | null } };
    expect(payload.review.reviewerName).toBe(FAKE_USER_EMAIL);
    expect(listReviews()).toHaveLength(1);
  });

  it('POST /review con un reviewerName del cliente es 400: la atribución no se acepta', async () => {
    // No se "ignora en silencio": el schema es `strict` y el campo no declarado se
    // rechaza. Un nombre forjado es un cuerpo inválido y, en cualquier caso, jamás
    // se persiste.
    seedAuditableCase();
    const res = makeApiResponse();

    await reviewHandler(
      makeApiRequest('POST', { caseId: 'case-1' }, { result: 'BAJA', reviewerName: ' impostor', comment: HUMAN_COMMENT }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as { error: { category: string } }).error.category).toBe('VALIDATION_ERROR');
    expect(listReviews()).toHaveLength(0);
    expect(mockedCall).not.toHaveBeenCalled();
  });

  it('POST /review con resolución fuera del vocabulario devuelve 400', async () => {
    seedAuditableCase();
    const res = makeApiResponse();

    await reviewHandler(
      makeApiRequest('POST', { caseId: 'case-1' }, { result: 'RESULTADO_INVENTADO', comment: HUMAN_COMMENT }),
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(listReviews()).toHaveLength(0);
  });

  it('POST /review crea la revisión y arranca la comparación en la misma llamada (201)', async () => {
    seedAuditableCase();
    const res = makeApiResponse();

    await reviewHandler(makeApiRequest('POST', { caseId: 'case-1' }, { result: 'BAJA', comment: HUMAN_COMMENT }), res);

    expect(res.statusCode).toBe(201);
    const payload = JSON.parse(res.body) as {
      review: { result: string; reviewerName: string; comment: string };
      comparison: { status: string };
      workflowState: string;
    };
    expect(payload.review.result).toBe('BAJA');
    // La atribución es la de la SESIÓN, no la del body.
    expect(payload.review.reviewerName).toBe(FAKE_USER_EMAIL);
    expect(payload.review.comment).toBe(HUMAN_COMMENT);
    expect(payload.comparison.status).toBe('COMPLETED');
    expect(payload.workflowState).toBe('PENDING_COORDINATOR');
  });

  it('POST /review duplicado devuelve 409 sin crear una segunda revisión', async () => {
    seedAuditableCase();
    await reviewHandler(makeApiRequest('POST', { caseId: 'case-1' }, { result: 'BAJA', comment: HUMAN_COMMENT }), makeApiResponse());
    const res = makeApiResponse();

    // El segundo POST usa un resultado VÁLIDO de la lista de 6 a propósito: lo
    // que se prueba aquí es el DUPLICADO (409), no la validación de contenido.
    await reviewHandler(makeApiRequest('POST', { caseId: 'case-1' }, { result: 'BAJA', comment: HUMAN_COMMENT }), res);

    expect(res.statusCode).toBe(409);
    expect(listReviews()).toHaveLength(1);
  });

  it('GET /review devuelve revisión + comparación + estado del flujo + resolución efectiva', async () => {
    seedAuditableCase();
    await reviewHandler(makeApiRequest('POST', { caseId: 'case-1' }, { result: 'BAJA', comment: HUMAN_COMMENT }), makeApiResponse());
    const res = makeApiResponse();

    await reviewHandler(makeApiRequest('GET', { caseId: 'case-1' }), res);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body) as {
      review: { result: string; coordinatorDecision: string | null };
      comparison: { status: string; resultJson: { agrees: boolean } | null };
      workflowState: string;
      effectiveResolution: { result: string; source: string };
    };
    expect(payload.review.result).toBe('BAJA');
    // El bloque del coordinador viaja aunque esté vacío: la UI no tiene que
    // adivinar si existe o no.
    expect(payload.review.coordinatorDecision).toBeNull();
    expect(payload.comparison.status).toBe('COMPLETED');
    expect(payload.comparison.resultJson?.agrees).toBe(false);
    expect(payload.workflowState).toBe('PENDING_COORDINATOR');
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
      workflowState: string;
      effectiveResolution: { result: string; source: string };
    };
    expect(payload.review).toBeNull();
    expect(payload.comparison).toBeNull();
    expect(payload.workflowState).toBe('PENDING_ADVISOR');
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

// =============================================================================
// Flujo de DOS etapas sobre el endpoint real. La etapa la resuelve el servidor
// (capacidades + fila persistida); el cliente manda el body de SU etapa y nada
// más. Aquí se fija, de punta a punta:
//   PENDING_ADVISOR → asesor → PENDING_COORDINATOR → coordinador → FINALIZED
// =============================================================================

const ASESOR = fakeAuthContext('user');
const COORDINADOR = fakeAuthContext('coordinator', {
  sub: FAKE_COORDINATOR_SUB,
  email: FAKE_COORDINATOR_EMAIL,
});
const GERENTE = fakeAuthContext('manager');

/** Payload del GET: la forma que consume la UI. */
interface ReviewPayload {
  review: {
    result: string;
    reviewerName: string | null;
    comment: string;
    coordinatorDecision: string | null;
    coordinatorResolution: string | null;
    coordinatorCreatedAt: string | null;
    coordinatorComment: string | null;
  } | null;
  workflowState: string;
  effectiveResolution: { result: string; source: string } | null;
}

async function getReview(auth = ASESOR): Promise<ReviewPayload> {
  const res = makeApiResponse();
  await reviewHandler(makeApiRequest('GET', { caseId: 'case-1' }, undefined, auth), res);
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body) as ReviewPayload;
}

async function postReview(
  body: unknown,
  auth = ASESOR,
): Promise<ReturnType<typeof makeApiResponse>> {
  const res = makeApiResponse();
  await reviewHandler(makeApiRequest('POST', { caseId: 'case-1' }, body, auth), res);
  return res;
}

/** Deja el caso en PENDING_COORDINATOR con la revisión del asesor ya escrita. */
function seedAwaitingCoordinator(result: 'BAJA' | 'CANCELACION_VENTA' = 'BAJA') {
  const audit = seedAuditableCase();
  const review = seedReview({ audit_id: audit.id, result, created_by: FAKE_USER_SUB, reviewer_name: FAKE_USER_EMAIL });
  return { audit, review };
}

describe('deriveWorkflowState — se deriva de la fila, no de cases.status', () => {
  it('sin fila de revisión la etapa es PENDING_ADVISOR', () => {
    expect(deriveWorkflowState(null)).toBe('PENDING_ADVISOR');
  });

  it('fila sin decisión de coordinador es PENDING_COORDINATOR', () => {
    expect(deriveWorkflowState(seedReview())).toBe('PENDING_COORDINATOR');
  });

  it('fila con decisión de coordinador es FINALIZED', () => {
    const review = seedReview();
    review.coordinator_decision = 'APPROVE';
    expect(deriveWorkflowState(review)).toBe('FINALIZED');
  });

  it('una columna coordinator_decision ausente (migración sin aplicar) se lee como NULL', () => {
    const review = { ...seedReview() };
    delete review.coordinator_decision;
    expect(deriveWorkflowState(review)).toBe('PENDING_COORDINATOR');
  });
});

describe('etapa 1 · el asesor registra su decisión y abre la finalización', () => {
  it('PENDING_ADVISOR → asesor → PENDING_COORDINATOR', async () => {
    seedAuditableCase();
    expect((await getReview()).workflowState).toBe('PENDING_ADVISOR');

    const res = await postReview({ result: 'BAJA', comment: HUMAN_COMMENT }, ASESOR);

    expect(res.statusCode).toBe(201);
    expect((await getReview()).workflowState).toBe('PENDING_COORDINATOR');
    const row = listReviews()[0];
    expect(row?.result).toBe('BAJA');
    expect(row?.coordinator_decision).toBeNull();
    expect(row?.coordinator_created_at).toBeNull();
  });

  it('la atribución y el actor los pone el servidor: created_by es la sesión y el nombre es su correo', async () => {
    seedAuditableCase();

    await postReview({ result: 'BAJA', comment: HUMAN_COMMENT }, ASESOR);

    const row = listReviews()[0];
    expect(row?.created_by).toBe(FAKE_USER_SUB);
    expect(row?.reviewer_name).toBe(FAKE_USER_EMAIL);
  });

  it('un segundo envío del asesor es 409 estable y NO muta lo ya escrito', async () => {
    seedAuditableCase();
    await postReview({ result: 'BAJA', comment: HUMAN_COMMENT }, ASESOR);
    const before = listReviews()[0];

    // Cuerpo con OTRA resolución válida: lo que se prueba es el conflicto, no la
    // validación de contenido.
    const res = await postReview({ result: 'TICKET_RECHAZADO', comment: 'otra opinión' }, ASESOR);

    expect(res.statusCode).toBe(409);
    const after = listReviews()[0];
    expect(listReviews()).toHaveLength(1);
    expect(after?.result).toBe('BAJA');
    expect(after?.comment).toBe(HUMAN_COMMENT);
    expect(after?.created_at).toBe(before?.created_at);
    // Y tampoco se relanza la comparación: una sola fila por revisión.
    expect(listComparisons()).toHaveLength(1);
  });

  it('la comparación se dispara en la etapa del asesor y compara SU resolución', async () => {
    seedAuditableCase();

    await postReview({ result: 'BAJA', comment: HUMAN_COMMENT }, ASESOR);

    expect(listComparisons()).toHaveLength(1);
    expect(listComparisons()[0]?.status).toBe('COMPLETED');
    expect(sentText()).toContain('BAJA');
  });
});

describe('etapa 2 · el coordinador finaliza cualquier caso', () => {
  it('PENDING_COORDINATOR → APPROVE → FINALIZED conservando la resolución del asesor', async () => {
    seedAwaitingCoordinator('BAJA');

    const res = await postReview({ decision: 'APPROVE', comment: 'De acuerdo con el asesor.' }, COORDINADOR);

    expect(res.statusCode).toBe(200);
    const payload = (await getReview(COORDINADOR)) as ReviewPayload;
    expect(payload.workflowState).toBe('FINALIZED');
    expect(payload.review?.result).toBe('BAJA');
    // APPROVE NO escribe resolución de cambio: la del asesor sigue vigente.
    expect(payload.review?.coordinatorDecision).toBe('APPROVE');
    expect(payload.review?.coordinatorResolution).toBeNull();
    expect(payload.effectiveResolution).toEqual({ result: 'BAJA', source: 'HUMAN' });
  });

  it('CHANGE guarda una resolución DISTINTA y no toca la del asesor', async () => {
    seedAwaitingCoordinator('BAJA');

    const res = await postReview(
      { decision: 'CHANGE', resolution: 'EVIDENCIA_INSUFICIENTE', comment: 'Falta acreditar el retiro.' },
      COORDINADOR,
    );

    expect(res.statusCode).toBe(200);
    const payload = (await getReview(COORDINADOR)) as ReviewPayload;
    expect(payload.workflowState).toBe('FINALIZED');
    expect(payload.review?.coordinatorDecision).toBe('CHANGE');
    expect(payload.review?.coordinatorResolution).toBe('EVIDENCIA_INSUFICIENTE');
    // La decisión del asesor queda APARTE, para no perder la traza de quién propuso qué.
    expect(payload.review?.result).toBe('BAJA');
    expect(payload.review?.comment).toBe('Se acredita la baja por solicitud posterior al inicio de ciclo.');
    expect(payload.effectiveResolution).toEqual({ result: 'EVIDENCIA_INSUFICIENTE', source: 'HUMAN' });
  });

  it('CHANGE sin resolución, con la misma del asesor o inventada: 400 y nada se escribe', async () => {
    for (const body of [
      { decision: 'CHANGE' },
      { decision: 'CHANGE', resolution: 'BAJA' },
      { decision: 'CHANGE', resolution: 'RESULTADO_INVENTADO' },
      { decision: 'APPROVE', resolution: 'BAJA' },
    ]) {
      resetStore();
      mockedCall.mockClear();
      seedAwaitingCoordinator('BAJA');

      const res = await postReview(body, COORDINADOR);

      expect(res.statusCode).toBe(400);
      const row = listReviews()[0];
      expect(row?.coordinator_decision).toBeNull();
      expect(row?.coordinator_created_at).toBeNull();
      expect(row?.result).toBe('BAJA');
    }
  });

  it('una segunda finalización es 409 estable y NO pisa la decisión ya tomada', async () => {
    seedAwaitingCoordinator('BAJA');
    await postReview({ decision: 'APPROVE', comment: 'De acuerdo.' }, COORDINADOR);
    const first = listReviews()[0];

    const res = await postReview({ decision: 'CHANGE', resolution: 'TICKET_RECHAZADO' }, COORDINADOR);

    expect(res.statusCode).toBe(409);
    const after = listReviews()[0];
    expect(after?.coordinator_decision).toBe('APPROVE');
    expect(after?.coordinator_resolution).toBeNull();
    expect(after?.coordinator_created_at).toBe(first?.coordinator_created_at);
    expect(after?.result).toBe('BAJA');
  });

  it('sin revisión de asesor no hay nada que finalizar: 400', async () => {
    seedAuditableCase();

    const res = await postReview({ decision: 'APPROVE' }, COORDINADOR);

    expect(res.statusCode).toBe(400);
    expect(listReviews()).toHaveLength(0);
  });

  it('el coordinador no puede actuar como asesor: su body no vale para la etapa del asesor', async () => {
    seedAuditableCase();

    const res = await postReview({ result: 'BAJA', comment: HUMAN_COMMENT }, COORDINADOR);

    expect(res.statusCode).toBe(400);
    expect(listReviews()).toHaveLength(0);
  });
});

describe('capacidades · quién puede hacer qué en esta pantalla', () => {
  it('el coordinador finaliza el caso de un asesor (lectura global + finalización)', async () => {
    seedAuditableCase({ auditId: 'audit-1' });
    // El caso es del ASESOR; al coordinador no le hace falta ser dueño.
    expect(getCase('case-1')?.created_by).toBe(FAKE_USER_SUB);

    const res = await postReview({ decision: 'APPROVE' }, COORDINADOR);

    expect(res.statusCode).toBe(400); // aún no hay revisión de asesor que finalizar
    expect(listReviews()).toHaveLength(0);
  });

  it('el gerente LEE el flujo pero no lo muta: GET 200, POST 403, nada escrito', async () => {
    seedAwaitingCoordinator('BAJA');

    const read = await getReview(GERENTE);
    expect(read.workflowState).toBe('PENDING_COORDINATOR');
    expect(read.review?.result).toBe('BAJA');

    for (const body of [{ decision: 'APPROVE' }, { decision: 'CHANGE', resolution: 'TICKET_RECHAZADO' }]) {
      const res = await postReview(body, GERENTE);
      expect(res.statusCode).toBe(403);
      expect((JSON.parse(res.body) as { error: { category: string } }).error.category).toBe('AUTH_ERROR');
    }
    // Tampoco puede registrar la etapa del asesor.
    resetStore();
    mockedCall.mockClear();
    seedAuditableCase();
    const asAdvisor = await postReview({ result: 'BAJA' }, GERENTE);
    expect(asAdvisor.statusCode).toBe(403);
    expect(listReviews()).toHaveLength(0);
    expect(mockedCall).not.toHaveBeenCalled();
  });

  it('el asesor sobre el caso de OTRO responde 404, nunca 403', async () => {
    seedAuditableCase();
    // El caso pasa a ser de otro Asesor; el rol sigue siendo `user`.
    const row = getCase('case-1');
    if (row) row.created_by = '00000000-0000-0000-0000-0000-0000000000ff';

    const res = await postReview({ result: 'BAJA', comment: HUMAN_COMMENT }, ASESOR);

    expect(res.statusCode).toBe(404);
    // Ni 403 (que confirmaría que el caso existe) ni una fila escrita.
    expect(listReviews()).toHaveLength(0);
  });

  it('el asesor tampoco LEE el caso de otro: 404 sin filtrar el workflow state', async () => {
    seedAwaitingCoordinator('BAJA');
    const row = getCase('case-1');
    if (row) row.created_by = '00000000-0000-0000-0000-0000-0000000000ff';

    const res = makeApiResponse();
    await reviewHandler(makeApiRequest('GET', { caseId: 'case-1' }, undefined, ASESOR), res);

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('BAJA');
  });
});

describe('atribución · nada de lo que dice el cuerpo se cree', () => {
  it('actor, rol y nombre forjados en el body no se aceptan (strict) y no escriben nada', async () => {
    const forgeries = [
      { result: 'BAJA', comment: HUMAN_COMMENT, reviewerName: 'La jefa' },
      { result: 'BAJA', comment: HUMAN_COMMENT, createdBy: 'otro-actor' },
      { result: 'BAJA', comment: HUMAN_COMMENT, role: 'coordinator' },
      { result: 'BAJA', comment: HUMAN_COMMENT, coordinatorDecision: 'APPROVE' },
      { result: 'BAJA', comment: HUMAN_COMMENT, created_at: '1999-01-01T00:00:00.000Z' },
    ];
    for (const body of forgeries) {
      resetStore();
      mockedCall.mockClear();
      seedAuditableCase();

      const res = await postReview(body, ASESOR);

      expect(res.statusCode).toBe(400);
      expect(listReviews()).toHaveLength(0);
      expect(mockedCall).not.toHaveBeenCalled();
    }
  });

  it('un coordinator_created_at del cliente tampoco: la hora la pone el servidor', async () => {
    seedAwaitingCoordinator('BAJA');
    const before = Date.now();

    const res = await postReview(
      { decision: 'APPROVE', coordinatorCreatedAt: '1999-01-01T00:00:00.000Z', coordinatorCreatedBy: 'otro' },
      COORDINADOR,
    );

    expect(res.statusCode).toBe(400);
    const row = listReviews()[0];
    expect(row?.coordinator_created_at).toBeNull();
    expect(row?.coordinator_created_by).toBeNull();
    expect(row?.coordinator_created_by).not.toBe('otro');
    expect(before).toBeGreaterThan(0);
  });

  it('el servidor sella la hora y el actor de la finalización, no el cliente', async () => {
    seedAwaitingCoordinator('BAJA');
    const before = Date.now();

    const res = await postReview({ decision: 'APPROVE', comment: 'De acuerdo.' }, COORDINADOR);
    const after = Date.now();

    expect(res.statusCode).toBe(200);
    const row = listReviews()[0];
    expect(row?.coordinator_created_by).toBe(FAKE_COORDINATOR_SUB);
    const stamped = Date.parse(row?.coordinator_created_at ?? '');
    expect(Number.isNaN(stamped)).toBe(false);
    // La marca cae dentro de la llamada: no es un valor heredado ni del cliente.
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(after + 1000);
  });

  it('la decisión del coordinador viaja separada y con su propio comentario', async () => {
    seedAwaitingCoordinator('BAJA');

    await postReview({ decision: 'APPROVE', comment: 'Se comparte la lectura del caso.' }, COORDINADOR);

    const payload = await getReview(COORDINADOR);
    expect(payload.review?.comment).toBe('Se acredita la baja por solicitud posterior al inicio de ciclo.');
    expect(payload.review?.coordinatorComment).toBe('Se comparte la lectura del caso.');
  });
});
