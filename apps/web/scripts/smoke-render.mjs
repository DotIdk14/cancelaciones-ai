// Smoke test NON_PRODUCTION del renderer del Dictamen (node plano, sin loader TS).
// Bundlea src/server/reporting/render.ts con esbuild y valida con pdfjs:
// sello de borrador, anexo de evidencias, determinismo y rasteriza la pagina 1.
// Uso: pnpm --filter @cancelaciones/web exec node scripts/smoke-render.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';

const root = resolve('../../');
const outDir = resolve('tmp-render-smoke');
mkdirSync(outDir, { recursive: true });

// Bundle del renderer TS -> JS plano (evita loaders que rompen pdfjs).
const bundlePath = resolve(outDir, 'render.bundle.mjs');
buildSync({
  entryPoints: [resolve('src/server/reporting/render.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundlePath,
  logLevel: 'silent',
});
const { renderDictamenPdf } = await import(pathToFileURL(bundlePath).href);

const templateBytes = new Uint8Array(readFileSync(resolve(root, 'templates/Dictamen.pdf')));

const input = {
  auditId: 'audit_smoke',
  docFingerprint: 'doc-fp-smoke-1',
  generatedAtIso: '2026-09-23T12:00:00.000Z',
  fields: {
    nombre: 'Alumno Sintetico',
    matricula: 'MAT-001',
    correo: 'alumno.sintetico@example.com',
    canal: 'Ventas',
    programa: 'Licenciatura en Administracion',
    fechaCreacion: '05/09/2026',
    politica: 'GDM_GAM_PRD_MLG_003 V2026.1',
    motivo: 'Solicitud de cancelacion antes del inicio de ciclo',
    descripcion: 'Solicitud recibida por canal oficial dentro del periodo permitido.',
    comentariosBO: 'Solicitud registrada por Back Office.',
    comentariosSER: 'Sin actividades academicas registradas.',
    dictamen: 'Resultado sugerido: CANCELACION_DE_VENTA. Se confirma el resultado sugerido por la maquina.',
  },
  selectedEvidence: [
    { fileName: 'solicitud-estudiante.pdf', sha256: 'aa'.repeat(32), page: 1, note: null },
    { fileName: 'intentos-contacto.png', sha256: 'bb'.repeat(32), page: null, note: 'CRM: 3 intentos registrados' },
  ],
};

async function pdfTextOf(bytes) {
  // Copia a un ArrayBuffer independiente: los bytes de pdf-lib pueden vivir en
  // el pool compartido de Node y Node rechaza transferir ese buffer.
  const lt = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const pdf = await lt.promise;
  const parts = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items) if ('str' in item) parts.push(item.str);
  }
  await lt.destroy();
  return parts.join('\n');
}

const draft = await renderDictamenPdf({ ...input, kind: 'DRAFT', templateBytes });
const final = await renderDictamenPdf({ ...input, kind: 'FINAL', templateBytes });
writeFileSync(resolve(outDir, 'draft.pdf'), draft);
writeFileSync(resolve(outDir, 'final.pdf'), final);

const draftSha = createHash('sha256').update(draft).digest('hex');
const finalSha = createHash('sha256').update(final).digest('hex');
console.log('draft sha256:', draftSha);
console.log('final sha256:', finalSha);

const draftText = await pdfTextOf(draft);
const finalText = await pdfTextOf(final);
if (!draftText.includes('BORRADOR')) throw new Error('FALLO: el borrador no contiene el sello');
if (finalText.includes('BORRADOR')) throw new Error('FALLO: el final contiene el sello de borrador');
if (!finalText.includes('EVIDENCIAS SELECCIONADAS')) throw new Error('FALLO: falta el anexo de evidencias');
if (!finalText.includes('solicitud-estudiante.pdf')) throw new Error('FALLO: falta evidencia en anexo');
if (!finalText.includes('Alumno Sintetico')) throw new Error('FALLO: no se dibujo el nombre');
if (draftSha === finalSha) throw new Error('FALLO: draft y final son identicos');

// Rasteriza pagina 1 del final para revision visual del owner.
{
  const lt = getDocument({ data: final, useSystemFonts: true });
  const pdf = await lt.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
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
  writeFileSync(resolve(outDir, 'final-page1.png'), await canvas.encode('png'));
  console.log('PNG guardado: tmp-render-smoke/final-page1.png');
  await lt.destroy();
}

rmSync(bundlePath, { force: true });
console.log('OK smoke render: sello, anexo, determinismo y rasterizacion correctos');