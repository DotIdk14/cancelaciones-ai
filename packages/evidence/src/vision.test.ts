import { describe, expect, it } from 'vitest';
import { buildImageVisionRequest, describeEvidenceImage, IMAGE_DESCRIPTION_PROMPT } from './vision';
import type { EvidenceRecord, VisionProvider } from './ports';

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: 'ev_1',
    auditId: 'audit_1',
    originalFilename: 'Carta de Desistimiento.png',
    safeFilename: 'carta_de_desistimiento.png',
    detectedMimeType: 'image/png',
    kind: 'IMAGE',
    sizeBytes: 1024,
    sha256: 'a'.repeat(64),
    storageBucket: 'dictamen-evidencias',
    storageKey: 'audit_1/ev_1/carta_de_desistimiento.png',
    status: 'STORED',
    contentStatus: 'PENDING',
    contentError: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface RecordedCall {
  base64: string;
  mimeType: string;
  filename: string;
  prompt: string;
  timeoutMs: number;
}

/** Proveedor falso que guarda el prompt recibido, que es justo lo que hay que auditar. */
function recordingProvider(response = { text: 'texto transcrito', inputTokens: 10, outputTokens: 20, model: 'vision-fake' }): {
  provider: VisionProvider;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  return {
    calls,
    provider: {
      name: 'fake-vision',
      async describeImage(input) {
        calls.push({
          base64: input.base64,
          mimeType: input.mimeType,
          filename: input.filename,
          prompt: input.prompt,
          timeoutMs: input.timeoutMs,
        });
        return response;
      },
    },
  };
}

const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

describe('buildImageVisionRequest', () => {
  it('devuelve el base64 exacto de los bytes', () => {
    const request = buildImageVisionRequest(evidence(), bytes);
    expect(request.base64).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('usa el mime detectado por los bytes, no el declarado por el cliente', () => {
    const request = buildImageVisionRequest(evidence({ originalFilename: 'captura.jpeg' }), bytes);
    expect(request.mimeType).toBe('image/png');
  });
});

describe('describeEvidenceImage', () => {
  it('manda un prompt de transcripción literal, no un serializador de reglas', async () => {
    const recorded = recordingProvider();
    await describeEvidenceImage({ evidence: evidence(), bytes, provider: recorded.provider, model: 'vision-fake' });

    const sentPrompt = recorded.calls[0].prompt;

    // Estas cadenas son el modo de fallo que este prompt existe para evitar: si
    // reaparecen, alguien ha metido criterios normativos en la capa de visión.
    expect(sentPrompt).not.toContain('factType');
    expect(sentPrompt).not.toContain('sourceCompleteness');
    expect(sentPrompt).not.toContain('classroom.');
    expect(sentPrompt).not.toContain('contact.');
    expect(sentPrompt).toBe(IMAGE_DESCRIPTION_PROMPT);
  });

  it('pide transcribir, interpretar ni, resumir, y menciona sellos y tablas', () => {
    expect(IMAGE_DESCRIPTION_PROMPT).toContain('Transcribe literalmente');
    expect(IMAGE_DESCRIPTION_PROMPT).toContain('orden de lectura');
    expect(IMAGE_DESCRIPTION_PROMPT).toContain('No interpretes');
    expect(IMAGE_DESCRIPTION_PROMPT).toContain('sellos');
    expect(IMAGE_DESCRIPTION_PROMPT).toContain(' | ');
  });

  it('devuelve el texto del proveedor junto con el nombre y el modelo', async () => {
    const recorded = recordingProvider();
    const description = await describeEvidenceImage({
      evidence: evidence(),
      bytes,
      provider: recorded.provider,
      model: 'vision-fake',
    });

    expect(description).toEqual({
      text: 'texto transcrito',
      provider: 'fake-vision',
      model: 'vision-fake',
      inputTokens: 10,
      outputTokens: 20,
    });
  });

  it('viaja con el nombre de archivo seguro y el timeout configurado', async () => {
    const recorded = recordingProvider();
    await describeEvidenceImage({
      evidence: evidence(),
      bytes,
      provider: recorded.provider,
      model: 'vision-fake',
      timeoutMs: 12_345,
    });

    expect(recorded.calls[0].filename).toBe('carta_de_desistimiento.png');
    expect(recorded.calls[0].timeoutMs).toBe(12_345);
    expect(recorded.calls[0].mimeType).toBe('image/png');
  });

  it('degrada a un nombre genérico cuando el proveedor no se identifica', async () => {
    const description = await describeEvidenceImage({
      evidence: evidence(),
      bytes,
      provider: { async describeImage() { return { text: 'x', inputTokens: null, outputTokens: null, model: 'm' }; } },
      model: 'vision-fake',
    });
    expect(description.provider).toBe('vision');
  });
});
