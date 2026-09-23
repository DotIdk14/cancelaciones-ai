// Dev tool: rasteriza un PDF a PNGs (por pagina) usando pdfjs + node-canvas.
// Uso: node scripts/pdf-to-png.mjs <archivo.pdf> <dirSalida> [escala] [paginas]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas, Image as CanvasImage } from '@napi-rs/canvas';

globalThis.Image = CanvasImage;

const [, , pdfArg, outArg, scaleArg, pagesArg] = process.argv;
const pdfPath = resolve(pdfArg);
const outDir = resolve(outArg ?? 'tmp-png');
const scale = Number(scaleArg ?? 2);
mkdirSync(outDir, { recursive: true });

const loadingTask = getDocument({ data: new Uint8Array(readFileSync(pdfPath)), useSystemFonts: true });
const pdf = await loadingTask.promise;

const wanted = pagesArg ? pagesArg.split(',').map((p) => Number(p)) : null;

for (let i = 1; i <= pdf.numPages; i += 1) {
  if (wanted && !wanted.includes(i)) continue;
  const page = await pdf.getPage(i);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');
  const canvasFactory = {
    create: (w, h) => {
      const c = createCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
      return { canvas: c, context: c.getContext('2d') };
    },
    reset: (entry, w, h) => {
      entry.canvas.width = Math.max(1, Math.ceil(w));
      entry.canvas.height = Math.max(1, Math.ceil(h));
    },
    destroy: (entry) => {
      entry.canvas.width = 0;
      entry.canvas.height = 0;
      entry.context = null;
    },
  };
  await page.render({ canvasContext: ctx, viewport, canvasFactory }).promise;
  const file = resolve(outDir, `page-${i}.png`);
  writeFileSync(file, await canvas.encode('png'));
  console.log(`OK ${file} (${Math.round(viewport.width)}x${Math.round(viewport.height)})`);
}
await loadingTask.destroy();