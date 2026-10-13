import { expect, it, vi } from 'vitest';
import { extractPdfText } from '../src/server/pdf';

it('extrae texto con fuente estándar sin advertencia por standardFontDataUrl', async () => {
  const stream = 'BT /F1 12 Tf 40 100 Td (Texto PDF de prueba) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    expect(await extractPdfText(Buffer.from(pdf))).toContain('Texto PDF de prueba');
    expect(output.mock.calls.flat().join(' ')).not.toContain('standardFontDataUrl');
  } finally { output.mockRestore(); }
});
