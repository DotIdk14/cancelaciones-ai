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
import {
  fakeClient,
  resetStore,
  seedCase,
  seedAudit,
  seedReview,
  seedEvidence,
} from './helpers/fake-store';

// --- Persistencia: store en memoria de `cases`, `evidence` y `audits` --------
vi.mock('../src/server/cases', async () => {
  const store = await import('./helpers/fake-store');
  return {
    getCaseOr404: store.getCaseOr404,
    listCaseSummaries: store.listCaseSummaries,
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

function makeApiRequest(method: string, query: Record<string, string> = {}, body?: unknown): ApiRequest {
  return { method, url: '/', headers: {}, query, body } as unknown as ApiRequest;
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
