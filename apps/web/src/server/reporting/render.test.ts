import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderDictamenPdf } from './render';

const templateBytes = new Uint8Array(
  readFileSync(resolve(process.cwd(), '../../templates/Dictamen.pdf')),
);

const baseInput = {
  auditId: 'audit_1',
  docFingerprint: 'doc-fp-1',
  generatedAtIso: '2026-09-23T12:00:00.000Z',
  fields: {
    nombre: 'Alumno Sintetico',
    matricula: 'MAT-001',
    correo: 'alumno@example.com',
    canal: 'Ventas',
    programa: 'Ingenieria',
    politica: 'GDM_GAM_PRD_MLG_003',
    motivo: 'Solicitud antes de inicio de ciclo',
    dictamen: 'Resultado sugerido: CANCELACION_DE_VENTA. Pendiente de revisión humana.',
  },
  selectedEvidence: [
    { fileName: 'evidencia-1.pdf', sha256: 'aaaa'.repeat(16), page: 1, note: null },
    { fileName: 'captura-crm.png', sha256: 'bbbb'.repeat(16), page: null, note: 'Pantalla del CRM' },
  ],
};

async function render(kind: 'DRAFT' | 'FINAL', input = baseInput) {
  return renderDictamenPdf({ ...input, kind, templateBytes });
}

/** Rasteriza/carga con pdfjs (copia los bytes: pdf-lib usa el pool de Node y
 *  Node rechaza transferir ese buffer por LoopbackPort). */
async function loadPdf(bytes: Uint8Array) {
  const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const pdf = await loadingTask.promise;
  const parts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if ('str' in item) parts.push(item.str);
    }
  }
  await loadingTask.destroy();
  return { numPages: pdf.numPages, text: parts.join('\n') };
}

describe('renderDictamenPdf', () => {
  it('produce bytes PDF validos y con numero de paginas correcto', async () => {
    const bytes = await render('FINAL');
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(100_000);
    const { numPages } = await loadPdf(bytes);
    expect(numPages).toBe(6); // 5 plantilla + 1 anexo
  });

  it('es deterministico: mismo snapshot aprobado -> mismos bytes', async () => {
    const a = await render('FINAL');
    const b = await render('FINAL');
    expect(createHash('sha256').update(a).digest('hex')).toBe(createHash('sha256').update(b).digest('hex'));
  });

  it('BORRADOR != FINAL y el borrador lleva sello de agua', async () => {
    const draft = await render('DRAFT');
    const final = await render('FINAL');
    expect(createHash('sha256').update(draft).digest('hex')).not.toBe(
      createHash('sha256').update(final).digest('hex'),
    );
    const draftText = await loadPdf(draft);
    const finalText = await loadPdf(final);
    expect(draftText.text).toContain('BORRADOR');
    expect(finalText.text).not.toContain('BORRADOR');
  });

  it('anexa pagina(s) de evidencias seleccionadas', async () => {
    const { text } = await loadPdf(await render('FINAL'));
    expect(text).toContain('EVIDENCIAS SELECCIONADAS');
    expect(text).toContain('evidencia-1.pdf');
    expect(text).toContain('captura-crm.png');
  });

  it('sin evidencias no agrega anexo (5 paginas)', async () => {
    const { numPages } = await loadPdf(await render('FINAL', { ...baseInput, selectedEvidence: [] }));
    expect(numPages).toBe(5);
  });
});