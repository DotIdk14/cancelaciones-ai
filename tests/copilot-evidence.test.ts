import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import type { ModelInfo } from '@github/copilot-sdk';
import type { EvidenceInputItem } from '../src/skills/audit/types';
import { bundleCopilotEvidence, applyCopilotBundle } from '../src/server/ai/copilot-evidence';
import { assertCopilotParts } from '../src/server/ai/copilot-capabilities';
import { visualEvidenceParts, withAiProvider, preparedCopilotParts } from '../src/server/ai/provider';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8qkAAAAASUVORK5CYII=';
const model = { capabilities: { supports: { vision: true }, limits: { vision: {
  max_prompt_images: 1, max_prompt_image_size: 3 * 1024 * 1024, supported_media_types: ['image/png', 'application/pdf'],
} } } } as ModelInfo;
const evidences = (): EvidenceInputItem[] => Array.from({ length: 12 }, (_, i) => ({ evidenceId: `ev-${i}`,
  filename: 'original.png', mimeType: 'image/png', kind: 'IMAGE', imageBase64: image,
  sizeBytes: 68, sha256: `original-hash-${i}`, createdAt: '2026-10-23T00:00:00Z' }));

describe('contenedor visual completo de Copilot', () => {
  it('crea doce páginas nativas y un manifiesto reproducible con todos los orígenes', async () => {
    const source = evidences(); const original = structuredClone(source);
    const bundle = (await bundleCopilotEvidence(source, [model], Date.now() + 5000))!;
    const bytes = Buffer.from(bundle.part.file.file_data.split(',')[1]!, 'base64');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(12);
    expect(pdf.getPages().every(page => page.getHeight() === 33)).toBe(true);
    expect(bundle.manifest.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(bundle.manifest.pages.map(page => [page.evidenceId, page.originalSha256, page.width, page.height]))
      .toEqual(source.map(e => [e.evidenceId, e.sha256, 1, 1]));
    expect(source).toEqual(original);
    const again = await bundleCopilotEvidence(source, [model], Date.now() + 5000);
    expect(again?.manifest).toEqual(bundle.manifest);
    expect(() => assertCopilotParts([bundle.part], model)).not.toThrow();
  });
  it('conserva el texto y el mapa de página en ambas etapas y aísla ejecuciones concurrentes', async () => {
    const source = evidences(); const bundle = (await bundleCopilotEvidence(source, [model], Date.now() + 5000))!;
    const parts = [{ type: 'text' as const, text: 'Contexto original inalterado' }, ...visualEvidenceParts(source)];
    await withAiProvider('github-copilot', async () => {
      for (let stage = 0; stage < 2; stage++) {
        const result = preparedCopilotParts(parts);
        expect(result[0]).toEqual(parts[0]); expect(result.filter(p => p.type === 'file')).toEqual([bundle.part]);
        expect(result.filter(p => p.type === 'image_url')).toHaveLength(0);
        expect(result.at(-1)).toEqual({ type: 'text', text: '[Imagen íntegra en evidencias-visuales.pdf, página 12.]' });
      }
      await withAiProvider('openrouter', async () => { expect(preparedCopilotParts(parts)).toBe(parts); });
    }, bundle);
    expect(preparedCopilotParts(parts)).toBe(parts);
  });
  it('falla ante omisión, sustitución o duplicación de una imagen', async () => {
    const source = evidences(); const bundle = (await bundleCopilotEvidence(source, [model], Date.now() + 5000))!;
    const parts = visualEvidenceParts(source);
    expect(() => applyCopilotBundle(parts.slice(1), bundle)).toThrow();
    expect(() => applyCopilotBundle([...parts, parts[0]!], bundle)).toThrow();
    expect(() => applyCopilotBundle([{ type: 'image_url', image_url: { url: 'otro' } }, ...parts.slice(1)], bundle)).toThrow();
  });
  it('no transforma entradas que ya caben y conserva PDF originales aparte', async () => {
    expect(await bundleCopilotEvidence(evidences().slice(0, 1), [model], Date.now() + 5000)).toBeUndefined();
    const source = evidences(); source[0]!.pagesBase64 = [image];
    source.push({ ...source[0]!, kind: 'PDF', imageBase64: undefined, pagesBase64: undefined, pdfBase64: 'b3JpZ2luYWw=', mimeType: 'application/pdf' });
    const capable = structuredClone(model); capable.capabilities.limits.vision!.max_prompt_images = 2;
    const bundle = (await bundleCopilotEvidence(source, [capable], Date.now() + 5000))!;
    expect(bundle.manifest.pages).toHaveLength(13);
    const result = applyCopilotBundle(visualEvidenceParts(source), bundle);
    expect(result.at(-1)).toEqual(visualEvidenceParts(source).at(-1));
  });
  it('rechaza catálogo sin PDF, imagen corrupta y plazo vencido sin inferir', async () => {
    const incompatible = structuredClone(model); incompatible.capabilities.limits.vision!.supported_media_types = ['image/png'];
    await expect(bundleCopilotEvidence(evidences(), [model, incompatible], Date.now() + 5000)).rejects.toMatchObject({ category: 'UNSUPPORTED_MODEL_CAPABILITY' });
    const source = evidences(); source[0]!.imageBase64 = 'data:image/png;base64,bm90LWEtcG5n';
    await expect(bundleCopilotEvidence(source, [model], Date.now() + 5000)).rejects.toMatchObject({ category: 'UNSUPPORTED_MODEL_CAPABILITY' });
    await expect(bundleCopilotEvidence(evidences(), [model], Date.now() - 1)).rejects.toMatchObject({ category: 'PROVIDER_UNAVAILABLE' });
  });
  it('el PDF sigue sujeto al límite de bytes de cada modelo', async () => {
    const bundle = (await bundleCopilotEvidence(evidences(), [model], Date.now() + 5000))!;
    const small = structuredClone(model); small.capabilities.limits.vision!.max_prompt_image_size = bundle.manifest.sizeBytes - 1;
    expect(() => assertCopilotParts([bundle.part], small)).toThrow();
  });
});
