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

const ISO_BMFF_BYTES = new Uint8Array([
  0x00, 0x00, 0x00, 0x00,
  ...new TextEncoder().encode('ftypM4A '),
]);

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ evidence: {} }), { status: 201 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
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
});
