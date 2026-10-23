import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { ModelInfo } from '@github/copilot-sdk';
import type { EvidenceInputItem } from '../../skills/audit/types.js';
import type { OpenRouterContentPart } from '../openrouter.js';
import { ApiError } from '../errors.js';

export interface CopilotEvidenceBundle {
  part: Extract<OpenRouterContentPart, { type: 'file' }>;
  sources: string[];
  manifest: {
    format: 'lossless-image-pdf-v1'; sha256: string; sizeBytes: number;
    pages: { page: number; evidenceId: string; sourcePage: number; sourceSha256: string;
      originalSha256: string; width: number; height: number }[];
  };
}

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function unsupported(): never {
  const error = new ApiError(502, 'UNSUPPORTED_MODEL_CAPABILITY',
    'No fue posible preparar todas las imágenes sin pérdida para ambos modelos. No se inició la auditoría.');
  error.failurePath = 'evidence.attachments';
  throw error;
}

/** Contenedor técnico reproducible: una página por imagen, sin escala ni recorte. */
export async function bundleCopilotEvidence(evidences: readonly EvidenceInputItem[], models: readonly ModelInfo[],
  deadlineMs: number): Promise<CopilotEvidenceBundle | undefined> {
  const images = evidences.flatMap(evidence => [
    ...(evidence.imageBase64 ? [{ evidence, source: evidence.imageBase64, sourcePage: 1 }] : []),
    ...(evidence.pagesBase64 ?? []).map((source, index) => ({ evidence, source, sourcePage: index + 1 })),
  ]);
  const nativePdfs = evidences.filter(e => e.kind === 'PDF' && e.pdfBase64).length;
  if (models.every(model => images.length + nativePdfs <= (model.capabilities.limits.vision?.max_prompt_images ?? 0))) return;
  if (!images.length || models.some(model => !model.capabilities.supports.vision
    || !model.capabilities.limits.vision?.supported_media_types.includes('application/pdf')
    || nativePdfs + 1 > model.capabilities.limits.vision.max_prompt_images)) unsupported();
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date(0)); pdf.setModificationDate(new Date(0));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages: CopilotEvidenceBundle['manifest']['pages'] = [];
  for (const item of images) {
    if (Date.now() >= deadlineMs) throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Se agotó el plazo de preparación de evidencias.');
    const match = /^data:image\/(png|jpeg);base64,([a-z0-9+/=\r\n]+)$/i.exec(item.source);
    if (!match) unsupported();
    const bytes = Buffer.from(match[2]!, 'base64');
    let image;
    try { image = match[1]!.toLowerCase() === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes); }
    catch { unsupported(); }
    // Las referencias provienen de IDs internos, nunca del nombre no confiable del archivo.
    const label = `Evidence ID: ${item.evidence.evidenceId} | Source page: ${item.sourcePage}`;
    if (!/^[\x20-\x7e]+$/.test(label)) unsupported();
    const width = Math.max(image.width, font.widthOfTextAtSize(label, 10) + 24);
    const page = pdf.addPage([width, image.height + 32]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    page.drawText(label, { x: 12, y: image.height + 12, size: 10, font });
    pages.push({ page: pages.length + 1, evidenceId: item.evidence.evidenceId, sourcePage: item.sourcePage,
      sourceSha256: hash(bytes), originalSha256: item.evidence.sha256, width: image.width, height: image.height });
  }
  const bytes = await pdf.save();
  if (Date.now() >= deadlineMs) throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Se agotó el plazo de preparación de evidencias.');
  const manifest: CopilotEvidenceBundle['manifest'] = { format: 'lossless-image-pdf-v1', sha256: hash(bytes), sizeBytes: bytes.length, pages };
  return { sources: images.map(item => item.source), manifest,
    part: { type: 'file', file: { filename: 'evidencias-visuales.pdf', file_data: `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}` } } };
}

/** Conserva el texto del Skill y sustituye únicamente sus bytes visuales por el contenedor. */
export function applyCopilotBundle(parts: OpenRouterContentPart[], bundle?: CopilotEvidenceBundle): OpenRouterContentPart[] {
  if (!bundle) return parts;
  let index = 0;
  const result: OpenRouterContentPart[] = [];
  for (const part of parts) {
    if (part.type !== 'image_url') { result.push(part); continue; }
    if (bundle.sources[index] !== part.image_url.url) unsupported();
    if (index === 0) result.push(bundle.part);
    result.push({ type: 'text', text: `[Imagen íntegra en evidencias-visuales.pdf, página ${index + 1}.]` });
    index++;
  }
  if (index !== bundle.sources.length) unsupported();
  return result;
}
