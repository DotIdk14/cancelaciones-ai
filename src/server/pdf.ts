// =============================================================================
// PDF — extracción de texto con pdf.js (solo transformación de formato).
// =============================================================================
// Usa el build legacy (sin canvas): extrae el TEXTO. Si el texto es
// insuficiente (PDF escaneado), la evidencia se envía al modelo como archivo
// nativo (OpenRouter lo parsea con su motor de visión/OCR). No se decide
// negocio aquí: solo se decide entre texto o archivo.
// =============================================================================

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

const pdfjsGlobal = globalThis as typeof globalThis & {
  pdfjsWorker?: { WorkerMessageHandler: object };
};
pdfjsGlobal.pdfjsWorker ??= { WorkerMessageHandler };

interface PdfTextItem {
  str?: string;
}

/** Extrae el texto de todas las páginas del PDF. Vacío si es escaneado/ilustrado. */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const document = await getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;

  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => {
          const candidate = item as PdfTextItem;
          return typeof candidate.str === 'string' ? candidate.str : '';
        })
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) {
        pages.push(`--- Página ${pageNumber} ---\n${text}`);
      }
    }
    return pages.join('\n\n');
  } finally {
    await document.destroy().catch(() => undefined);
  }
}