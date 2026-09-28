import { describe, expect, it } from 'vitest';
import { prepareEvidenceContent } from './prepare';
import { IMAGE_DESCRIPTION_PROMPT } from './vision';
import type { EvidenceRecord, EvidenceStorage, VisionProvider } from './ports';
import { buildMinimalPdf } from './testing/minimal-pdf';

const CONFIG = {
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
    originalFilename: 'captura original (1).png',
    safeFilename: 'captura.png',
    detectedMimeType: 'image/png',
    kind: 'IMAGE',
    sizeBytes: 128,
    sha256: 'c'.repeat(64),
    storageBucket: 'dictamen-evidencias',
    storageKey: 'audit_1/ev_1/captura.png',
    status: 'STORED',
    contentStatus: 'PENDING',
    contentError: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function memoryStorage(contents: Uint8Array): EvidenceStorage {
  return {
    async download() {
      return { data: contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength) as ArrayBuffer };
    },
    async upload() {
      return { error: null };
    },
  };
}

interface VisionCall {
  base64: string;
  mimeType: string;
  filename: string;
  prompt: string;
}

function recordingVision(overrides: Partial<VisionProvider> = {}): { provider: VisionProvider; calls: VisionCall[]; docCalls: VisionCall[] } {
  const calls: VisionCall[] = [];
  const docCalls: VisionCall[] = [];
  const record = (into: VisionCall[]) => async (input: VisionCall): Promise<{ text: string; inputTokens: number; outputTokens: number; model: string }> => {
    into.push(input);
    return { text: 'TEXTO', inputTokens: 1, outputTokens: 2, model: 'vision-fake' };
  };
  return {
    calls,
    docCalls,
    provider: {
      name: 'recording',
      describeImage: record(calls) as VisionProvider['describeImage'],
      describeDocument: record(docCalls) as VisionProvider['describeDocument'],
      ...overrides,
    },
  };
}

/** PDF sin capa de texto: el extractor local no encuentra nada legible. */
const SCANNED_PDF = new Uint8Array(Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n', 'latin1'));

describe('imagen: el proveedor de visión es obligatorio y se usa con los datos saneados', () => {
  it('deja la imagen READY y entrega al proveedor el nombre saneado y el prompt del paquete', async () => {
    const { provider, calls } = recordingVision();
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const result = await prepareEvidenceContent({
      evidence: evidence(),
      storage: memoryStorage(bytes),
      providers: { vision: provider },
      config: CONFIG,
    });

    expect(result.status).toBe('READY');
    expect(result.text).not.toBe('');
    expect(result.error).toBeNull();
    expect(result.error?.code).not.toBe('VISION_PROVIDER_MISSING');
    expect(calls).toHaveLength(1);
    // El nombre que viaja es el saneado, nunca el que subió el usuario: es lo
    // que se acaba mostrando y lo que evita viajar por rutas con el nombre original.
    expect(calls[0]!.filename).toBe('captura.png');
    expect(calls[0]!.filename).not.toBe(evidence().originalFilename);
    expect(calls[0]!.mimeType).toBe('image/png');
    expect(calls[0]!.prompt).toBe(IMAGE_DESCRIPTION_PROMPT);
    // El base64 enviado tiene que ser exactamente el contenido descargado.
    expect(Buffer.from(calls[0]!.base64, 'base64').equals(Buffer.from(bytes))).toBe(true);
  });

  it('el texto de la imagen se recorta al límite configurado, con la marca de recorte', async () => {
    const provider: VisionProvider = {
      name: 'largo',
      async describeImage() {
        return { text: 'a'.repeat(5_000), inputTokens: 1, outputTokens: 2, model: 'vision-fake' };
      },
    };

    const result = await prepareEvidenceContent({
      evidence: evidence(),
      storage: memoryStorage(Uint8Array.from([0x89, 0x50])),
      providers: { vision: provider },
      config: { ...CONFIG, maxToolOutputChars: 500 },
    });

    expect(result.status).toBe('READY');
    expect((result.text ?? '').length).toBeLessThanOrEqual(500);
    expect(result.text).toContain('[[texto recortado por límite de contexto]]');
  });
});

describe('PDF con capa de texto: no se gasta visión', () => {
  it('extrae localmente y no invoca ni describeImage ni describeDocument', async () => {
    const vision: VisionProvider = {
      name: 'debe-sin-usar',
      async describeImage() {
        throw new Error('VISION_CONSUMIDA_POR_PDF_CON_TEXTO');
      },
      async describeDocument() {
        throw new Error('VISION_CONSUMIDA_POR_PDF_CON_TEXTO');
      },
    };
    const pdf = buildMinimalPdf(['Solicitud de desistimiento', 'Firma del estudiante']);

    const result = await prepareEvidenceContent({
      evidence: evidence({
        kind: 'PDF',
        originalFilename: 'desistimiento.pdf',
        safeFilename: 'desistimiento.pdf',
        detectedMimeType: 'application/pdf',
        storageKey: 'audit_1/ev_1/desistimiento.pdf',
      }),
      storage: memoryStorage(pdf),
      providers: { vision },
      config: CONFIG,
    });

    expect(result.status).toBe('READY');
    expect(result.error).toBeNull();
    expect(result.text).toContain('Solicitud de desistimiento');
    expect(result.text).toContain('Firma del estudiante');
    // aiCall es el rastro de coste: si un PDF con capa de texto lo llena, se está
    // pagando visión por texto que ya estaba en el archivo.
    expect(result.aiCall).toBeNull();
  });

  it('también con un PDF comprimido, para no depender de que el stream venga inflado', async () => {
    const { provider, calls, docCalls } = recordingVision();
    const pdf = buildMinimalPdf(['Comprobante de pago del periodo'], { compress: true });

    const result = await prepareEvidenceContent({
      evidence: evidence({
        kind: 'PDF',
        originalFilename: 'comprobante.pdf',
        safeFilename: 'comprobante.pdf',
        detectedMimeType: 'application/pdf',
        storageKey: 'audit_1/ev_1/comprobante.pdf',
      }),
      storage: memoryStorage(pdf),
      providers: { vision: provider },
      config: CONFIG,
    });

    expect(result.status).toBe('READY');
    expect(result.text).toContain('Comprobante de pago del periodo');
    expect(result.aiCall).toBeNull();
    expect(calls).toEqual([]);
    expect(docCalls).toEqual([]);
  });
});

describe('PDF sin capa de texto: la visión entra, pero solo por el puerto de documentos', () => {
  it('usa describeDocument con los bytes reales y deja constancia en el texto', async () => {
    const { provider, calls, docCalls } = recordingVision();

    const result = await prepareEvidenceContent({
      evidence: evidence({
        kind: 'PDF',
        originalFilename: 'escaneado.pdf',
        safeFilename: 'escaneado.pdf',
        detectedMimeType: 'application/pdf',
        storageKey: 'audit_1/ev_1/escaneado.pdf',
      }),
      storage: memoryStorage(SCANNED_PDF),
      providers: { vision: provider },
      config: CONFIG,
    });

    expect(result.status).toBe('READY');
    expect(result.error).toBeNull();
    expect(result.text).toContain('[[PDF sin capa de texto; transcripción visual del documento completo]]');
    expect(result.aiCall).not.toBeNull();
    expect(result.aiCall?.model).toBe('vision-fake');
    // Describir un PDF escaneado como imagen no es lo mismo que transcribir el
    // documento: el agente recibiría una descripción, no el texto.
    expect(calls).toEqual([]);
    expect(docCalls).toHaveLength(1);
    expect(docCalls[0]!.filename).toBe('escaneado.pdf');
    expect(docCalls[0]!.mimeType).toBe('application/pdf');
    expect(docCalls[0]!.prompt).toContain('sin capa de texto');
    expect(Buffer.from(docCalls[0]!.base64, 'base64').equals(Buffer.from(SCANNED_PDF))).toBe(true);
  });

  it('sin describeDocument falla con PDF_TEXT_UNAVAILABLE sin caer a describeImage', async () => {
    let imageCalls = 0;
    const vision: VisionProvider = {
      name: 'solo-imagenes',
      async describeImage() {
        imageCalls += 1;
        return { text: 'no deberia usarse', inputTokens: 1, outputTokens: 2, model: 'vision-fake' };
      },
    };

    const result = await prepareEvidenceContent({
      evidence: evidence({
        kind: 'PDF',
        originalFilename: 'escaneado.pdf',
        safeFilename: 'escaneado.pdf',
        detectedMimeType: 'application/pdf',
        storageKey: 'audit_1/ev_1/escaneado.pdf',
      }),
      storage: memoryStorage(SCANNED_PDF),
      providers: { vision },
      config: CONFIG,
    });

    expect(result.status).toBe('FAILED');
    expect(result.error?.code).toBe('PDF_TEXT_UNAVAILABLE');
    expect(result.text).toBeNull();
    expect(result.aiCall).toBeNull();
    // Un PDF sin texto tratado como imagen devolvería contenido inventado por el
    // modelo y el agente lo leería como si fuera el documento.
    expect(imageCalls).toBe(0);
  });

  it('sin proveedor de visión tampoco inventa texto: PDF_TEXT_UNAVAILABLE', async () => {
    const result = await prepareEvidenceContent({
      evidence: evidence({
        kind: 'PDF',
        originalFilename: 'escaneado.pdf',
        safeFilename: 'escaneado.pdf',
        detectedMimeType: 'application/pdf',
        storageKey: 'audit_1/ev_1/escaneado.pdf',
      }),
      storage: memoryStorage(SCANNED_PDF),
      providers: {},
      config: CONFIG,
    });

    expect(result.status).toBe('FAILED');
    expect(result.error?.code).toBe('PDF_TEXT_UNAVAILABLE');
  });

  it('si describeDocument lanza, el fallo conserva el mensaje del proveedor', async () => {
    const vision: VisionProvider = {
      name: 'roto',
      async describeImage() {
        throw new Error('no deberia usarse');
      },
      async describeDocument() {
        throw new Error('VISION_VIDA_503');
      },
    };

    const result = await prepareEvidenceContent({
      evidence: evidence({
        kind: 'PDF',
        originalFilename: 'escaneado.pdf',
        safeFilename: 'escaneado.pdf',
        detectedMimeType: 'application/pdf',
        storageKey: 'audit_1/ev_1/escaneado.pdf',
      }),
      storage: memoryStorage(SCANNED_PDF),
      providers: { vision },
      config: CONFIG,
    });

    expect(result.status).toBe('FAILED');
    expect(result.error?.message).toContain('VISION_VIDA_503');
  });
});

describe('cortes de página del PDF', () => {
  it('maxPdfPages corta la lectura y el texto no incluye páginas de más', async () => {
    const pdf = buildMinimalPdf(['Página uno', 'Página dos', 'Página tres']);

    const result = await prepareEvidenceContent({
      evidence: evidence({
        kind: 'PDF',
        originalFilename: 'largo.pdf',
        safeFilename: 'largo.pdf',
        detectedMimeType: 'application/pdf',
        storageKey: 'audit_1/ev_1/largo.pdf',
      }),
      storage: memoryStorage(pdf),
      providers: {},
      config: { ...CONFIG, maxPdfPages: 2 },
    });

    expect(result.status).toBe('READY');
    expect(result.pages).toBe(2);
    expect(result.text).toContain('Página uno');
    expect(result.text).toContain('Página dos');
    // Si el extractor no respetara el tope, el agente leería la tercera página
    // sin que nada en la traza dijera que se cortó.
    expect(result.text).not.toContain('Página tres');
  });

  it('un PDF escaneado sin páginas legibles no inventa un conteo de páginas en el prompt', async () => {
    const { provider, docCalls } = recordingVision();

    const result = await prepareEvidenceContent({
      evidence: evidence({
        kind: 'PDF',
        originalFilename: 'escaneado.pdf',
        safeFilename: 'escaneado.pdf',
        detectedMimeType: 'application/pdf',
        storageKey: 'audit_1/ev_1/escaneado.pdf',
      }),
      storage: memoryStorage(SCANNED_PDF),
      providers: { vision: provider },
      config: { ...CONFIG, maxPdfPages: 2 },
    });

    expect(result.pages).toBe(0);
    expect(result.status).toBe('READY');
    expect(docCalls[0]!.prompt).toContain('primeras 0 páginas');
  });
});
