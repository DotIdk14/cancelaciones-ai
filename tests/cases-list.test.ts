// =============================================================================
// Listado de casos: resolución efectiva en el summary.
//
// El listado NO hace N+1: carga en batch las revisiones y la auditoría COMPLETED
// más reciente de cada caso, y deriva la resolución efectiva con la MISMA
// función que usa el detalle.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest, ApiResponse } from '../src/server/http';
import casesHandler from '../api/cases/index';
import { setTestEnv } from './helpers/env';
import { validAuditResult } from './fixtures/audit-result';
import { fakeAuthContext, FAKE_USER_SUB, FAKE_COORDINATOR_SUB } from './helpers/auth';
import {
  resetStore,
  seedCase,
  seedAudit,
  seedReview,
  seedEvidence,
  listCaseSummaries as storeListCaseSummaries,
} from './helpers/fake-store';

// --- Persistencia: store en memoria de `cases`, `evidence` y `audits` --------
vi.mock('../src/server/cases', async () => {
  const store = await import('./helpers/fake-store');
  return {
    getCaseOr404: store.getCaseOr404,
    caseOwnedBy: store.caseOwnedBy,
    getScopedCaseOr404: store.getScopedCaseOr404,
    derivedExtractionOf: store.derivedExtractionOf,
    persistDerivedExtraction: store.persistDerivedExtraction,
    assertCaseOwner: store.assertCaseOwner,
    listCaseSummaries: store.listCaseSummaries,
    listCaseSummaryPage: async (client: unknown, auth: { sub: string; role: 'user' | 'coordinator' | 'manager' }, options: { offset: number; limit: number; snapshot: string; status?: string }) => {
      const rows = await store.listCaseSummaries(client, auth) as Array<Record<string, unknown>>;
      const filtered = options.status ? rows.filter((row) => row.status === options.status) : rows;
      return filtered.slice(options.offset, options.offset + options.limit);
    },
    countCaseSummaryStatuses: async (_client: unknown, auth: { sub: string; role: 'user' | 'coordinator' | 'manager' }) => {
      const rows = await store.listCaseSummaries(_client, auth) as Array<Record<string, unknown>>;
      return Object.fromEntries(['ALL', 'DRAFT', 'READY', 'AUDITING', 'COMPLETED', 'ERROR'].map((status) => [
        status,
        status === 'ALL' ? rows.length : rows.filter((row) => row.status === status).length,
      ]));
    },
    countCaseBuckets: async () => ({ ALL: 0, IN_PROGRESS: 0, COMPLETED: 0, ERRORS: 0 }),
    listCaseCreatorOptions: async () => [],
    createCase: store.createCase,
    listEvidenceRows: store.listEvidenceRows,
    getEvidenceOr404: store.getEvidenceOr404,
    insertEvidence: store.insertEvidence,
    updateEvidenceStatus: store.updateEvidenceStatus,
    deleteEvidenceRow: store.deleteEvidenceRow,
    latestAudit: store.latestAudit,
    latestCompletedAudit: store.latestCompletedAudit,
    latestCompletedAuditByFingerprint: store.latestCompletedAuditByFingerprint,
    latestRunningAuditByFingerprint: store.latestRunningAuditByFingerprint,
    countAuditsByFingerprint: store.countAuditsByFingerprint,
    insertAudit: store.insertAudit,
    updateAuditResult: store.updateAuditResult,
    updateCaseStatus: store.updateCaseStatus,
    getAuditById: store.getAuditById,
  };
});

// --- Persistencia: store en memoria de revisiones/comparaciones -------------
vi.mock('../src/server/reviews', async () => {
  const store = await import('./helpers/fake-store');
  return {
    createCaseReview: store.createCaseReview,
    getCaseReview: store.getCaseReview,
    getCaseReviewsForCases: store.getCaseReviewsForCases,
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
  query: Record<string, string> = {},
  body?: unknown,
  auth: ReturnType<typeof fakeAuthContext> = fakeAuthContext(),
): ApiRequest {
  return { method, url: '/', headers: { 'content-type': 'application/json' }, query, body, auth } as unknown as ApiRequest;
}

beforeEach(() => {
  setTestEnv();
  resetStore();
});

describe('GET /api/cases incluye effectiveResolution', () => {
  it('source HUMAN cuando el caso tiene revisión humana', async () => {
    seedCase({ id: 'case-human' });
    seedEvidence({ id: 'ev-1', case_id: 'case-human', processing_status: 'READY' });
    seedAudit({ id: 'audit-human', case_id: 'case-human', resultJson: validAuditResult });
    seedReview({ case_id: 'case-human', audit_id: 'audit-human', result: 'DICTAMINACION' });

    const res = makeApiResponse();
    await casesHandler(makeApiRequest('GET'), res);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body) as { cases: Array<{ id: string; effectiveResolution: { result: string; source: string } | null }> };
    const row = payload.cases.find((c) => c.id === 'case-human');
    expect(row?.effectiveResolution).toEqual({ result: 'DICTAMINACION', source: 'HUMAN' });
  });

  it('source AI cuando el caso tiene auditoría completada y no revisión', async () => {
    seedCase({ id: 'case-ai' });
    seedEvidence({ id: 'ev-1', case_id: 'case-ai', processing_status: 'READY' });
    seedAudit({ id: 'audit-ai', case_id: 'case-ai', resultJson: validAuditResult });

    const res = makeApiResponse();
    await casesHandler(makeApiRequest('GET'), res);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body) as { cases: Array<{ id: string; effectiveResolution: { result: string; source: string } | null }> };
    const row = payload.cases.find((c) => c.id === 'case-ai');
    expect(row?.effectiveResolution).toEqual({ result: 'CANCELACION_VENTA', source: 'AI' });
  });

  it('null cuando el caso no tiene ni auditoría ni revisión', async () => {
    seedCase({ id: 'case-empty' });

    const res = makeApiResponse();
    await casesHandler(makeApiRequest('GET'), res);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body) as { cases: Array<{ id: string; effectiveResolution: { result: string; source: string } | null }> };
    const row = payload.cases.find((c) => c.id === 'case-empty');
    expect(row?.effectiveResolution).toBeNull();
  });
});

/** Lista los casos como los vería `role`, llamando al espejo de producción. */
async function listFor(role: 'user' | 'coordinator' | 'manager'): Promise<unknown[]> {
  return storeListCaseSummaries(undefined, fakeAuthContext(role));
}

describe('POST /api/cases — nombre de estudiante y clasificación protegida', () => {
  it('rechaza alta manual sin un ticket real y no persiste el nombre del cliente', async () => {
    const res = makeApiResponse();
    await casesHandler(makeApiRequest('POST', {}, { studentIdentifier: '000000001', studentName: 'Nombre sintético' }), res);
    expect(res.statusCode).toBe(400);
    expect(await listFor('manager')).toHaveLength(0);
  });

  it('rechaza crear un expediente sin matrícula ni CaVe', async () => {
    const res = makeApiResponse();
    await casesHandler(makeApiRequest('POST', {}, {}), res);
    expect(res.statusCode).toBe(400);
    expect(await listFor('manager')).toHaveLength(0);
  });

  it('rechaza isTest enviado por cliente incluso cuando es booleano', async () => {
    const res = makeApiResponse();
    await casesHandler(makeApiRequest('POST', {}, { isTest: true }), res);

    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as { error: { category: string } }).error.category).toBe('VALIDATION_ERROR');
    expect(await listFor('manager')).toHaveLength(0);
  });

  it('rechaza cualquier forma de isTest enviado por cliente', async () => {
    const res = makeApiResponse();
    await casesHandler(makeApiRequest('POST', {}, { isTest: 1 }), res);

    expect(res.statusCode).toBe(400);
    expect(await listFor('manager')).toHaveLength(0);
  });

  it('sigue rechazando ownership/rol/actor del cliente', async () => {
    for (const key of ['created_by', 'role', 'actor']) {
      const res = makeApiResponse();
      await casesHandler(makeApiRequest('POST', {}, { [key]: 'x' }), res);
      expect(res.statusCode).toBe(400);
    }
    expect(await listFor('manager')).toHaveLength(0);
  });

  it('un Gerente sigue sin poder crear casos', async () => {
    const res = makeApiResponse();
    await casesHandler(makeApiRequest('POST', {}, { isTest: false }, fakeAuthContext('manager')), res);

    expect(res.statusCode).toBe(403);
    expect((JSON.parse(res.body) as { error: { category: string } }).error.category).toBe('AUTH_ERROR');
    expect(await listFor('manager')).toHaveLength(0);
  });
});

describe('GET /api/cases — alcance por capacidad, no por nombre de rol', () => {
  it('un Asesor ve todos los casos', async () => {
    seedCase({ id: 'mio', created_by: FAKE_USER_SUB });
    seedCase({ id: 'ajeno', created_by: FAKE_COORDINATOR_SUB });

    const res = makeApiResponse();
    await casesHandler(makeApiRequest('GET', {}, undefined, fakeAuthContext('user')), res);

    expect(res.statusCode).toBe(200);
    const ids = (JSON.parse(res.body) as { cases: Array<{ id: string }> }).cases.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['mio', 'ajeno']));
  });

  it('un Coordinador ve todos los casos', async () => {
    seedCase({ id: 'mio', created_by: FAKE_USER_SUB });
    seedCase({ id: 'ajeno', created_by: FAKE_COORDINATOR_SUB });

    const res = makeApiResponse();
    await casesHandler(makeApiRequest('GET', {}, undefined, fakeAuthContext('coordinator')), res);

    const ids = (JSON.parse(res.body) as { cases: Array<{ id: string }> }).cases.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['mio', 'ajeno']));
  });

  it('un Gerente ve todos los casos', async () => {
    seedCase({ id: 'mio', created_by: FAKE_USER_SUB });
    seedCase({ id: 'ajeno', created_by: FAKE_COORDINATOR_SUB });

    const res = makeApiResponse();
    await casesHandler(makeApiRequest('GET', {}, undefined, fakeAuthContext('manager')), res);

    const ids = (JSON.parse(res.body) as { cases: Array<{ id: string }> }).cases.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['mio', 'ajeno']));
  });

  it('expone isTest en el listado (real vs prueba)', async () => {
    seedCase({ id: 'real', is_test: false });
    seedCase({ id: 'prueba', is_test: true });

    const res = makeApiResponse();
    await casesHandler(makeApiRequest('GET', {}, undefined, fakeAuthContext('manager')), res);

    const cases = (JSON.parse(res.body) as { cases: Array<{ id: string; isTest: boolean }> }).cases;
    expect(cases.find((c) => c.id === 'real')?.isTest).toBe(false);
    expect(cases.find((c) => c.id === 'prueba')?.isTest).toBe(true);
  });
});

describe('GET /api/cases — bandejas derivadas del flujo humano', () => {
  it('aplica el alcance de Asesor en En Curso, Completados y Errores con datos persistidos', async () => {
    const otherAdvisor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    seedCase({ id: 'assigned-to-me', status: 'DRAFT', assigned_to: FAKE_USER_SUB });
    seedCase({ id: 'assigned-to-other', status: 'DRAFT', created_by: otherAdvisor, assigned_to: otherAdvisor });
    seedEvidence({ case_id: 'assigned-to-me' });
    seedEvidence({ case_id: 'assigned-to-other' });
    seedCase({ id: 'empty-with-ready-status', status: 'READY' });
    seedCase({ id: 'my-final-review', status: 'COMPLETED' });
    seedAudit({ id: 'audit-my-final', case_id: 'my-final-review', resultJson: validAuditResult });
    seedReview({ case_id: 'my-final-review', audit_id: 'audit-my-final', created_by: FAKE_USER_SUB, coordinator_decision: 'APPROVE' });
    seedCase({ id: 'other-final-review', status: 'COMPLETED' });
    seedAudit({ id: 'audit-other-final', case_id: 'other-final-review', resultJson: validAuditResult });
    seedReview({ case_id: 'other-final-review', audit_id: 'audit-other-final', created_by: otherAdvisor, coordinator_decision: 'APPROVE' });
    seedCase({ id: 'my-final-error', status: 'ERROR' });
    seedReview({ case_id: 'my-final-error', created_by: FAKE_USER_SUB, coordinator_decision: 'APPROVE' });
    seedCase({ id: 'other-final-error', status: 'ERROR' });
    seedReview({ case_id: 'other-final-error', created_by: otherAdvisor, coordinator_decision: 'APPROVE' });
    seedCase({ id: 'my-open-error', status: 'ERROR', created_by: FAKE_USER_SUB });
    seedEvidence({ case_id: 'my-open-error' });

    for (const [bucket, expected] of [
      ['IN_PROGRESS', ['assigned-to-me']],
      ['DRAFTS', ['empty-with-ready-status']],
      ['COMPLETED', ['my-final-review', 'my-final-error']],
      ['ERRORS', ['my-open-error']],
    ] as const) {
      const res = makeApiResponse();
      await casesHandler(makeApiRequest('GET', { limit: '20', bucket }, undefined, fakeAuthContext('user')), res);
      expect(res.statusCode).toBe(200);
      const ids = (JSON.parse(res.body) as { cases: Array<{ id: string }> }).cases.map((row) => row.id);
      expect(ids.sort()).toEqual([...expected].sort());
    }
  });

  it('solo Coordinador accede a la lista de cierre y su cursor no se puede usar para otra etapa', async () => {
    for (const id of ['coord-1', 'coord-2']) {
      seedCase({ id, status: 'COMPLETED' });
      seedEvidence({ case_id: id });
      seedAudit({ id: `ai-${id}`, case_id: id, resultJson: validAuditResult });
      seedReview({ case_id: id, audit_id: `ai-${id}` });
    }
    const query = { limit: '1', bucket: 'IN_PROGRESS', stage: 'PENDING_COORDINATOR' };
    for (const role of ['user', 'manager'] as const) {
      const denied = makeApiResponse();
      await casesHandler(makeApiRequest('GET', query, undefined, fakeAuthContext(role)), denied);
      expect(denied.statusCode).toBe(403);
    }
    const first = makeApiResponse();
    await casesHandler(makeApiRequest('GET', query, undefined, fakeAuthContext('coordinator')), first);
    const page = JSON.parse(first.body) as { cases: Array<{ id: string }>; nextCursor: string };
    expect(first.statusCode).toBe(200);
    expect(page.cases).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    const second = makeApiResponse();
    await casesHandler(makeApiRequest('GET', { ...query, cursor: page.nextCursor }, undefined, fakeAuthContext('coordinator')), second);
    expect((JSON.parse(second.body) as typeof page).cases[0]?.id).not.toBe(page.cases[0]?.id);
    const mismatch = makeApiResponse();
    await casesHandler(makeApiRequest('GET', { ...query, stage: 'PENDING_ADVISOR', cursor: page.nextCursor }, undefined, fakeAuthContext('coordinator')), mismatch);
    expect(mismatch.statusCode).toBe(400);
  });

  it('solo incluye dictámenes IA vigentes en Pendientes de Asesor y pagina el siguiente resultado', async () => {
    for (const id of ['ai-1', 'ai-2']) {
      seedCase({ id, status: 'COMPLETED' });
      seedAudit({ id: `audit-${id}`, case_id: id, resultJson: validAuditResult });
    }
    seedCase({ id: 'sin-dictamen', status: 'READY' });
    seedCase({ id: 'ya-revisado', status: 'COMPLETED' });
    seedAudit({ id: 'audit-ya-revisado', case_id: 'ya-revisado', resultJson: validAuditResult });
    seedReview({ case_id: 'ya-revisado', audit_id: 'audit-ya-revisado' });

    const first = makeApiResponse();
    await casesHandler(makeApiRequest('GET', { limit: '1', workflowState: 'PENDING_ADVISOR' }, undefined, fakeAuthContext('coordinator')), first);
    expect(first.statusCode).toBe(200);
    const firstPayload = JSON.parse(first.body) as { cases: Array<{ id: string; workflowState: string }>; nextCursor: string | null };
    expect(firstPayload.cases).toHaveLength(1);
    expect(firstPayload.cases[0]?.workflowState).toBe('PENDING_ADVISOR');
    expect(firstPayload.nextCursor).not.toBeNull();

    const second = makeApiResponse();
    await casesHandler(makeApiRequest('GET', { limit: '1', workflowState: 'PENDING_ADVISOR', cursor: firstPayload.nextCursor! }, undefined, fakeAuthContext('coordinator')), second);
    const secondPayload = JSON.parse(second.body) as { cases: Array<{ id: string }> };
    expect(secondPayload.cases).toHaveLength(1);
    expect(secondPayload.cases[0]?.id).not.toBe(firstPayload.cases[0]?.id);
    expect(['ai-1', 'ai-2']).toContain(secondPayload.cases[0]?.id);
  });

  it('Pendientes de Coordinador contiene la revisión del Asesor y niega la bandeja a otros roles', async () => {
    seedCase({ id: 'reviewed', status: 'COMPLETED' });
    seedAudit({ id: 'audit-reviewed', case_id: 'reviewed', resultJson: validAuditResult });
    seedReview({ case_id: 'reviewed', audit_id: 'audit-reviewed' });
    seedCase({ id: 'unreviewed', status: 'COMPLETED' });
    seedAudit({ id: 'audit-unreviewed', case_id: 'unreviewed', resultJson: validAuditResult });

    const coordinator = makeApiResponse();
    await casesHandler(makeApiRequest('GET', { limit: '10', workflowState: 'PENDING_COORDINATOR' }, undefined, fakeAuthContext('coordinator')), coordinator);
    const rows = (JSON.parse(coordinator.body) as { cases: Array<{ id: string; workflowState: string }> }).cases;
    expect(rows.map((row) => row.id)).toEqual(['reviewed']);
    expect(rows[0]?.workflowState).toBe('PENDING_COORDINATOR');

    const advisor = makeApiResponse();
    await casesHandler(makeApiRequest('GET', { limit: '10', workflowState: 'PENDING_COORDINATOR' }, undefined, fakeAuthContext('user')), advisor);
    expect(advisor.statusCode).toBe(403);
  });
});
