import { describe, expect, it } from 'vitest';
import { prepareEvidenceContent } from './prepare';
import type { EvidenceRecord, EvidenceStorage, VisionProvider, AudioProvider } from './ports';
import { buildMinimalPdf } from './testing/minimal-pdf';

const DEFAULT_CONFIG = {
  visionModel: 'vision-fake',
  visionTimeoutMs: 5_000,
  audioPollMaxAttempts: 4,
  audioPollIntervalMs: 1_000,
  audioPollTimeoutMs: 30_000,
  maxToolOutputChars: 24_000,
};

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: 'ev_1',
    auditId: 'audit_1',
    originalFilename: 'evidencia.txt',
    safeFilename: 'evidencia.txt',
    detectedMimeType: 'text/plain',
    kind: 'TEXT',
    sizeBytes: 128,
    sha256: 'b'.repeat(64),
    storageBucket: 'dictamen-evidencias',
    storageKey: 'audit_1/ev_1/evidencia.txt',
    status: 'STORED',
    contentStatus: 'PENDING',
    contentError: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Storage en memoria: sin red, y con la cuenta de descargas a la vista. */
function memoryStorage(contents: Uint8Array | null, failure?: { message?: string }): {
  storage: EvidenceStorage;
  downloads: number;
  lastKey: () => string | undefined;
} {
  let downloads = 0;
  let lastKey: string | undefined;
  return {
    get downloads() {
      return downloads;
    },
    lastKey: () => lastKey,
    storage: {
      async download(bucket: string, key: string) {
        downloads += 1;
        lastKey = `${bucket}/${key}`;
        if (failure) return { data: null, error: failure };
        if (contents === null) return { data: null, error: null };
        return { data: contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength) as ArrayBuffer };
      },
      async upload() {
        return { error: null };
      },
    },
  };
}

const bytesOf = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'utf8'));

describe('prepareEvidenceContent', () => {
  it('deja un TEXT en READY con el texto decodificado', async () => {
    const storage = memoryStorage(bytesOf('Solicito se cancele la matricula del periodo 2026-1.'));

    const result = await prepareEvidenceContent({
      evidence: evidence(),
      storage: storage.storage,
      providers: {},
      config: DEFAULT_CONFIG,
    });

    expect(result.status).toBe('READY');
    expect(result.text).toBe('Solicito se cancele la matricula del periodo 2026-1.');
    expect(result.kind).toBe('TEXT');
    expect(result.pages).toBe(0);
    expect(result.error).toBeNull();
    expect(result.aiCall).toBeNull();
    expect(result.audio).toBeNull();
  });

  it('lee un PDF real y devuelve el texto con marcador de página', async () => {
    const pdf = buildMinimalPdf(['Solicitud de desistimiento', 'Firma del estudiante']);
    const storage = memoryStorage(pdf);

    const result = await prepareEvidenceContent({
      evidence: evidence({ kind: 'PDF', originalFilename: 'desistimiento.pdf', safeFilename: 'desistimiento.pdf', detectedMimeType: 'application/pdf' }),
      storage: storage.storage,
      providers: {},
      config: DEFAULT_CONFIG,
    });

    expect(result.status).toBe('READY');
    expect(result.pages).toBe(2);
    expect(result.text).toContain('[[página 1]]');
    expect(result.text).toContain('Solicitud de desistimiento');
    expect(result.text).toContain('[[página 2]]');
    expect(result.text).toContain('Firma del estudiante');
  });

  it('marca un PDF sin capa de texto como no legible en vez de fingir que se leyó', async () => {
    const storage = memoryStorage(new Uint8Array(Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n', 'latin1')));

    const result = await prepareEvidenceContent({
      evidence: evidence({ kind: 'PDF', originalFilename: 'escaneado.pdf', safeFilename: 'escaneado.pdf', detectedMimeType: 'application/pdf' }),
      storage: storage.storage,
      providers: {},
      config: DEFAULT_CONFIG,
    });

    expect(result.status).toBe('FAILED');
    expect(result.error?.code).toBe('PDF_TEXT_UNAVAILABLE');
    expect(result.text).toBeNull();
  });

  it('falla una IMAGE sin proveedor de visión en vez de devolver un texto vacío', async () => {
    const storage = memoryStorage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));

    const result = await prepareEvidenceContent({
      evidence: evidence({ kind: 'IMAGE', originalFilename: 'captura.png', safeFilename: 'captura.png', detectedMimeType: 'image/png' }),
      storage: storage.storage,
      providers: {},
      config: DEFAULT_CONFIG,
    });

    expect(result.status).toBe('FAILED');
    expect(result.error?.code).toBe('VISION_PROVIDER_MISSING');
    expect(result.text).toBeNull();
  });

  it('deja una IMAGE en READY con el texto del proveedor y su coste', async () => {
    const storage = memoryStorage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));
    const vision: VisionProvider = {
      name: 'fake-vision',
      async describeImage() {
        return { text: 'SOLICITUD DE CANCELACION', inputTokens: 1_234, outputTokens: 56, model: 'vision-real' };
      },
    };

    const result = await prepareEvidenceContent({
      evidence: evidence({ kind: 'IMAGE', originalFilename: 'captura.png', safeFilename: 'captura.png', detectedMimeType: 'image/png' }),
      storage: storage.storage,
      providers: { vision },
      config: DEFAULT_CONFIG,
    });

    expect(result.status).toBe('READY');
    expect(result.text).toBe('SOLICITUD DE CANCELACION');
    expect(result.aiCall).toEqual({ model: 'vision-real', inputTokens: 1_234, outputTokens: 56 });
  });

  it('falla un AUDIO sin proveedor de transcripción', async () => {
    const storage = memoryStorage(Uint8Array.from([0x49, 0x44, 0x33, 0x03]));

    const result = await prepareEvidenceContent({
      evidence: evidence({ kind: 'AUDIO', originalFilename: 'entrevista.mp3', safeFilename: 'entrevista.mp3', detectedMimeType: 'audio/mpeg' }),
      storage: storage.storage,
      providers: {},
      config: DEFAULT_CONFIG,
    });

    expect(result.status).toBe('FAILED');
    expect(result.error?.code).toBe('AUDIO_PROVIDER_MISSING');
  });

  it('envía el AUDIO una sola vez y lo deja en WAITING_EXTERNAL sin hacer polling', async () => {
    const storage = memoryStorage(Uint8Array.from([0x49, 0x44, 0x33, 0x03]));
    let submits = 0;
    let statuses = 0;
    const audio: AudioProvider = {
      async submit() {
        submits += 1;
        return { assemblyId: 'asm_42' };
      },
      async status() {
        statuses += 1;
        return { status: 'completed', text: 'no deberia llegar aqui' };
      },
    };

    const result = await prepareEvidenceContent({
      evidence: evidence({ kind: 'AUDIO', originalFilename: 'entrevista.mp3', safeFilename: 'entrevista.mp3', detectedMimeType: 'audio/mpeg' }),
      storage: storage.storage,
      providers: { audio },
      config: DEFAULT_CONFIG,
    });

    expect(result.status).toBe('WAITING_EXTERNAL');
    expect(result.text).toBeNull();
    expect(result.audio).toEqual({ assemblyId: 'asm_42' });
    // El webhook es quien trae la transcripción: este camino solo envía.
    expect(submits).toBe(1);
    expect(statuses).toBe(0);
  });

  it('propaga el fallo de descarga con su mensaje, sin tragárselo', async () => {
    const storage = memoryStorage(null, { message: '404 no such key' });

    const result = await prepareEvidenceContent({
      evidence: evidence(),
      storage: storage.storage,
      providers: {},
      config: DEFAULT_CONFIG,
    });

    expect(result.status).toBe('FAILED');
    expect(result.error?.code).toBe('EVIDENCE_DOWNLOAD_FAILED');
    expect(result.error?.message).toContain('404 no such key');
  });

  it('trata una descarga sin datos ni error como fallo, no como evidencia vacía', async () => {
    const storage = memoryStorage(null);

    const result = await prepareEvidenceContent({
      evidence: evidence(),
      storage: storage.storage,
      providers: {},
      config: DEFAULT_CONFIG,
    });

    expect(result.status).toBe('FAILED');
    expect(result.error?.code).toBe('EVIDENCE_DOWNLOAD_FAILED');
  });

  it('no intenta descargar una evidencia sin clave de storage', async () => {
    const storage = memoryStorage(bytesOf('contenido'));

    const result = await prepareEvidenceContent({
      evidence: evidence({ storageKey: null }),
      storage: storage.storage,
      providers: {},
      config: DEFAULT_CONFIG,
    });

    expect(result.status).toBe('FAILED');
    expect(result.error?.code).toBe('EVIDENCE_STORAGE_KEY_MISSING');
    expect(storage.downloads).toBe(0);
  });

  it('recorta el texto al límite de contexto configurado', async () => {
    const storage = memoryStorage(bytesOf('a'.repeat(1_000)));

    const result = await prepareEvidenceContent({
      evidence: evidence(),
      storage: storage.storage,
      providers: {},
      config: { ...DEFAULT_CONFIG, maxToolOutputChars: 100 },
    });

    expect(result.status).toBe('READY');
    expect((result.text ?? '').length).toBeLessThanOrEqual(100);
    expect(result.text).toContain('[[texto recortado por límite de contexto]]');
  });

  it('cae al límite compartido si el configurado es inválido, en vez de recortar a nada', async () => {
    const storage = memoryStorage(bytesOf('x'.repeat(500)));

    const result = await prepareEvidenceContent({
      evidence: evidence(),
      storage: storage.storage,
      providers: {},
      config: { ...DEFAULT_CONFIG, maxToolOutputChars: Number.NaN },
    });

    expect(result.status).toBe('READY');
    expect(result.text).toBe('x'.repeat(500));
  });

  it('conserva el código del fallo del proveedor de audio en vez de envolverlo a ciegas', async () => {
    const storage = memoryStorage(Uint8Array.from([0x49, 0x44, 0x33, 0x03]));
    const audio: AudioProvider = {
      async submit() {
        throw new Error('conexión rechazada por el proveedor');
      },
      async status() {
        return { status: 'queued' };
      },
    };

    const result = await prepareEvidenceContent({
      evidence: evidence({ kind: 'AUDIO', originalFilename: 'entrevista.mp3', safeFilename: 'entrevista.mp3', detectedMimeType: 'audio/mpeg' }),
      storage: storage.storage,
      providers: { audio },
      config: DEFAULT_CONFIG,
    });

    expect(result.status).toBe('FAILED');
    expect(result.error?.code).toBe('ASSEMBLY_SUBMIT_FAILED');
    expect(result.error?.message).toContain('conexión rechazada por el proveedor');
  });

  it('clasifica como DOCUMENTO no disponible en vez de decodificar el ZIP como texto', async () => {
    const storage = memoryStorage(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00]));

    const result = await prepareEvidenceContent({
      evidence: evidence({
        kind: 'DOCUMENT',
        originalFilename: 'acta.docx',
        safeFilename: 'acta.docx',
        detectedMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      storage: storage.storage,
      providers: {},
      config: DEFAULT_CONFIG,
    });

    expect(result.status).toBe('FAILED');
    expect(result.error?.code).toBe('DOCUMENT_TEXT_UNAVAILABLE');
  });
});
