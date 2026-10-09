// =============================================================================
// Contrato de las rutas /api + observabilidad accionable de un fallo de
// auditoría.
//
// Por qué existe este bloque: en producción una auditoría terminó en
// SCHEMA_VALIDATION_ERROR y el motivo real (qué intento, con qué formato, si el
// proveedor confirmó o no el catálogo de capacidades, cuántos tokens gastó) NO
// aparecía en `vercel logs` ni en ninguna respuesta de la API. Solo quedaba
// en la columna `audits.provider_metadata`, que nadie podía leer.
//
// Estos tests fijan las dos Guarantee de observabilidad:
//   1) un log estructurado y compacto en el camino de error de `runAudit`, y
//   2) `providerMetadata` en `AuditDetailDto`, saneado defensivamente.
// Y fijan el límite duro: ni el log ni la respuesta pueden filtrar prompts,
// expediente, PII ni secretos.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiRequest, type ApiResponse } from '../src/server/http';
import auditHandler from '../api/cases/[caseId]/audit/index';
import evidenceDeleteHandler from '../api/cases/[caseId]/evidence/[evidenceId]/index';
import dashboardHandler from '../api/dashboard/[view]';
import { auditToDto } from '../src/server/dto';
import { runAudit } from '../src/server/audit-service';
import { callOpenRouterAudit, OpenRouterAuditError } from '../src/server/openrouter';
import type { OpenRouterAttemptDiagnostic } from '../src/server/openrouter';
import type { AuditRow } from '../src/server/cases';
import { fakeAuthContext, FAKE_USER_SUB } from './helpers/auth';
import { setTestEnv } from './helpers/env';
import {
  fakeClient,
  listAudits,
  resetStore,
  seedCase,
  seedEvidence,
} from './helpers/fake-store';

// --- Persistencia: store en memoria de `cases`/`evidence`/`audits` -----------
vi.mock('../src/server/cases', async () => {
  const store = await import('./helpers/fake-store');
  return {
    getCaseOr404: store.getCaseOr404,
    getScopedCaseOr404: store.getScopedCaseOr404,
    assertCaseOwner: store.assertCaseOwner,
    getEvidenceOr404: store.getEvidenceOr404,
    listEvidenceRows: store.listEvidenceRows,
    listCaseSummaries: store.listCaseSummaries,
    createCase: store.createCase,
    insertEvidence: store.insertEvidence,
    updateEvidenceStatus: store.updateEvidenceStatus,
    deleteEvidenceRow: store.deleteEvidenceRow,
    persistDerivedExtraction: store.persistDerivedExtraction,
    latestAudit: store.latestAudit,
    latestCompletedAuditByFingerprint: store.latestCompletedAuditByFingerprint,
    latestRunningAuditByFingerprint: store.latestRunningAuditByFingerprint,
    countAuditsByFingerprint: store.countAuditsByFingerprint,
    insertAudit: store.insertAudit,
    updateAuditResult: store.updateAuditResult,
    updateCaseStatus: store.updateCaseStatus,
  };
});

// --- Cliente server-side de InsForge: store aislado, sin red ----------------
vi.mock('../src/server/insforge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/insforge')>();
  const store = await import('./helpers/fake-store');
  return { ...actual, createServerClient: vi.fn(() => store.fakeClient) };
});

// --- AssemblyAI: sin red (no hay audio en estos escenarios) ----------------
vi.mock('../src/server/assemblyai', async () => ({
  submitTranscription: vi.fn(async () => 'assembly-1'),
  getTranscription: vi.fn(async () => ({ state: 'ERROR' as const, transcript: null, error: 'sin transcripción' })),
}));

// --- OpenRouter: se conserva la clase REAL `OpenRouterAuditError` ------------
// `runAudit` decide con `error instanceof OpenRouterAuditError`; si el test
// usara una clase falsa, la ruta de error real nunca quedaría cubierta.
vi.mock('../src/server/openrouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/openrouter')>();
  return { ...actual, callOpenRouterAudit: vi.fn() };
});

const mockedCall = vi.mocked(callOpenRouterAudit);

/** Fake de ServerResponse: res ES el objeto observable (statusCode compartido). */
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

function makeApiRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    url: '/',
    headers: {},
    query: {},
    auth: fakeAuthContext(),
    ...overrides,
  } as unknown as ApiRequest;
}

describe('rutas críticas (validación de método)', () => {
  it('PATCH /audit → 405 (sin crear cliente ni ejecutar la auditoría)', async () => {
    const res = makeApiResponse();
    const req = makeApiRequest({ method: 'PATCH' });

    await auditHandler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET, POST');
  });

  it('GET /evidence → 405', async () => {
    const res = makeApiResponse();
    const req = makeApiRequest({ method: 'GET', query: { caseId: 'c', evidenceId: 'e' } });

    await evidenceDeleteHandler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('DELETE');
  });

  it('PATCH /dashboard/summary → 405 sin parsear filtros ni tocar la base', async () => {
    const res = makeApiResponse();
    // Query deliberadamente inválida: el 405 debe resolverse ANTES de parsear
    // los filtros, para que un método incorrecto nunca llegue a la base.
    // Sin `view` a propósito: el 405 tiene que resolverse antes de validar la
    // vista, igual que antes de parsear los filtros.
    const req = makeApiRequest({ method: 'PATCH', query: { from: 'basura' } });

    await dashboardHandler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
  });

  it('PATCH /dashboard/ai-costs → 405 sin parsear filtros ni tocar la base', async () => {
    const res = makeApiResponse();
    const req = makeApiRequest({ method: 'PATCH', query: { from: 'basura', granularity: 'trimestre' } });

    await dashboardHandler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
  });

  it('GET /dashboard/ai-costs?granularity=trimestre → 400 en español, sin tocar la base', async () => {
    const res = makeApiResponse();
    // Fechas válidas: el 400 tiene que venir de `granularity`, no del rango.
    const req = makeApiRequest({ method: 'GET', query: { view: 'ai-costs', from: '2026-09-01', to: '2026-09-30', granularity: 'trimestre' } });

    await dashboardHandler(req, res);

    expect(res.statusCode).toBe(400);
    const payload = JSON.parse(res.body) as { error: { category: string; message: string } };
    expect(payload.error.category).toBe('VALIDATION_ERROR');
    expect(payload.error.message).toContain('granularity');
    expect(payload.error.message).toContain('day, week, month');
  });

  it('GET /dashboard/ai-costs?granularity=trimestre&granularity=day → 400 (valor repetido)', async () => {
    const res = makeApiResponse();
    const req = makeApiRequest({ method: 'GET', query: { view: 'ai-costs', granularity: ['trimestre', 'day'] } });

    await dashboardHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as { error: { category: string } }).error.category).toBe('VALIDATION_ERROR');
  });

  it('PATCH /dashboard/quality → 405 sin parsear filtros ni tocar la base', async () => {
    const res = makeApiResponse();
    // Query deliberadamente inválida: el 405 tiene que resolverse ANTES de
    // parsear los filtros, igual que en las otras dos rutas de dashboard.
    const req = makeApiRequest({ method: 'PATCH', query: { from: 'basura' } });

    await dashboardHandler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
  });

  it('GET /dashboard/quality?from=basura → 400 en español, sin tocar la base', async () => {
    const res = makeApiResponse();
    const req = makeApiRequest({ method: 'GET', query: { view: 'quality', from: 'basura' } });

    await dashboardHandler(req, res);

    expect(res.statusCode).toBe(400);
    const payload = JSON.parse(res.body) as { error: { category: string; message: string } };
    expect(payload.error.category).toBe('VALIDATION_ERROR');
    expect(payload.error.message).toContain('from');
  });

  it('GET /dashboard/:vista-desconocida → 404 sin tocar la base', async () => {
    const res = makeApiResponse();
    // Vocabulario cerrado: una vista inexistente no se adivina ni se ignora.
    const req = makeApiRequest({ method: 'GET', query: { view: 'inventada' } });

    await dashboardHandler(req, res);

    expect(res.statusCode).toBe(404);
    const payload = JSON.parse(res.body) as { error: { category: string } };
    expect(payload.error.category).toBe('NOT_FOUND');
  });
});

// =============================================================================
// Observabilidad de un fallo de auditoría
// =============================================================================

/**
 * Diagnósticos tal como los produce `openrouter.ts` tras dos intentos:
 * `json_schema` y luego el fallback `json_object` con el modelo de respaldo.
 * Solo hay contadores, estados y motivos YA saneados por el proveedor.
 */
const FALLBACK_DIAGNOSTICS: OpenRouterAttemptDiagnostic[] = [
  {
    model: 'google/gemini-2.5-flash-lite',
    format: 'json_schema',
    status: 200,
    providerErrorType: null,
    finishReason: 'stop',
    latencyMs: 12_480,
    promptTokens: 18_204,
    completionTokens: 4_096,
    totalTokens: 22_300,
    cost: 0.00041,
    maxOutputTokensRequested: 16_384,
    capabilitiesVerified: true,
    retryable: false,
    failureCategory: 'SCHEMA_VALIDATION_ERROR',
    failureReason: 'schema validation failed at audit.supportingEvidenceIds',
    path: 'audit.supportingEvidenceIds',
    detail: null,
  },
  {
    model: 'openai/gpt-4o-mini',
    format: 'json_object',
    status: 200,
    providerErrorType: null,
    finishReason: 'stop',
    latencyMs: 9_120,
    promptTokens: 19_004,
    completionTokens: 3_512,
    totalTokens: 22_516,
    cost: 0.00023,
    maxOutputTokensRequested: 16_384,
    capabilitiesVerified: false,
    retryable: false,
    failureCategory: 'SCHEMA_VALIDATION_ERROR',
    failureReason: 'schema validation failed at facts.0.evidenceIds',
    path: 'facts.0.evidenceIds',
    detail: null,
  },
];

/** Error que habría lanzado el transporte real tras agotar los intentos. */
function makeProviderFailure(): OpenRouterAuditError {
  return new OpenRouterAuditError(
    'SCHEMA_VALIDATION_ERROR',
    FALLBACK_DIAGNOSTICS,
    'OpenRouter no pudo producir un assessment válido.',
  );
}

function makeAuditRow(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: 'audit-1',
    case_id: 'case-1',
    status: 'ERROR',
    provider: 'openrouter',
    model: 'google/gemini-2.5-flash-lite',
    result_json: null,
    error_category: 'SCHEMA_VALIDATION_ERROR',
    latency_ms: 21_700,
    evidence_fingerprint: 'a'.repeat(64),
    attempt_number: 1,
    deadline_at: '2026-02-01T10:10:00Z',
    provider_metadata: null,
    created_at: '2026-02-01T10:00:00Z',
    ...overrides,
  };
}

/** Extrae el objeto estructurado del log de fallo emitido por `runAudit`. */
function parseFailureLog(entries: unknown[][]): Record<string, unknown> {
  const line = entries
    .map((args) => args.map((value) => (typeof value === 'string' ? value : '')).join(' '))
    .find((text) => text.includes('"errorCategory"'));
  expect(line).toBeDefined();
  const json = line?.slice(line?.indexOf('{') ?? 0) ?? '';
  return JSON.parse(json) as Record<string, unknown>;
}

describe('observabilidad: un fallo de auditoría se puede diagnosticar', () => {
  beforeEach(() => {
    setTestEnv();
    resetStore();
    seedCase({ id: 'case-1', student_identifier: 'UTEL-2026-001', created_by: FAKE_USER_SUB });
    seedEvidence({ id: 'ev-1', processing_status: 'READY', content: 'cancelo mi matricula', filename: 'renuncia.txt' });
    mockedCall.mockReset();
    mockedCall.mockRejectedValue(makeProviderFailure());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POST /audit responde 502 y NO filtra el diagnóstico por la respuesta de error', async () => {
    const res = makeApiResponse();

    await auditHandler(makeApiRequest({ method: 'POST', query: { caseId: 'case-1' } }), res);

    expect(res.statusCode).toBe(502);
    const payload = JSON.parse(res.body) as { error: { category: string } };
    expect(payload.error.category).toBe('SCHEMA_VALIDATION_ERROR');
  });

  it('GET /audit expone providerMetadata con los diagnostics del fallback', async () => {
    await auditHandler(makeApiRequest({ method: 'POST', query: { caseId: 'case-1' } }), makeApiResponse());
    const res = makeApiResponse();

    await auditHandler(makeApiRequest({ method: 'GET', query: { caseId: 'case-1' } }), res);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body) as {
      audit: {
        status: string;
        errorCategory: string | null;
        providerMetadata: {
          openrouterAttempts: Array<Record<string, unknown>>;
        } | null;
      };
    };
    expect(payload.audit.status).toBe('ERROR');
    expect(payload.audit.errorCategory).toBe('SCHEMA_VALIDATION_ERROR');
    expect(payload.audit.providerMetadata?.openrouterAttempts).toHaveLength(2);

    const [first, second] = payload.audit.providerMetadata!.openrouterAttempts;
    expect(first).toEqual({
      format: 'json_schema',
      failureCategory: 'SCHEMA_VALIDATION_ERROR',
      status: 200,
      finishReason: 'stop',
      latencyMs: 12_480,
      promptTokens: 18_204,
      completionTokens: 4_096,
      retryable: false,
      capabilitiesVerified: true,
      failureReason: 'schema validation failed at audit.supportingEvidenceIds',
      path: 'audit.supportingEvidenceIds',
      detail: null,
    });
    expect(second).toEqual({
      format: 'json_object',
      failureCategory: 'SCHEMA_VALIDATION_ERROR',
      status: 200,
      finishReason: 'stop',
      latencyMs: 9_120,
      promptTokens: 19_004,
      completionTokens: 3_512,
      retryable: false,
      capabilitiesVerified: false,
      failureReason: 'schema validation failed at facts.0.evidenceIds',
      path: 'facts.0.evidenceIds',
      detail: null,
    });
  });

  it('el log de fallo trae categoría, modelo, latencia y el detalle de cada intento', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(runAudit(fakeClient, 'case-1')).rejects.toBeInstanceOf(ApiError);

    expect(spy).toHaveBeenCalled();
    const payload = parseFailureLog(spy.mock.calls);
    expect(payload).toMatchObject({
      errorCategory: 'SCHEMA_VALIDATION_ERROR',
      model: 'google/gemini-2.5-flash-lite',
    });
    expect(typeof payload.latencyMs).toBe('number');
    const attempts = payload.openrouterAttempts as Array<Record<string, unknown>>;
    expect(attempts).toHaveLength(2);
    for (const attempt of attempts) {
      expect(Object.keys(attempt).sort()).toEqual(
        [
          'capabilitiesVerified',
          'completionTokens',
          'detail',
          'failureCategory',
          'failureReason',
          'finishReason',
          'format',
          'latencyMs',
          'path',
          'promptTokens',
          'retryable',
          'status',
        ].sort(),
      );
    }
    expect(attempts[1]).toMatchObject({ format: 'json_object', capabilitiesVerified: false, latencyMs: 9_120 });
  });

  it('ni el log ni el DTO filtran expediente, PII del estudiante ni el cuerpo crudo del modelo', async () => {
    const rawModelBody = 'RAW_MODEL_BODY {"case":{"matricula":"UTEL-2026-001","studentName":"María Pérez"}}';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedCall.mockRejectedValue(
      new OpenRouterAuditError('SCHEMA_VALIDATION_ERROR', FALLBACK_DIAGNOSTICS, rawModelBody),
    );
    seedCase({ id: 'case-1', student_identifier: 'UTEL-2026-001', created_by: FAKE_USER_SUB });

    await auditHandler(makeApiRequest({ method: 'POST', query: { caseId: 'case-1' } }), makeApiResponse());
    const res = makeApiResponse();
    await auditHandler(makeApiRequest({ method: 'GET', query: { caseId: 'case-1' } }), res);

    const logText = spy.mock.calls.flat().map((value) => (typeof value === 'string' ? value : '')).join(' ');
    const dtoText = res.body;
    for (const forbidden of [
      'UTEL-2026-001',
      'María Pérez',
      'cancelo mi matricula',
      'RAW_MODEL_BODY',
      process.env.OPENROUTER_API_KEY ?? '',
      process.env.INSFORGE_API_KEY ?? '',
    ]) {
      expect(forbidden).not.toBe('');
      expect(logText).not.toContain(forbidden);
      expect(dtoText).not.toContain(forbidden);
    }
  });

  it('el log también sale cuando el fallo no viene de OpenRouter (diagnósticos vacíos)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedCall.mockRejectedValue(new Error('fallo interno con detalle secreto TOP-SECRET'));

    await auditHandler(makeApiRequest({ method: 'POST', query: { caseId: 'case-1' } }), makeApiResponse());

    const payload = parseFailureLog(spy.mock.calls);
    expect(payload).toMatchObject({ errorCategory: 'AI_PROVIDER_ERROR' });
    expect(payload.openrouterAttempts).toEqual([]);
    const logText = spy.mock.calls.flat().map((value) => (typeof value === 'string' ? value : '')).join(' ');
    expect(logText).not.toContain('TOP-SECRET');
  });

  it('un audit COMPLETED conserva los campos previos y suma providerMetadata', async () => {
    const completed = makeAuditRow({
      status: 'COMPLETED',
      error_category: null,
      result_json: { audit: { result: 'DICTAMINACION' } },
      provider_metadata: {
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCostUSD: 0.00012 },
        openrouterAttempts: FALLBACK_DIAGNOSTICS,
      },
    });

    const dto = auditToDto(completed);

    // Contrato público: solo se AGREGA, no se cambia ni se elimina nada.
    expect(Object.keys(dto)).toEqual(
      expect.arrayContaining([
        'id',
        'caseId',
        'status',
        'provider',
        'model',
        'resultJson',
        'errorCategory',
        'latencyMs',
        'evidenceFingerprint',
        'attemptNumber',
        'deadlineAt',
        'createdAt',
        'providerMetadata',
      ]),
    );
    expect(dto.resultJson).toEqual({ audit: { result: 'DICTAMINACION' } });
    expect(dto.providerMetadata).toEqual({
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCostUSD: 0.00012 },
      openrouterAttempts: [
        {
          format: 'json_schema',
          failureCategory: 'SCHEMA_VALIDATION_ERROR',
          status: 200,
          finishReason: 'stop',
          latencyMs: 12_480,
          promptTokens: 18_204,
          completionTokens: 4_096,
          retryable: false,
          capabilitiesVerified: true,
          failureReason: 'schema validation failed at audit.supportingEvidenceIds',
          path: 'audit.supportingEvidenceIds',
          detail: null,
        },
        {
          format: 'json_object',
          failureCategory: 'SCHEMA_VALIDATION_ERROR',
          status: 200,
          finishReason: 'stop',
          latencyMs: 9_120,
          promptTokens: 19_004,
          completionTokens: 3_512,
          retryable: false,
          capabilitiesVerified: false,
          failureReason: 'schema validation failed at facts.0.evidenceIds',
          path: 'facts.0.evidenceIds',
          detail: null,
        },
      ],
    });
  });
});

describe('observabilidad: provider_metadata con forma inesperada no rompe ni filtra', () => {
  it.each([
    ['ausente (undefined)', undefined],
    ['nulo', null],
    ['string', 'provider rejected request'],
    ['número', 42],
    ['array', [1, 2, 3]],
    ['objeto vacío', {}],
    ['solo claves desconocidas', { apiKey: 'sk-live-secreto', prompt: 'expediente completo', raw: '{"a":1}' }],
    ['openrouterAttempts no-array', { openrouterAttempts: 'nope' }],
    ['stale con tipos raros', { stale: 'sí', deadlineAt: 123, fingerprint: {} }],
  ])('%s → providerMetadata null sin lanzar', (_label, providerMetadata) => {
    const dto = auditToDto(makeAuditRow({ provider_metadata: providerMetadata }));

    expect(dto.providerMetadata).toBeNull();
    expect(JSON.stringify(dto)).not.toContain('sk-live-secreto');
    expect(JSON.stringify(dto)).not.toContain('expediente completo');
  });

  it('descarta campos no permitidos y conserva solo los seguros', () => {
    const dto = auditToDto(
      makeAuditRow({
        provider_metadata: {
          openrouterAttempts: [
            {
              format: 'json_schema',
              status: 429,
              finishReason: 'stop',
              latencyMs: 800,
              promptTokens: 1,
              completionTokens: 0,
              retryable: true,
              capabilitiesVerified: true,
              failureCategory: 'RATE_LIMIT',
              failureReason: 'rate limit',
              // Campos que el transporte nunca escribe; no deben viajar a la API.
              prompt: 'PROCEDIMIENTO V5 + expediente',
              content: '{"case":{"studentName":"María Pérez"}}',
              error: 'invalid api_key=sk-live-secreto',
            },
          ],
          // Claves fuera de la lista blanca.
          studentIdentifier: 'UTEL-2026-001',
          evidences: ['renuncia.txt'],
        },
      }),
    );

    expect(dto.providerMetadata).toEqual({
      openrouterAttempts: [
        {
          format: 'json_schema',
          failureCategory: 'RATE_LIMIT',
          status: 429,
          finishReason: 'stop',
          latencyMs: 800,
          promptTokens: 1,
          completionTokens: 0,
          retryable: true,
          capabilitiesVerified: true,
          failureReason: 'rate limit',
          path: null,
          detail: null,
        },
      ],
    });
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain('PROCEDIMIENTO V5');
    expect(serialized).not.toContain('María Pérez');
    expect(serialized).not.toContain('sk-live-secreto');
    expect(serialized).not.toContain('UTEL-2026-001');
  });

  it('un motivo de fallo inesperado se neutraliza en vez de propagarse', () => {
    const dto = auditToDto(
      makeAuditRow({
        provider_metadata: {
          openrouterAttempts: [
            {
              format: 'json_schema',
              failureCategory: 'CATEGORIA_INVENTADA',
              status: '200',
              finishReason: { no: 'es un string' },
              latencyMs: 'lento',
              promptTokens: -5,
              completionTokens: Number.NaN,
              retryable: 'sí',
              capabilitiesVerified: 1,
              failureReason: `x${'y'.repeat(500)}`,
            },
          ],
        },
      }),
    );

    const attempt = dto.providerMetadata?.openrouterAttempts?.[0];
    expect(attempt).toMatchObject({
      format: 'json_schema',
      failureCategory: null,
      status: null,
      finishReason: null,
      promptTokens: null,
      completionTokens: null,
      retryable: false,
      capabilitiesVerified: false,
    });
    expect(typeof attempt?.latencyMs).toBe('number');
    expect(attempt?.failureReason?.length).toBeLessThanOrEqual(200);
  });
});

/** La fila persistida tras el fallo: el ERROR guarda los diagnostics. */
describe('observabilidad: la fila ERROR conserva los diagnostics del fallback', () => {
  beforeEach(() => {
    setTestEnv();
    resetStore();
    seedCase({ id: 'case-1', created_by: FAKE_USER_SUB });
    seedEvidence({ id: 'ev-1', processing_status: 'READY', content: 'cancelo mi matricula' });
    mockedCall.mockReset();
    mockedCall.mockRejectedValue(makeProviderFailure());
  });

  it('provider_metadata guarda openrouterAttempts y la API los sirve igual', async () => {
    await auditHandler(makeApiRequest({ method: 'POST', query: { caseId: 'case-1' } }), makeApiResponse());

    const row = listAudits()[0];
    expect(row?.status).toBe('ERROR');
    expect((row?.provider_metadata as { openrouterAttempts?: unknown[] }).openrouterAttempts).toHaveLength(2);
    expect(auditToDto(row!).providerMetadata?.openrouterAttempts).toHaveLength(2);
  });
});
