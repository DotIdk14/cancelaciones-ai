// @vitest-environment jsdom
// =============================================================================
// Confirmación previa al auditar cuando no hay notas de Back Office / HelpDesk.
//
// Lo que fija:
//   1. Sin comentarios guardados, "Auditar con IA" muestra una confirmación
//      inline (no modal) y NO dispara startAudit.
//   2. "Auditar sin notas" sí dispara startAudit.
//   3. Con un comentario de BACK_OFFICE guardado, audita directo sin confirmar.
//   4. AreaQuickComments es visible fuera del <details> de "Adjuntar evidencias".
// =============================================================================

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CaseDetailPage } from '../src/components/CaseDetailPage';
import type { AreaComment, CaseDetailResponse } from '../src/lib/api';

function fakeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function buildCase(): CaseDetailResponse {
  return {
    case: {
      canWrite: true,
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
    audit: null,
    audits: [],
    review: null,
    comparison: null,
    effectiveResolution: null,
  };
}

function areaComment(area: string, text: string): AreaComment {
  return {
    id: `c-${area}`,
    caseId: 'case-1',
    area: area as AreaComment['area'],
    comment: text,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  };
}

function stubFetch(
  caseResponse: CaseDetailResponse,
  areaComments: AreaComment[],
  auditPosts: { status: number; body: unknown }[] = [],
): { auditPostCount: () => number } {
  let postIndex = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.endsWith('/api/cases/case-1') && method === 'GET') {
        return fakeResponse(200, caseResponse);
      }
      if (url.endsWith('/api/cases/case-1/area-comments') && method === 'GET') {
        return fakeResponse(200, { comments: areaComments });
      }
      if (url.endsWith('/api/cases/case-1/review') && method === 'GET') {
        return fakeResponse(200, { review: null, comparison: null, effectiveResolution: null });
      }
      if (url.endsWith('/api/cases/case-1/audit') && method === 'POST') {
        const response = auditPosts[postIndex] ?? { status: 200, body: { audit: { status: 'RUNNING' } } };
        postIndex += 1;
        return fakeResponse(response.status, response.body);
      }
      return fakeResponse(404, {});
    }),
  );
  return {
    auditPostCount: () => postIndex,
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
});

describe('CaseDetailPage · confirmación antes de auditar', () => {
  it('sin comentarios, muestra confirmación y NO dispara startAudit', async () => {
    const tracker = stubFetch(buildCase(), []);
    render(<CaseDetailPage caseId="case-1" />);

    const auditButton = await screen.findByRole('button', { name: /auditar con ia/i });
    expect(auditButton.disabled).toBe(false);

    await userEvent.click(auditButton);

    expect(await screen.findByText(/No hay notas de Back Office ni HelpDesk/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /agregar notas ahora/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /auditar sin notas/i })).toBeTruthy();
    expect(tracker.auditPostCount()).toBe(0);
  });

  it('"Auditar sin notas" dispara la auditoría', async () => {
    const audit = {
      id: 'audit-1',
      caseId: 'case-1',
      status: 'RUNNING',
      provider: 'openrouter',
      model: 'test',
      resultJson: null,
      errorCategory: null,
      latencyMs: null,
      evidenceFingerprint: null,
      attemptNumber: 1,
      deadlineAt: null,
      createdAt: '2026-10-01T10:00:00.000Z',
    };
    const tracker = stubFetch(buildCase(), [], [{ status: 200, body: { audit } }]);
    render(<CaseDetailPage caseId="case-1" />);

    await userEvent.click(await screen.findByRole('button', { name: /auditar con ia/i }));
    await userEvent.click(await screen.findByRole('button', { name: /auditar sin notas/i }));

    expect(tracker.auditPostCount()).toBe(1);
    expect(screen.queryByText(/No hay notas de Back Office ni HelpDesk/i)).toBeNull();
  });

  it('con comentario BACK_OFFICE guardado, audita directo sin confirmación', async () => {
    const audit = {
      id: 'audit-2',
      caseId: 'case-1',
      status: 'RUNNING',
      provider: 'openrouter',
      model: 'test',
      resultJson: null,
      errorCategory: null,
      latencyMs: null,
      evidenceFingerprint: null,
      attemptNumber: 1,
      deadlineAt: null,
      createdAt: '2026-10-01T10:00:00.000Z',
    };
    const tracker = stubFetch(buildCase(), [areaComment('BACK_OFFICE', 'intenté contactar al alumno')], [
      { status: 200, body: { audit } },
    ]);
    render(<CaseDetailPage caseId="case-1" />);

    await userEvent.click(await screen.findByRole('button', { name: /auditar con ia/i }));

    expect(tracker.auditPostCount()).toBe(1);
    expect(screen.queryByText(/No hay notas de Back Office ni HelpDesk/i)).toBeNull();
  });

  it('AreaQuickComments queda fuera del <details> colapsado de evidencias', async () => {
    stubFetch(buildCase(), []);
    render(<CaseDetailPage caseId="case-1" />);

    const heading = await screen.findByRole('heading', {
      name: /Notas para la auditoría \(Back Office y HelpDesk\)/i,
    });
    expect(heading.closest('details')).toBeNull();

    const detailsToggle = screen.getByText(/Adjuntar evidencias/i).closest('details');
    expect(detailsToggle).toBeTruthy();
    expect(detailsToggle?.contains(heading)).toBe(false);
  });
});
