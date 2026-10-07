// @vitest-environment jsdom
// =============================================================================
// Notas rápidas de Back Office / HelpDesk en la zona de subida de evidencias.
//
// Lo que fija:
//
//   1. La zona ofrece SOLO las dos áreas que el expediente puede usar
//      (Back Office, HelpDesk), no la bitácora completa de cinco áreas: esa
//      sigue viviendo en el panel del dictamen (`AreaComments`).
//   2. Guardar hace UPSERT (POST /area-comments) con `area` y `comment`.
//   3. Si ya existe un dictamen emitido, guardar una nota ADVIERTE que la nota
//      no se incorpora sola: hay que re-auditar el caso. La pista nunca
//      reprograma nada automáticamente (DO_NOT_REPROCESS_AI_UNNECESSARILY).
// =============================================================================

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AreaQuickComments } from '../src/components/AreaQuickComments';
import type { AreaComment } from '../src/lib/api';

function fakeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)));
}

function commentDto(area: string, comment: string): AreaComment {
  return {
    id: `c-${area}`,
    caseId: 'case-1',
    area: area as AreaComment['area'],
    comment,
    createdAt: '2026-10-02T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
});

describe('AreaQuickComments', () => {
  it('ofrece Back Office y HelpDesk, y no la bitácora completa', async () => {
    stubFetch((url, init) => {
      if (init?.method === 'POST') return fakeResponse(201, { comment: commentDto('BACK_OFFICE', 'x') });
      if (url.endsWith('/area-comments')) return fakeResponse(200, { comments: [] });
      return fakeResponse(404, {});
    });

    render(<AreaQuickComments caseId="case-1" hasCompletedAudit={false} />);

    expect(await screen.findByText('Back Office')).toBeTruthy();
    expect(screen.getByText('HelpDesk')).toBeTruthy();
    expect(screen.queryByText('Servicios Escolares')).toBeNull();
    expect(screen.queryByText('Finanzas')).toBeNull();
  });

  it('vuelca lo que ya está guardado en los campos al cargar', async () => {
    stubFetch((url, init) => {
      if (url.endsWith('/area-comments') && init?.method === 'POST') {
        return fakeResponse(201, { comment: commentDto('BACK_OFFICE', 'guardado previo') });
      }
      if (url.endsWith('/area-comments')) {
        return fakeResponse(200, {
          comments: [commentDto('BACK_OFFICE', 'guardado previo'), commentDto('HELPDESK', 'nota de helpdesk')],
        });
      }
      return fakeResponse(404, {});
    });

    render(<AreaQuickComments caseId="case-1" hasCompletedAudit={false} />);

    const boxes = await screen.findAllByRole('textbox');
    expect(boxes).toHaveLength(2);
    expect((boxes[0] as HTMLTextAreaElement).value).toBe('guardado previo');
    expect((boxes[1] as HTMLTextAreaElement).value).toBe('nota de helpdesk');
  });

  it('guarda una nota con UPSERT y muestra confirmación sin dictamen previo', async () => {
    const posts: string[] = [];
    stubFetch((url, init) => {
      if (init?.method === 'POST') {
        posts.push(String(init.body));
        return fakeResponse(201, { comment: commentDto('BACK_OFFICE', 'intento de contacto') });
      }
      if (url.endsWith('/area-comments')) return fakeResponse(200, { comments: [] });
      return fakeResponse(404, {});
    });

    render(<AreaQuickComments caseId="case-1" hasCompletedAudit={false} />);

    const boxes = await screen.findAllByRole('textbox');
    fireEvent.change(boxes[0]!, { target: { value: 'intento de contacto' } });
    fireEvent.click(screen.getAllByRole('button', { name: /guardar/i })[0]!);

    // El notice exacto sin dictamen previo (evita el `Guardado <fecha>` del
    // metadato, que también contiene "guardado" y haría ambiguo el matcher).
    expect(await screen.findByText(/Comentario de Back Office guardado/i)).toBeTruthy();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain('BACK_OFFICE');
    expect(posts[0]).toContain('intento de contacto');
    // Sin dictamen previo, no hay pista de re-auditar.
    expect(screen.queryByText(/re-audita/i)).toBeNull();
  });

  it('advierte que hay que re-auditar cuando ya existe un dictamen emitido', async () => {
    stubFetch((url, init) => {
      if (init?.method === 'POST') return fakeResponse(201, { comment: commentDto('HELPDESK', 'nota') });
      if (url.endsWith('/area-comments')) return fakeResponse(200, { comments: [] });
      return fakeResponse(404, {});
    });

    render(<AreaQuickComments caseId="case-1" hasCompletedAudit={true} />);

    const boxes = await screen.findAllByRole('textbox');
    fireEvent.change(boxes[1]!, { target: { value: 'nota' } });
    fireEvent.click(screen.getAllByRole('button', { name: /guardar/i })[1]!);

    expect(await screen.findByText(/re-audita/i)).toBeTruthy();
  });
});