// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { captureEvidenceFile, readEvidenceHead, resolveEvidenceMime } from '../src/shared/evidence-formats';
import { toErrorState, uploadEvidence } from '../src/lib/api';
import { normalizeMime } from '../src/server/evidence-prep';

describe('Selección y recuperación de evidencias', () => {
  it('conserva bytes y nombre cuando el original pierde su acceso', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const file = new File([bytes], 'Captura.JPG', { type: 'image/jpeg', lastModified: 123 });
    const captured = await captureEvidenceFile(file);
    Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.reject(new DOMException('unavailable', 'NotReadableError')) });
    expect(await captureEvidenceFile(file)).toBe(captured);
    expect(await readEvidenceHead(captured)).toEqual(bytes);
    expect(captured.name).toBe('Captura.JPG');
    expect(captured.lastModified).toBe(123);
  });

  it('no envía un archivo ilegible y permite recuperar su lectura', async () => {
    const file = new File(['texto'], 'nota.txt', { type: 'text/plain' });
    const reading = vi.fn().mockRejectedValueOnce(new DOMException('permission', 'NotReadableError'))
      .mockResolvedValueOnce(new TextEncoder().encode('texto').buffer);
    Object.defineProperty(file, 'arrayBuffer', { value: reading });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await expect(uploadEvidence('case-id', file)).rejects.toMatchObject({ name: 'NotReadableError' });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect((await captureEvidenceFile(file)).size).toBe(5);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each(['NotReadableError', 'NotFoundError', 'SecurityError'])('explica %s sin UNKNOWN', (name) => {
    const state = toErrorState(new DOMException('permission', name));
    expect(state.category).toBe('FILE_READ_ERROR');
    expect(state.message).toContain('vuelve a seleccionarlo');
  });

  it.each(['image/jpg', 'IMAGE/PJPEG'])('normaliza el alias %s', (mime) => {
    expect(normalizeMime(mime)).toBe('image/jpeg');
  });

  it.each(['CSV', 'md', 'json', 'LOG'])('acepta texto .%s sin MIME del sistema', (extension) => {
    expect(resolveEvidenceMime(new TextEncoder().encode('texto'), '', `nota.${extension}`)).toBe('text/plain');
  });

  it('no promueve videos ni ejecutables mediante extensión', () => {
    expect(resolveEvidenceMime(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), 'video/webm', 'audio.webm')).toBe('video/webm');
    expect(resolveEvidenceMime(new Uint8Array([0x4d, 0x5a]), '', 'imagen.jpg')).toBeNull();
  });
});
