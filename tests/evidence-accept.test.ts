// =============================================================================
// Contrato de formatos de evidencia entre el selector del cliente y el backend.
//
// El picker (`<input accept>`) debe coincidir con `EVIDENCE_MIME_ALLOWLIST` en
// `src/shared/evidence-formats.ts`. Si el picker es más amplio, el usuario
// selecciona formatos que de todos modos fallan con 415; si es más restrictivo,
// bloqueamos formatos válidos. Esta suite fija la frontera.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { EVIDENCE_ACCEPT, isAcceptedEvidenceMime } from '../src/lib/labels';
import { normalizeMime } from '../src/server/evidence-prep';

describe('EVIDENCE_ACCEPT', () => {
  it('no usa wildcards genéricas que permitan formatos no soportados', () => {
    expect(EVIDENCE_ACCEPT).not.toContain('image/*');
    expect(EVIDENCE_ACCEPT).not.toContain('audio/*');
    expect(EVIDENCE_ACCEPT).not.toContain('video/*');
  });

  it('incluye las extensiones de los formatos soportados por el servidor', () => {
    const accepted = EVIDENCE_ACCEPT.split(',');
    expect(accepted).toContain('.png');
    expect(accepted).toContain('.jpg');
    expect(accepted).toContain('.jpeg');
    expect(accepted).toContain('.webp');
    expect(accepted).toContain('.gif');
    expect(accepted).toContain('.pdf');
    expect(accepted).toContain('.mp3');
    expect(accepted).toContain('.wav');
    expect(accepted).toContain('.m4a');
    expect(accepted).toContain('.ogg');
    expect(accepted).toContain('.webm');
    expect(accepted).toContain('.txt');
  });
});

describe('isAcceptedEvidenceMime', () => {
  it('acepta MIMEs que el backend normaliza como válidos', () => {
    expect(isAcceptedEvidenceMime('image/png')).toBe(true);
    expect(isAcceptedEvidenceMime('image/jpeg')).toBe(true);
    expect(isAcceptedEvidenceMime('image/webp')).toBe(true);
    expect(isAcceptedEvidenceMime('image/gif')).toBe(true);
    expect(isAcceptedEvidenceMime('application/pdf')).toBe(true);
    expect(isAcceptedEvidenceMime('audio/mpeg')).toBe(true);
    expect(isAcceptedEvidenceMime('audio/mp3')).toBe(true);
    expect(isAcceptedEvidenceMime('audio/wav')).toBe(true);
    expect(isAcceptedEvidenceMime('audio/mp4')).toBe(true);
    expect(isAcceptedEvidenceMime('audio/x-m4a')).toBe(true);
    expect(isAcceptedEvidenceMime('audio/m4a')).toBe(true);
    expect(isAcceptedEvidenceMime('audio/webm')).toBe(true);
    expect(isAcceptedEvidenceMime('audio/ogg')).toBe(true);
    expect(isAcceptedEvidenceMime('text/plain')).toBe(true);
  });

  it('es insensible a mayúsculas/minúsculas', () => {
    expect(isAcceptedEvidenceMime('IMAGE/PNG')).toBe(true);
    expect(isAcceptedEvidenceMime('Audio/MPEG')).toBe(true);
  });

  it('mantiene la allowlist de cliente alineada con la validación del servidor', () => {
    const candidates = [
      'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
      'application/pdf', 'application/zip', 'text/plain',
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/mp4', 'audio/x-m4a',
      'audio/m4a', 'audio/webm', 'audio/ogg', 'audio/flac', 'video/mp4',
    ];

    for (const mime of candidates) {
      expect(isAcceptedEvidenceMime(mime), `client allowlist for ${mime}`).toBe(
        normalizeMime(mime) !== null,
      );
    }
  });

  it('rechaza MIMEs fuera de la allowlist del servidor', () => {
    expect(isAcceptedEvidenceMime('image/svg+xml')).toBe(false);
    expect(isAcceptedEvidenceMime('image/bmp')).toBe(false);
    expect(isAcceptedEvidenceMime('image/tiff')).toBe(false);
    expect(isAcceptedEvidenceMime('audio/flac')).toBe(false);
    expect(isAcceptedEvidenceMime('video/mp4')).toBe(false);
    expect(isAcceptedEvidenceMime('application/zip')).toBe(false);
    expect(isAcceptedEvidenceMime('application/x-msdownload')).toBe(false);
    expect(isAcceptedEvidenceMime('')).toBe(false);
  });
});
