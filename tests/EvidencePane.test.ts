// @vitest-environment jsdom
//
// El visor de evidencia se movió del modal a la columna central. Estos tests
// cubren el comportamiento observable de esa decisión:
//
//   · pulsar "Ver" en la lista abre el archivo en una pestaña, no en un modal;
//   · la pestaña "Evidencia" no existe mientras no haya nada abierto (sería un
//     destino sin contenido);
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
  const button = await screen.findByRole('button', { name: new RegExp(`Ver ${filename}`) });
  fireEvent.click(button);
}

describe('visor de evidencia en la columna central', () => {
  it('abre la evidencia en una pestaña y no en un modal', async () => {
    renderPage([evidence({ filename: 'contrato.pdf', mimeType: 'application/pdf' })]);

    // Antes de abrir, la pestaña no debe existir: sería un destino vacío.
    expect(screen.queryByRole('tab', { name: /Evidencia/ })).toBeNull();

    await openEvidence('contrato.pdf');

    const tab = await screen.findByRole('tab', { name: /Evidencia/ });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(screen.getByTestId('pdf-stub')).toBeTruthy());
    // Nada de modal: no debe quedar ningún diálogo en el árbol.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('enciende el visor de PDF sin romper las otras cuatro pestañas', async () => {
    renderPage([evidence({ filename: 'contrato.pdf', mimeType: 'application/pdf' })]);
    await openEvidence('contrato.pdf');

    for (const name of [/Transcripción/, /Hechos y checks/, /Cronología/, /Dictamen/]) {
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