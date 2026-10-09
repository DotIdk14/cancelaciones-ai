// @vitest-environment jsdom
// =============================================================================
// Motor de subida de evidencias (`useEvidenceUpload`).
//
// Cubre la validación de tipo MIME ANTES de enviar al servidor: un archivo que
// el picker no debería haber permitido (pero que el SO/browser puede dejar pasar
// con drag-and-drop o `Cmd+A`) se rechaza localmente con un mensaje accionable,
// sin llamar al endpoint ni consumir cuota/transcripción.
// =============================================================================

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEvidenceUpload } from '../src/lib/useEvidenceUpload';
import { readEvidenceHead } from '../src/shared/evidence-formats';

const ISO_BMFF_BYTES = new Uint8Array([
  0x00, 0x00, 0x00, 0x00,
  ...new TextEncoder().encode('ftypM4A '),
]);
const WEBM_BYTES = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
const MP3_FRAME_BYTES = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);

vi.mock('../src/shared/evidence-formats', async () => {
  const actual = await vi.importActual<typeof import('../src/shared/evidence-formats')>(
    '../src/shared/evidence-formats',
  );
  return {
    ...actual,
    readEvidenceHead: vi.fn((...args: Parameters<typeof actual.readEvidenceHead>) =>
      actual.readEvidenceHead(...args),
    ),
  };
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ evidence: {} }), { status: 201 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(readEvidenceHead).mockRestore();
});

describe('useEvidenceUpload · validación previa al envío', () => {
  it('rechaza archivos con MIME no soportado sin llamar al servidor', async () => {
    const { result } = renderHook(() => useEvidenceUpload());
    const file = new File(['x'], 'diagrama.svg', { type: 'image/svg+xml' });

    let outcome: Awaited<ReturnType<typeof result.current.runUploads>> | undefined;
    await act(async () => {
      outcome = await result.current.runUploads('case-1', [file]);
    });

    expect(outcome).toBeDefined();
    expect(outcome!.uploaded).toBe(0);
    expect(outcome!.failed).toHaveLength(1);
    expect(outcome!.failed[0]?.file.name).toBe('diagrama.svg');
    expect(outcome!.failed[0]?.category).toBe('UPLOAD_ERROR');
    expect(outcome!.failed[0]?.message).toMatch(/no soportado/i);

    // Validación fail-closed: el fetch nunca se invoca para tipos rechazados.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('deja pasar los archivos con MIME soportado al endpoint', async () => {
    const { result } = renderHook(() => useEvidenceUpload());
    const file = new File(['x'], 'solicitud.pdf', { type: 'application/pdf' });

    await act(async () => {
      await result.current.runUploads('case-1', [file]);
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toMatch(/\/api\/cases\/case-1\/evidence$/);
  });

  it('ISO-BMFF declarado como video/mp4 se rechaza localmente sin cuota', async () => {
    const { result } = renderHook(() => useEvidenceUpload());
    const file = new File([ISO_BMFF_BYTES], 'clip.mp4', { type: 'video/mp4' });

    let outcome: Awaited<ReturnType<typeof result.current.runUploads>> | undefined;
    await act(async () => {
      outcome = await result.current.runUploads('case-1', [file]);
    });

    expect(outcome).toBeDefined();
    expect(outcome!.uploaded).toBe(0);
    expect(outcome!.failed).toHaveLength(1);
    expect(outcome!.failed[0]?.file.name).toBe('clip.mp4');
    expect(outcome!.failed[0]?.category).toBe('UPLOAD_ERROR');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('EBML declarado video/webm se rechaza localmente sin llamar al servidor', async () => {
    const { result } = renderHook(() => useEvidenceUpload());
    const file = new File([WEBM_BYTES], 'clip.webm', { type: 'video/webm' });

    let outcome: Awaited<ReturnType<typeof result.current.runUploads>> | undefined;
    await act(async () => {
      outcome = await result.current.runUploads('case-1', [file]);
    });

    expect(outcome).toBeDefined();
    expect(outcome!.uploaded).toBe(0);
    expect(outcome!.failed).toHaveLength(1);
    expect(outcome!.failed[0]?.file.name).toBe('clip.webm');
    expect(outcome!.failed[0]?.category).toBe('UPLOAD_ERROR');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('EBML declarado audio/webm se acepta y llega al servidor', async () => {
    const { result } = renderHook(() => useEvidenceUpload());
    const file = new File([WEBM_BYTES], 'grabacion.webm', { type: 'audio/webm' });

    await act(async () => {
      await result.current.runUploads('case-1', [file]);
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('MP3 declarado audio/mpeg se acepta y llega al servidor', async () => {
    const { result } = renderHook(() => useEvidenceUpload());
    const file = new File([MP3_FRAME_BYTES], 'llamada.mp3', { type: 'audio/mpeg' });

    await act(async () => {
      await result.current.runUploads('case-1', [file]);
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fallo al leer la cabecera marca la fila en error y el lote continúa', async () => {
    vi.mocked(readEvidenceHead).mockRejectedValueOnce(new Error('No se pudo leer el archivo'));

    const { result } = renderHook(() => useEvidenceUpload());
    const badFile = new File(['x'], 'borrado.txt', { type: 'text/plain' });
    const goodFile = new File(['y'], 'solicitud.pdf', { type: 'application/pdf' });

    let outcome: Awaited<ReturnType<typeof result.current.runUploads>> | undefined;
    await act(async () => {
      outcome = await result.current.runUploads('case-1', [badFile, goodFile]);
    });

    expect(outcome).toBeDefined();
    expect(outcome!.uploaded).toBe(1);
    expect(outcome!.failed).toHaveLength(1);
    expect(outcome!.failed[0]?.file.name).toBe('borrado.txt');
    expect(outcome!.failed[0]?.category).toBe('UNKNOWN');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
  });
});
