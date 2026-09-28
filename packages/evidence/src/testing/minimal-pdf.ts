import { deflateSync } from 'node:zlib';

/**
 * Constructor de PDF mínimo para tests. Solo existe para tests: ninguna regla, ni
 * dato real, ni caso histórico pasa por aquí.
 *
 * Se construye a mano y con la tabla `xref` correcta a propósito. Un PDF sintético
 * con `xref` roto pasaría el test del extractor, que ignora la `xref` justamente
 * porque es un atajo, y dejaría sin probar el único camino por el que van los PDF
 * de verdad.
 */

/** Escapa lo que rompería un literal `(...)` de PDF. */
function escapePdfLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Cuerpo del stream de una página: una línea de texto por renglón, con `Tm` por renglón. */
function pageContentStream(text: string): string {
  return text
    .split('\n')
    .map((line, index) => {
      const y = 720 - index * 16;
      return `BT /F1 12 Tf 1 0 0 1 72 ${y} Tm (${escapePdfLiteral(line)}) Tj ET`;
    })
    .join('\n');
}

const FONT_OBJECT = 3;
const pageObject = (index: number): number => 4 + index * 2;
const contentObject = (index: number): number => 5 + index * 2;

/**
 * Devuelve un PDF con una página por cada texto recibido.
 *
 * `compress` reproduce la forma en que los PDF reales viajan: stream con
 * `/Filter /FlateDecode`. Los dos caminos tienen que estar probados porque el
 * extractor los maneja de forma distinta.
 */
export function buildMinimalPdf(pageTexts: string[], options: { compress?: boolean } = {}): Uint8Array {
  const compress = options.compress === true;
  const objects = new Map<number, string>();

  const kids = pageTexts.map((_text, index) => `${pageObject(index)} 0 R`).join(' ');
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(2, `<< /Type /Pages /Kids [${kids}] /Count ${pageTexts.length} >>`);
  objects.set(FONT_OBJECT, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  pageTexts.forEach((text, index) => {
    objects.set(
      pageObject(index),
      [
        '<< /Type /Page',
        '/Parent 2 0 R',
        '/MediaBox [0 0 612 792]',
        `/Resources << /Font << /F1 ${FONT_OBJECT} 0 R >> >>`,
        `/Contents ${contentObject(index)} 0 R >>`,
      ].join(' '),
    );

    const body = pageContentStream(text);
    if (compress) {
      const compressed = deflateSync(Buffer.from(body, 'latin1'));
      objects.set(
        contentObject(index),
        `<< /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n${compressed.toString('latin1')}\nendstream`,
      );
    } else {
      objects.set(
        contentObject(index),
        `<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`,
      );
    }
  });

  const maxObject = Math.max(...objects.keys());
  let pdf = '%PDF-1.7\n';
  const offsets = new Map<number, number>();
  for (let number = 1; number <= maxObject; number += 1) {
    const body = objects.get(number);
    if (body === undefined) continue;
    offsets.set(number, Buffer.byteLength(pdf, 'latin1'));
    pdf += `${number} 0 obj\n${body}\nendobj\n`;
  }

  // Cada entrada de xref ocupa exactamente 20 bytes: es lo que exige la spec del formato.
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  const size = maxObject + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f\r\n`;
  for (let number = 1; number <= maxObject; number += 1) {
    xref += `${(offsets.get(number) ?? 0).toString().padStart(10, '0')} 00000 n\r\n`;
  }
  pdf += `${xref}trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

/** PDF con la cabecera válida pero cero páginas: el caso de un archivo sin contenido. */
export function buildEmptyPdf(): Uint8Array {
  return new Uint8Array(Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', 'latin1'));
}
