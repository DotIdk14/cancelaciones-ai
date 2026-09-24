/**
 * Extracción de texto de PDF con pdfjs-dist (mismo patrón que reporting).
 * Import dinámico: pdfjs-dist solo se carga cuando el job lo requiere, sin
 * inflar el bundle del servidor en cada request.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<{ numPages: number; text: string }> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const pdf = await loadingTask.promise;
  const parts: string[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ('str' in item) parts.push(String(item.str));
      }
    }
  } finally {
    await loadingTask.destroy();
  }
  return { numPages: pdf.numPages, text: parts.join('\n') };
}