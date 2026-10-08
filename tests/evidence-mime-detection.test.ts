// =============================================================================
// Detección de MIME REAL por magic bytes en el cliente y paridad con servidor.
//
// Bug real: el browser deriva `File.type` de la extensión, no del contenido.
// Un JPEG renombrado a `.png` declaraba `image/png` y el servidor respondía 415.
// El arreglo: el cliente detecta el MIME por firma y lo declara al subir.
// =============================================================================

import { describe, expect, it, vi } from 'vitest';
import { uploadEvidence } from '../src/lib/api';
import {
  detectEvidenceMime,
  EVIDENCE_MIME_ALLOWLIST,
  resolveEvidenceMime,
} from '../src/shared/evidence-formats';
import { verifyFileSignature } from '../src/server/evidence-prep';

const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const EXE_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7 contenido');
const WEBP_BYTES = new Uint8Array([
  ...new TextEncoder().encode('RIFF0000'),
  ...new TextEncoder().encode('WEBP'),
]);
const WAV_BYTES = new Uint8Array([
  ...new TextEncoder().encode('RIFF0000'),
  ...new TextEncoder().encode('WAVE'),
]);
const M4A_BYTES = new Uint8Array([
  0x00, 0x00, 0x00, 0x00,
  ...new TextEncoder().encode('ftypM4A '),
]);
const MP3_ID3_BYTES = new Uint8Array([
  ...new TextEncoder().encode('ID3'),
  0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10,
]);
const MP3_FRAME_BYTES = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
const GIF_BYTES = new Uint8Array([...new TextEncoder().encode('GIF89a')]);
const WEBM_BYTES = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
const OGG_BYTES = new Uint8Array([...new TextEncoder().encode('OggS')]);

/** Muestra de cada formato que tiene firma reconocible. */
const SAMPLES: Array<[mime: string, bytes: Uint8Array]> = [
  ['application/pdf', PDF_BYTES],
  ['image/png', PNG_BYTES],
  ['image/jpeg', JPEG_BYTES],
  ['image/webp', WEBP_BYTES],
  ['image/gif', GIF_BYTES],
  ['audio/wav', WAV_BYTES],
  ['audio/mp4', M4A_BYTES],
  ['audio/mpeg', MP3_ID3_BYTES],
  ['audio/mpeg', MP3_FRAME_BYTES],
  ['audio/webm', WEBM_BYTES],
  ['audio/ogg', OGG_BYTES],
];

function makeFetchMock(status = 201) {
  return vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        evidence: {
          id: 'ev-1',
          caseId: 'case-1',
          filename: 'captura.png',
          mimeType: 'image/jpeg',
          sizeBytes: JPEG_BYTES.length,
          hash: 'a'.repeat(64),
          storagePath: 'case-1/ev-1',
          processingStatus: 'READY',
          processingError: null,
          transcript: null,
          createdAt: new Date().toISOString(),
        },
      }),
      { status },
    ),
  );
}

describe('detectEvidenceMime', () => {
  it('detecta JPEG aunque la extension sea .png', () => {
    expect(detectEvidenceMime(JPEG_BYTES)).toBe('image/jpeg');
  });

  it('detecta PNG sin extension declarada', () => {
    expect(detectEvidenceMime(PNG_BYTES)).toBe('image/png');
  });

  it('devuelve null para contenido desconocido', () => {
    expect(detectEvidenceMime(EXE_BYTES)).toBeNull();
    expect(detectEvidenceMime(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });

  it('no confunde RIFF: WEBP vs WAVE', () => {
    expect(detectEvidenceMime(WEBP_BYTES)).toBe('image/webp');
    expect(detectEvidenceMime(WAV_BYTES)).toBe('audio/wav');
  });

  it('ISO-BMFF se declara como audio/mp4', () => {
    expect(detectEvidenceMime(M4A_BYTES)).toBe('audio/mp4');
  });

  it('MP3 se detecta tanto con ID3 como con frame sync', () => {
    expect(detectEvidenceMime(MP3_ID3_BYTES)).toBe('audio/mpeg');
    expect(detectEvidenceMime(MP3_FRAME_BYTES)).toBe('audio/mpeg');
  });
});

describe('resolveEvidenceMime', () => {
  it('ISO-BMFF declarado como video/mp4 conserva video/* para rechazo fuera de allowlist', () => {
    expect(resolveEvidenceMime(M4A_BYTES, 'video/mp4')).toBe('video/mp4');
  });

  it('ISO-BMFF declarado como video/quicktime conserva video/* para rechazo fuera de allowlist', () => {
    expect(resolveEvidenceMime(M4A_BYTES, 'video/quicktime')).toBe('video/quicktime');
  });

  it('ISO-BMFF declarado como image/png conserva la declaracion para rechazo 415 del servidor', () => {
    // La firma ISO-BMFF es compartida por audio y video; sin leer la caja moov
    // no podemos saber si es video. Respetamos la declaracion explicita: el
    // servidor contrastara la firma contra image/png y respondera 415 sin cobrar.
    expect(resolveEvidenceMime(M4A_BYTES, 'image/png')).toBe('image/png');
  });

  it('ISO-BMFF declarado como audio/m4a conserva su subtipo', () => {
    expect(resolveEvidenceMime(M4A_BYTES, 'audio/m4a')).toBe('audio/m4a');
  });

  it('ISO-BMFF declarado como audio/x-m4a conserva su subtipo', () => {
    expect(resolveEvidenceMime(M4A_BYTES, 'audio/x-m4a')).toBe('audio/x-m4a');
  });

  it('ISO-BMFF declarado como audio/mp4 conserva su subtipo', () => {
    expect(resolveEvidenceMime(M4A_BYTES, 'audio/mp4')).toBe('audio/mp4');
  });

  it('ISO-BMFF sin declaracion se resuelve como audio/mp4', () => {
    expect(resolveEvidenceMime(M4A_BYTES, '')).toBe('audio/mp4');
  });

  it('ISO-BMFF declarado como application/octet-stream cae a audio/mp4', () => {
    expect(resolveEvidenceMime(M4A_BYTES, 'application/octet-stream')).toBe('audio/mp4');
  });

  it('formato no ambiguo devuelve el detectado ignorando la declaracion', () => {
    expect(resolveEvidenceMime(JPEG_BYTES, 'image/png')).toBe('image/jpeg');
    expect(resolveEvidenceMime(PNG_BYTES, '')).toBe('image/png');
  });

  it('contenido desconocido cae al declarado', () => {
    expect(resolveEvidenceMime(EXE_BYTES, 'text/plain')).toBe('text/plain');
    expect(resolveEvidenceMime(EXE_BYTES, '')).toBeNull();
  });
});

describe('paridad cliente-servidor', () => {
  it.each(SAMPLES)(
    'detectEvidenceMime coincide con verifyFileSignature para %s',
    (mime, bytes) => {
      const detected = detectEvidenceMime(bytes);
      expect(detected).toBe(mime);
      expect(verifyFileSignature(Buffer.from(bytes), mime).ok).toBe(true);
    },
  );
});

describe('uploadEvidence declara el MIME real detectado', () => {
  it('un JPEG llamado captura.png se sube con content-type image/jpeg', async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([JPEG_BYTES], 'captura.png', { type: 'image/png' });
    await uploadEvidence('case-1', file);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: unknown },
    ];
    expect(options?.headers?.['content-type']).toBe('image/jpeg');
    expect(options?.headers?.['x-file-name']).toBe(encodeURIComponent('captura.png'));
    expect(options?.body).toBe(file);

    vi.unstubAllGlobals();
  });

  it('sin extension y bytes PNG validos se sube como image/png', async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([PNG_BYTES], 'sin-extension', { type: '' });
    await uploadEvidence('case-1', file);

    const [, options] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(options?.headers?.['content-type']).toBe('image/png');

    vi.unstubAllGlobals();
  });

  it('ISO-BMFF declarado audio/m4a conserva el subtipo al subir', async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([M4A_BYTES], 'grabacion.m4a', { type: 'audio/m4a' });
    await uploadEvidence('case-1', file);

    const [, options] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(options?.headers?.['content-type']).toBe('audio/m4a');

    vi.unstubAllGlobals();
  });

  it('ISO-BMFF declarado video/mp4 se envia como video/mp4 (fuera de allowlist)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { category: 'UPLOAD_ERROR', message: 'Tipo no permitido' } }),
        { status: 415 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([M4A_BYTES], 'clip.mp4', { type: 'video/mp4' });
    await expect(uploadEvidence('case-1', file)).rejects.toThrow();

    const [, options] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(options?.headers?.['content-type']).toBe('video/mp4');

    vi.unstubAllGlobals();
  });

  it('ISO-BMFF declarado image/png se envia como image/png y el servidor rechaza con 415', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { category: 'UPLOAD_ERROR', message: 'El contenido no corresponde al tipo declarado' } }),
        { status: 415 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([M4A_BYTES], 'video-renombrado.png', { type: 'image/png' });
    await expect(uploadEvidence('case-1', file)).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(options?.headers?.['content-type']).toBe('image/png');

    vi.unstubAllGlobals();
  });
});

describe('regresion: contenido malicioso sigue rechazandose', () => {
  it('un EXE renombrado a .png es rechazado por verifyFileSignature', () => {
    const verdict = verifyFileSignature(Buffer.from(EXE_BYTES), 'image/png');
    expect(verdict.ok).toBe(false);
  });

  it('detectEvidenceMime no le da pasaporte a un EXE', () => {
    expect(detectEvidenceMime(EXE_BYTES)).toBeNull();
    expect(EVIDENCE_MIME_ALLOWLIST.has('application/x-msdownload')).toBe(false);
  });
});
