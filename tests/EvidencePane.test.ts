// @vitest-environment jsdom
//
// El visor de evidencia se movió del modal a la columna central. Estos tests
// cubren el comportamiento observable de esa decisión:
//
//   · seleccionar un archivo en la lista lo muestra en la pestaña Evidencias;
//   · cada tipo de evidencia muestra lo que corresponde: la imagen, el audio con
//     su transcripción, el texto plano, y un mensaje honesto para PDF —que aquí
//     se sustituye, porque necesita un PDF real y un worker— y para los tipos sin
//     vista previa.
//
// pdf.js se sustituye con un stub: lo que se prueba aquí es la DECISIÓN DE
// ENRUTADO por tipo, no el parser. El parser tiene su propia cobertura en el
// servidor (`tests/evidence-prep.test.ts`).
//
// Se usa `createElement` en lugar de JSX porque `vitest.config.ts` solo incluye
// `tests/**/*.test.ts`.

import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaseDetailResponse, Evidence } from '../src/lib/api';
import { CaseDetailPage } from '../src/components/CaseDetailPage';

vi.mock('../src/components/PdfCanvas', () => ({
  PdfCanvas: ({ filename }: { filename: string }) =>
    createElement('div', { 'data-testid': 'pdf-stub' }, `PDF listo: ${filename}`),
}));

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function evidence(overrides: Partial<Evidence>): Evidence {
  return {
    id: 'ev-1',
    caseId: 'case-1',
    filename: 'archivo.bin',
    mimeType: 'application/octet-stream',
    sizeBytes: 1024,
    hash: 'abc123',
    storagePath: 'p/archivo.bin',
    processingStatus: 'READY',
    processingError: null,
    transcript: null,
    createdAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function renderPage(evidences: Evidence[]): void {
  const payload: CaseDetailResponse = {
    case: {
      id: 'case-1',
      status: 'IN_PROGRESS',
      studentIdentifier: 'S-1',
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    },
    evidences,
    audits: [],
    audit: null,
    review: null,
    comparison: null,
    effectiveResolution: null,
  };

  fetchSpy.mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/cases/')) {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // El visor de texto plano pide los bytes con fetch.
    return new Response('ORIGINAL: <b>no</b>', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  });

  render(createElement(CaseDetailPage, { caseId: 'case-1' }));
}

async function openEvidence(filename: string): Promise<void> {
  const button = await screen.findByRole('button', { name: new RegExp(filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
  fireEvent.click(button);
}

describe('visor de evidencia en la columna central', () => {
  it('muestra la evidencia en la pestaña del expediente y no en un modal', async () => {
    renderPage([evidence({ filename: 'contrato.pdf', mimeType: 'application/pdf' })]);

    const tab = await screen.findByRole('tab', { name: /Evidencias/ });
    expect(tab.getAttribute('aria-selected')).toBe('true');

    await openEvidence('contrato.pdf');

    await waitFor(() => expect(screen.getByTestId('pdf-stub')).toBeTruthy());
    // Nada de modal: no debe quedar ningún diálogo en el árbol.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('enciende el visor de PDF sin romper las otras cuatro pestañas', async () => {
    renderPage([evidence({ filename: 'contrato.pdf', mimeType: 'application/pdf' })]);
    await openEvidence('contrato.pdf');

    for (const name of [/Evidencias/, /^Hechos/, /Cronología/, /Dictamen/]) {
      expect(screen.getByRole('tab', { name })).toBeTruthy();
    }
    await waitFor(() => expect(screen.getByTestId('pdf-stub')).toBeTruthy());
  });

  it('muestra la imagen con su texto alternativo y la URL de vista previa', async () => {
    renderPage([evidence({ filename: 'foto.png', mimeType: 'image/png' })]);
    await openEvidence('foto.png');

    const image = await screen.findByRole('img', { name: /foto\.png/ });
    expect(image.getAttribute('src')).toBe('/api/evidence/ev-1/download?preview=1');
  });

  it('cambia la evidencia dentro del mismo panel y no abre una ventana aparte', async () => {
    renderPage([
      evidence({ id: 'ev-1', filename: 'frente.png', mimeType: 'image/png' }),
      evidence({ id: 'ev-2', filename: 'reverso.png', mimeType: 'image/png' }),
    ]);
    fireEvent.click(await screen.findByRole('tab', { name: /Evidencias/ }));
    const panel = document.querySelector('.case-evidence-viewer-region');
    expect(panel).not.toBeNull();

    await openEvidence('frente.png');
    expect(await screen.findByRole('img', { name: /frente\.png/ })).toBeTruthy();
    const originalUrl = window.location.href;

    await openEvidence('reverso.png');

    expect(document.querySelector('.case-evidence-viewer-region')).toBe(panel);
    expect(await screen.findByRole('img', { name: /reverso\.png/ })).toBeTruthy();
    expect(screen.queryByRole('img', { name: /frente\.png/ })).toBeNull();
    expect(window.location.href).toBe(originalUrl);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('muestra el audio junto a su transcripción', async () => {
    renderPage([
      evidence({
        filename: 'llamada.mp3',
        mimeType: 'audio/mpeg',
        transcript: { transcript: 'Contenido transcrito.', durationSeconds: 12, speakers: [] },
      }),
    ]);
    await openEvidence('llamada.mp3');

    expect(await screen.findByText('Contenido transcrito.')).toBeTruthy();
  });

  it('trae el texto plano y lo muestra literal, sin interpretar HTML', async () => {
    renderPage([evidence({ filename: 'nota.txt', mimeType: 'text/plain' })]);
    await openEvidence('nota.txt');

    await waitFor(() => expect(screen.getByText(/ORIGINAL: <b>no<\/b>/)).toBeTruthy());
    // Si el contenido se interpretara como HTML, esto sería un elemento <b>.
    expect(screen.queryByText('no', { selector: 'b' })).toBeNull();
  });

  // Documenta una rareza de `kindFromMime`, no un comportamiento deseable:
  // su fallback es 'TEXT', así que un MIME desconocido NUNCA llega a la rama
  // "no tiene vista previa" — se trata como texto plano. En producción es
  // inalcanzable igual, porque `verifyFileSignature` solo deja pasar la
  // allowlist de MIME al subir. Se prueba el comportamiento real para que un
  // cambio futuro en `kindFromMime` rompa este test y obligue a decidir.
  it('trata un MIME desconocido como texto plano, no como error', async () => {
    renderPage([evidence({ filename: 'raro.xyz', mimeType: 'application/x-raro' })]);
    await openEvidence('raro.xyz');

    await waitFor(() => expect(screen.getByText(/ORIGINAL: <b>no<\/b>/)).toBeTruthy());
    expect(screen.queryByText(/no tiene vista previa/i)).toBeNull();
  });
});
