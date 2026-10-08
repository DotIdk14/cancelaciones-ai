// @vitest-environment jsdom
// =============================================================================
// Uploader de evidencias dentro del expediente.
//
// Cubre el refactor del plan 2026-10-08 (Paso 2.10): la secuencia de subida se
// extrajo a `useEvidenceUpload` y la comparte con el alta de caso. Este archivo
// fija el comportamiento observable que NO puede cambiar al reutilizar el motor:
//
//   1. Selección múltiple.
//   2. Carga SECUENCIAL (una petición a la vez, en orden).
//   3. Éxito parcial: el fallo de uno no cancela el resto.
//   4. Fallo total: se informa por archivo.
//   5. Re-selección del MISMO archivo (el input se limpia).
//   6. Progreso anunciado por `aria-live`.
//   7. `onUploaded` se dispara y los errores por archivo no rompen el panel.
// =============================================================================

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EvidenceUploader } from '../src/components/EvidenceUploader';

interface Recorded {
  filename: string | null;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function okEvidence(filename: string): Response {
  return json(201, {
    evidence: {
      id: `ev-${filename}`,
      caseId: 'case-1',
      filename,
      mimeType: 'application/pdf',
      sizeBytes: 8,
      hash: 'h',
      storagePath: 'p',
      processingStatus: 'UPLOADED',
      processingError: null,
      transcript: null,
      createdAt: '2026-10-08T10:00:00.000Z',
    },
  });
}

/**
 * Simula el endpoint de evidencia. `decide` decide por nombre de archivo; el
 * orquestador de la prueba registra el orden y mide la concurrencia real.
 */
function stubEvidence(
  decide: (filename: string) => Response,
  options: { delayMs?: number } = {},
): { recorded: Recorded[]; maxConcurrent: () => number } {
  const recorded: Recorded[] = [];
  let concurrent = 0;
  let peak = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (!url.endsWith('/evidence')) return json(404, { error: { category: 'NOT_FOUND', message: 'no' } });
      const headers = new Headers((init?.headers ?? {}) as HeadersInit);
      const filename = decodeURIComponent(headers.get('x-file-name') ?? '');
      recorded.push({ filename });
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      if ((options.delayMs ?? 0) > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      concurrent -= 1;
      return decide(filename);
    }),
  );

  return { recorded, maxConcurrent: () => peak };
}

const REJECTED = json(400, { error: { category: 'VALIDATION', message: 'Formato no admitido.' } });

async function upload(...names: string[]): Promise<void> {
  const input = screen.getByLabelText(/archivos de evidencia/i, { selector: 'input[type="file"]' });
  await userEvent.upload(input, names.map((name) => new File(['x'], name, { type: 'application/pdf' })));
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
});

describe('EvidenceUploader', () => {
  it('sube varios archivos de una vez, uno por petición y en orden', async () => {
    const { recorded, maxConcurrent } = stubEvidence((filename) => okEvidence(filename), { delayMs: 5 });
    const onUploaded = vi.fn();

    render(<EvidenceUploader caseId="case-1" onUploaded={onUploaded} />);
    await upload('a.pdf', 'b.pdf', 'c.pdf');

    await waitFor(() => {
      expect(recorded).toHaveLength(3);
    });
    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledTimes(1);
    });

    expect(recorded.map((call) => call.filename)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    // Secuencial de verdad: nunca dos subidas en vuelo a la vez.
    expect(maxConcurrent()).toBe(1);
  });

  it('el fallo de un archivo no cancela el resto y se informa archivo por archivo', async () => {
    const { recorded } = stubEvidence((filename) => (filename === 'malo.pdf' ? REJECTED : okEvidence(filename)));
    const onUploaded = vi.fn();

    render(<EvidenceUploader caseId="case-1" onUploaded={onUploaded} />);
    await upload('bueno.pdf', 'malo.pdf', 'otro.pdf');

    await waitFor(() => {
      expect(recorded).toHaveLength(3);
    });
    expect((await screen.findAllByText('Subida')).length).toBe(2);
    // El error se muestra con su categoría y mensaje del servidor.
    expect(await screen.findByText(/VALIDATION · Formato no admitido\./)).toBeTruthy();
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });

  it('informa el fallo total sin romper el panel ni lanzar fuera', async () => {
    stubEvidence(() => REJECTED);
    const onUploaded = vi.fn();

    render(<EvidenceUploader caseId="case-1" onUploaded={onUploaded} />);
    await upload('x.pdf', 'y.pdf');

    // Sin ninguna subida correcta, el resumen lo dice y el callback igual se
    // dispara: el expediente se recarga para reflejar el estado real.
    const live = await screen.findByText(/0 de 2 archivo\(s\) subidos\./);
    expect(live.textContent).toContain('Fallaron: x.pdf, y.pdf.');
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });

  it('anuncia el progreso en una región aria-live', async () => {
    stubEvidence((filename) => okEvidence(filename));

    render(<EvidenceUploader caseId="case-1" />);
    const live = screen.getByRole('status');
    expect(live.getAttribute('aria-live')).toBe('polite');

    await upload('a.pdf');

    await waitFor(() => {
      expect(live.textContent).toContain('1 de 1');
    });
  });

  it('permite volver a seleccionar el mismo archivo', async () => {
    const { recorded } = stubEvidence((filename) => okEvidence(filename));
    render(<EvidenceUploader caseId="case-1" />);

    await upload('repetido.pdf');
    await waitFor(() => {
      expect(recorded).toHaveLength(1);
    });

    // Sin limpiar el input, el navegador no emitiría `change` para el mismo
    // archivo: la segunda selección tiene que llegar al endpoint.
    await upload('repetido.pdf');
    await waitFor(() => {
      expect(recorded).toHaveLength(2);
    });
  });

  it('no duplica la fila del archivo al reintentar un fallo', async () => {
    // Reintento tras fallo total: las filas se RECONCILIAN, no se anteponen.
    let round = 0;
    const { recorded } = stubEvidence((filename) => {
      if (round === 0) return REJECTED;
      return okEvidence(filename);
    });

    render(<EvidenceUploader caseId="case-1" />);
    await upload('a.pdf', 'b.pdf');
    await waitFor(() => {
      expect(recorded).toHaveLength(2);
    });
    expect((await screen.findAllByRole('listitem')).length).toBe(2);

    // Segundo intento sobre los mismos nombres.
    round = 1;
    await upload('a.pdf', 'b.pdf');
    await waitFor(() => {
      expect(recorded).toHaveLength(4);
    });

    // Dos archivos, dos filas: ni cuatro ni nombres duplicados.
    const rows = await screen.findAllByRole('listitem');
    expect(rows.length).toBe(2);
    expect(screen.getAllByText('a.pdf').length).toBe(1);
    expect(screen.getAllByText('b.pdf').length).toBe(1);
    // El fallo anterior no se arrastra: ahora los dos están subidos.
    expect((await screen.findAllByText('Subida')).length).toBe(2);
  });

  it('respeta `disabled` mientras el caso está en error', async () => {
    stubEvidence((filename) => okEvidence(filename));
    render(<EvidenceUploader caseId="case-1" disabled />);
    expect((screen.getByLabelText(/archivos de evidencia/i, { selector: 'input[type="file"]' }) as HTMLInputElement).disabled).toBe(true);
  });
});
