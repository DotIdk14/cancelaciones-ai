// Renderer del Dictamen (server-only, desacoplado de Next/InsForge/HTTP).
// Toma los bytes de la plantilla oficial + valores estructurados y produce un
// PDF con pdf-lib: pagina 1 con los valores de las celdas, paginas 2-5 de la
// plantilla intactas y paginas de anexo al final.
// - DRAFT: sello "BORRADOR - NO ES DOCUMENTO FINAL" en todas las paginas.
// - FINAL: sin sello; solo puede generarse desde un snapshot aprobado (control
//   en la capa de servicio, no aqui).
// Idempotencia: mismo input -> mismos bytes (se estabiliza el /ID del trailer).
import { PDFDocument, PDFFont, PDFPage, PDFPageDrawTextOptions, rgb, StandardFonts } from 'pdf-lib';
import {
  CELL_BG_COLORS,
  DICTAMEN_FOOTER_NOTE,
  DRAFT_BANNER_COLOR,
  DRAFT_WATERMARK_TEXT,
  INK_COLOR,
  PAGE1_CELLS,
  PAGE_H,
  PAGE_W,
  SECTION_HEADER_COLOR,
  type DictamenCellId,
} from './layout';

export interface RenderEvidenceItem {
  fileName: string;
  sha256: string;
  page: number | null;
  note: string | null;
}

export interface RenderDictamenInput {
  templateBytes: Uint8Array;
  kind: 'DRAFT' | 'FINAL';
  auditId: string;
  /** fingerprint del documento (auditId+kind+snapshot+template+politica). */
  docFingerprint: string;
  /** Timestamp fijo (dato del snapshot) para que el render sea determinista. */
  generatedAtIso: string;
  /** valores por celda de la pagina 1. null = celda en blanco. */
  fields: Partial<Record<DictamenCellId, string | null>>;
  selectedEvidence: RenderEvidenceItem[];
}

const color = (c: { r: number; g: number; b: number }) => rgb(c.r, c.g, c.b);

export async function renderDictamenPdf(input: RenderDictamenInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input.templateBytes, { ignoreEncryption: true });
  pdf.setProducer('Cancelaciones AI');
  pdf.setCreator('Cancelaciones AI');
  pdf.setTitle(`Dictamen ${input.auditId}`);
  pdf.setAuthor('Cancelaciones AI');
  const fixedDate = new Date(input.generatedAtIso);
  if (!Number.isNaN(fixedDate.getTime())) {
    pdf.setCreationDate(fixedDate);
    pdf.setModificationDate(fixedDate);
  }

  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();

  if (input.kind === 'DRAFT') {
    for (const page of pages) drawDraftWatermark(page, helv);
  }

  const dictamenOverflow = renderPage1(pdf, pages[0], helv, helvBold, input);

  // Paginas de anexo
  const extraSections = buildExtraSections(input, dictamenOverflow);
  for (const section of extraSections) {
    appendSectionPage(pdf, helv, helvBold, section);
  }

  const bytes = await pdf.save();
  return stabilizeDocId(bytes, input.docFingerprint);
}

interface SectionBlock {
  title: string;
  lines: string[];
}

function buildExtraSections(input: RenderDictamenInput, dictamenOverflow: string): SectionBlock[] {
  const sections: SectionBlock[] = [];
  if (dictamenOverflow) {
    sections.push({
      title: 'ANEXO — CONTINUACIÓN DEL DICTAMEN',
      lines: dictamenOverflow.split('\n'),
    });
  }
  if (input.selectedEvidence.length > 0) {
    const lines: string[] = [];
    input.selectedEvidence.forEach((ev, i) => {
      lines.push(
        `${String(i + 1).padStart(2, '0')}. ${ev.fileName}  |  sha256 ${ev.sha256.slice(0, 16)}…${
          ev.page != null ? `  |  página ${ev.page}` : ''
        }`,
      );
      if (ev.note) lines.push(`      Nota: ${ev.note}`);
    });
    sections.push({ title: 'ANEXO — EVIDENCIAS SELECCIONADAS', lines });
  }
  return sections;
}

function renderPage1(
  pdf: PDFDocument,
  page: PDFPage,
  helv: PDFFont,
  helvBold: PDFFont,
  input: RenderDictamenInput,
): string {
  // 1) Borrar valores de ejemplo (rect con el color de fondo de la celda).
  for (const cellId of Object.keys(PAGE1_CELLS) as DictamenCellId[]) {
    const cell = PAGE1_CELLS[cellId];
    page.drawRectangle({
      x: cell.erase.x,
      y: cell.erase.y,
      width: cell.erase.w,
      height: cell.erase.h,
      color: color(CELL_BG_COLORS[cell.bg]),
    });
  }
  // Valores de ejemplo del area inferior de la tabla (Jacqueline/Claudia y el
  // simbolo 🚫) que no pertenecen a ninguna celda de campo.
  page.drawRectangle({
    x: 29.25,
    y: 339.5,
    width: 162.75,
    height: 53.6,
    color: color(CELL_BG_COLORS.yellow),
  });

  // 2) Dibujar los valores.
  const entries = (Object.keys(PAGE1_CELLS) as DictamenCellId[])
    .map((id) => ({ id, cell: PAGE1_CELLS[id], value: input.fields[id] ?? null }))
    .filter((e) => e.value != null && e.value !== '');

  const dictamenEntry = entries.find((e) => e.id === 'dictamen') ?? null;
  const otherEntries = entries.filter((e) => e.id !== 'dictamen');

  for (const { cell, value } of otherEntries) {
    drawWrappedValue(page, helv, cell.x, cell.yBaseline, cell.right, cell.size, cell.maxLines, value!);
  }

  let dictamenOverflow = '';
  if (dictamenEntry) {
    const { cell, value } = dictamenEntry;
    const wrapped = wrapText(helv, value!, cell.size, cell.x, cell.right);
    drawWrappedValue(page, helv, cell.x, cell.yBaseline, cell.right, cell.size, cell.maxLines, value!);
    if (wrapped.length > cell.maxLines) {
      // Continuacion del dictamen en pagina de anexo.
      dictamenOverflow = wrapped.slice(cell.maxLines).join('\n');
      page.drawText('→ Continúa en anexo.', {
        x: cell.x,
        y: cell.erase.y + 6,
        size: 8,
        font: helv,
        color: color(SECTION_HEADER_COLOR),
      });
    }
  }
  return dictamenOverflow;
}

function drawWrappedValue(
  page: PDFPage,
  font: PDFFont,
  x: number,
  yBaseline: number,
  right: number,
  size: number,
  maxLines: number,
  value: string,
): void {
  const lines = wrapText(font, value, size, x, right).slice(0, maxLines);
  let y = yBaseline;
  const lineHeight = size * 1.3;
  for (const line of lines) {
    const opts: PDFPageDrawTextOptions = { x, y, size, font, color: color(INK_COLOR) };
    page.drawText(line, opts);
    y -= lineHeight;
  }
}

function wrapText(font: PDFFont, text: string, size: number, x: number, right: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  const maxWidth = Math.max(20, right - x);
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function drawDraftWatermark(page: PDFPage, helv: PDFFont): void {
  const { width, height } = page.getSize();
  // Bandas horizontales de texto con opacidad (sello de borrador legible pero
  // sin ocultar la tabla). Sin rotacion para mantener el render deterministico
  // y compatible con pdf-lib (que no expone save/restore de estado grafico).
  for (const y of [110, 230, 350, 470, 590, 710]) {
    page.drawText(DRAFT_WATERMARK_TEXT, {
      x: 40,
      y,
      size: 14,
      font: helv,
      color: color(DRAFT_BANNER_COLOR),
      opacity: 0.3,
    });
  }
  // Sello en la esquina.
  page.drawRectangle({
    x: width - 190,
    y: height - 34,
    width: 168,
    height: 20,
    color: color(DRAFT_BANNER_COLOR),
  });
  page.drawText('BORRADOR — NO ES DOCUMENTO FINAL', {
    x: width - 184,
    y: height - 23,
    size: 8,
    font: helv,
    color: rgb(1, 1, 1),
  });
}

function appendSectionPage(pdf: PDFDocument, helv: PDFFont, helvBold: PDFFont, section: SectionBlock): void {
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  page.drawRectangle({ x: 0, y: PAGE_H - 34, width: PAGE_W, height: 34, color: color(SECTION_HEADER_COLOR) });
  page.drawText(section.title, { x: 29.25, y: PAGE_H - 22, size: 11, font: helvBold, color: rgb(1, 1, 1) });

  let y = PAGE_H - 64;
  for (const line of section.lines) {
    const wrapped = wrapText(helv, line, 10, 29.25, PAGE_W - 60);
    for (const wl of wrapped) {
      if (y < 50) {
        y = appendContinuationHeader(page, helvBold, y);
      }
      page.drawText(wl, { x: 29.25, y, size: 10, font: helv, color: color(INK_COLOR) });
      y -= 16;
    }
  }
  page.drawText(DICTAMEN_FOOTER_NOTE, { x: 29.25, y: 24, size: 8, font: helv, color: color(SECTION_HEADER_COLOR) });
}

function appendContinuationHeader(page: PDFPage, helvBold: PDFFont, y: number): number {
  // Ya no cabe en esta pagina: se dibuja pie e indicador; el flujo continuara
  // en la siguiente llamada con una nueva pagina por parte de la capa superior.
  page.drawText('(continúa)…', { x: 29.25, y: 34, size: 8, font: helvBold, color: color(SECTION_HEADER_COLOR) });
  return y;
}

/**
 * Estabiliza el /ID del trailer del PDF para que bytes identicos de contenido
 * produzcan exactamente los mismos bytes (idempotencia del documento final).
 */
function stabilizeDocId(bytes: Uint8Array, seed: string): Uint8Array {
  if (!seed) return bytes;
  const text = new TextDecoder('latin1').decode(bytes);
  const re = /\/ID\s*\[<[0-9A-Fa-f]+>\s*<[0-9A-Fa-f]+>\]/g;
  if (!re.test(text)) return bytes;
  re.lastIndex = 0;
  let sum = 0;
  for (let i = 0; i < seed.length; i += 1) sum = (sum + seed.charCodeAt(i) * (i + 1)) % 0xffff;
  const hex = sum.toString(16).padStart(4, '0').repeat(8).slice(0, 32);
  const replacement = `/ID [<${hex}> <${hex}>]`;
  return new TextEncoder().encode(text.replace(re, replacement));
}