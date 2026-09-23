// HERRAMIENTA DE DESARROLLO (NON_PRODUCTION)
// Extrae el layout de textos de templates/Dictamen.pdf usando pdfjs-dist y genera
// apps/web/src/server/reporting/template-layout.json con:
//   - templateHash (sha256 de los bytes de la plantilla)
//   - por pagina: spans de texto { text, x, y, fontSize, fontName } en coordenadas
//     PDF nativas (origen abajo-izquierda, mismas unidades que pdf-lib).
// Uso: pnpm --filter @cancelaciones/web exec node scripts/extract-template-layout.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const templatePath = resolve(root, 'templates/Dictamen.pdf');
const outPath = resolve(root, 'apps/web/src/server/reporting/template-layout.json');

const bytes = readFileSync(templatePath);
const templateHash = createHash('sha256').update(bytes).digest('hex');

const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
const pdf = await loadingTask.promise;

const pages = [];
for (let i = 1; i <= pdf.numPages; i += 1) {
  const page = await pdf.getPage(i);
  const content = await page.getTextContent();
  const opList = await page.getOperatorList();
  const viewport = page.getViewport({ scale: 1 });
  const spans = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str) continue;
    const [, , , , e, f] = item.transform;
    const fontSize = Math.hypot(a, b);
    const x = e;
    const y = f;
    const width = item.width ?? 0;
    const height = fontSize;
    const fontName = typeof item.fontName === 'string' ? item.fontName : 'unknown';
    spans.push({
      text: item.str,
      x: round(x),
      y: round(y),
      width: round(width),
      height: round(height),
      fontSize: round(fontSize),
      fontName,
    });
  }

  // Recolecta rects rellenos (fondos de la tabla) con su color.
  const fillRects = [];
  let fillColor = null;
  let curPathType = null;
  let curPathArgs = null;
  for (let op = 0; op < opList.fnArray.length; op += 1) {
    const fn = opList.fnArray[op];
    const args = opList.argsArray[op];
    if (fn === 'setFillRGBColor') {
      const [r, g, b] = args;
      fillColor = [r, g, b].map((v) => Math.round(v * 255));
    } else if (fn === 'setFillGray') {
      const v = Math.round(args[0] * 255);
      fillColor = [v, v, v];
    } else if (fn === 'constructPath') {
      curPathType = args[args.length - 2];
      curPathArgs = args[args.length - 1];
    } else if (fn === 'paintFill') {
      if (curPathType === 'rect' && curPathArgs && fillColor) {
        const [x, y, w, h] = curPathArgs;
        fillRects.push({
          x: round(x),
          y: round(y),
          width: round(w),
          height: round(h),
          color: `#${fillColor.map((v) => v.toString(16).padStart(2, '0')).join('')}`,
        });
      }
      curPathType = null;
      curPathArgs = null;
    } else if (fn === 'restore') {
      fillColor = null;
    }
  }

  pages.push({
    page: i,
    widthPt: round(viewport.width),
    heightPt: round(viewport.height),
    spans,
    fillRects,
  });
}
await loadingTask.destroy();

mkdirSync(dirname(outPath), { recursive: true });
const layout = {
  fileName: 'Dictamen.pdf',
  templateHash,
  pageCount: pdf.numPages,
  pages,
  provenance: {
    source: 'templates/Dictamen.pdf',
    generator: 'scripts/extract-template-layout.mjs',
    generatedAt: new Date().toISOString(),
  },
};
writeFileSync(outPath, JSON.stringify(layout, null, 2), 'utf8');
console.log(`OK ${outPath}`);
console.log(`Template sha256: ${templateHash}`);
console.log(`Paginas: ${layout.pageCount}, spans totales: ${layout.pages.reduce((acc, p) => acc + p.spans.length, 0)}`);

function round(value) {
  return Math.round(value * 100) / 100;
}