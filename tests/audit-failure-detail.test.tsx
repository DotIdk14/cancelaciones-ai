// @vitest-environment jsdom
// =============================================================================
// El fallo de la auditoría tiene que ser legible en el expediente.
//
// Una auditoría murió en producción con `INVALID_EVIDENCE_REFERENCE` y el panel
// sólo decía "referencias de evidencia inexistentes": sin ruta ni id no había
// forma de actionarlo. Estos tests fijan que el panel del dictamen muestre la
// categoría, la ruta y el detalle SANEADO de cada intento fallido, y que no se
// rompa cuando no hay metadatos técnicos.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CaseDetailPage } from '../src/components/CaseDetailPage';
import type { CaseDetailResponse } from '../src/lib/api';

function fakeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function erroredAudit(providerMetadata: unknown): unknown {
  return {
    id: 'audit-1',
    caseId: 'case-1',
    status: 'ERROR',
    provider: 'openrouter',
    model: 'google/gemini-2.5-flash-lite',
    resultJson: null,
    errorCategory: 'INVALID_EVIDENCE_REFERENCE',
    latencyMs: 21_700,
    evidenceFingerprint: null,
    attemptNumber: 1,
    deadlineAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    providerMetadata,
  };
}

function failedAttempt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'json_schema',
    failureCategory: 'INVALID_EVIDENCE_REFERENCE',
    status: 200,
    finishReason: 'stop',
    latencyMs: 9_120,
    promptTokens: 18_204,
    completionTokens: 4_096,
    retryable: false,
    capabilitiesVerified: true,
    failureReason: 'unknown evidence reference at facts.3.evidenceIds: evidencia inexistente ev-falso',
    path: 'facts.3.evidenceIds',
    detail: 'evidencia inexistente ev-falso',
    ...overrides,
  };
}

function buildCase(audit: unknown): CaseDetailResponse {
  return {
    case: {
      id: 'case-1',
      status: 'READY',
      studentIdentifier: 'A12345',
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
    },
    evidences: [
      {
        id: 'ev-1',
        caseId: 'case-1',
        filename: 'llamada.mp3',
        mimeType: 'audio/mpeg',
        sizeBytes: 1234,
        hash: 'deadbeef',
        storagePath: 'evidences/case-1/ev-1',
        processingStatus: 'READY',
        processingError: null,
        transcript: null,
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    ],
    audit,
    audits: [],
    review: null,
    comparison: null,
    effectiveResolution: null,
  } as unknown as CaseDetailResponse;
}

function stubFetch(caseResponse: CaseDetailResponse): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/cases/case-1') && method === 'GET') return fakeResponse(200, caseResponse);
      if (url.endsWith('/api/cases/case-1/area-comments') && method === 'GET') {
        return fakeResponse(200, { comments: [] });
      }
      if (url.endsWith('/api/cases/case-1/review') && method === 'GET') {
        return fakeResponse(200, { review: null, comparison: null, effectiveResolution: null });
      }
      return fakeResponse(404, {});
    }),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
});

describe('Panel de error del dictamen: detalle técnico del fallo', () => {
  it('muestra categoría, ruta y detalle saneado de cada intento fallido', async () => {
    stubFetch(
      buildCase(
        erroredAudit({
          openrouterAttempts: [
            failedAttempt(),
            failedAttempt({
              format: 'json_schema',
              failureCategory: 'SCHEMA_VALIDATION_ERROR',
              failureReason: 'schema validation failed at audit.provisionalResolution: invalid_type',
              path: 'audit.provisionalResolution',
              detail: 'invalid_type',
            }),
            // El intento exitoso no aporta nada que diagnosticar: no se lista.
            failedAttempt({
              failureCategory: null,
              failureReason: null,
              path: null,
              detail: null,
            }),
          ],
        }),
      ),
    );
    render(<CaseDetailPage caseId="case-1" />);

    const panel = await screen.findByRole('region', { name: /detalle técnico del fallo/i });
    expect(panel.textContent).toContain('INVALID_EVIDENCE_REFERENCE');
    expect(panel.textContent).toContain('facts.3.evidenceIds');
    expect(panel.textContent).toContain('evidencia inexistente ev-falso');
    expect(panel.textContent).toContain('SCHEMA_VALIDATION_ERROR');
    expect(panel.textContent).toContain('audit.provisionalResolution');
    expect(panel.textContent).toContain('invalid_type');
    // Y la versión legible de la categoría, no sólo el código.
    expect(panel.textContent).toContain('Referencia de evidencia inválida');
  });

  it('no inventa detalle: sin metadatos técnicos, el panel no aparece', async () => {
    stubFetch(buildCase(erroredAudit(null)));
    render(<CaseDetailPage caseId="case-1" />);

    // El ErrorCard de siempre sigue estando (es la explicación en lenguaje llano).
    expect(await screen.findByText(/referencias de evidencia inexistentes/i)).toBeTruthy();
    expect(screen.queryByRole('region', { name: /detalle técnico del fallo/i })).toBeNull();
  });

  it('tolera un diagnóstico viejo que no trae path ni detail', async () => {
    stubFetch(buildCase(erroredAudit({ openrouterAttempts: [{ format: 'json_schema', failureCategory: 'INVALID_EVIDENCE_REFERENCE', status: 200, failureReason: 'unknown evidence reference' }] })));
    render(<CaseDetailPage caseId="case-1" />);

    // El panel aparece con lo que hay, sin romper por campos ausentes.
    expect(await screen.findByRole('region', { name: /detalle técnico del fallo/i })).toBeTruthy();
  });
});