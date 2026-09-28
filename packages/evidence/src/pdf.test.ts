import { describe, expect, it } from 'vitest';
import { extractPdfText, slicePagesForContext } from './pdf';
import { buildEmptyPdf, buildMinimalPdf } from './testing/minimal-pdf';

const bufferOf = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

describe('extractPdfText', () => {
  it('lee el texto literal de un PDF sintetizado con una página por línea', async () => {
    const pdf = buildMinimalPdf(['Hola mundo', 'Segunda pagina']);
    const pages = await extractPdfText(bufferOf(pdf));

    expect(pages).toHaveLength(2);
    expect(pages[0].page).toBe(1);
    expect(pages[0].text).toBe('Hola mundo');
    expect(pages[1].page).toBe(2);
    expect(pages[1].text).toBe('Segunda pagina');
  });

  it('respeta el tope de páginas', async () => {
    const pdf = buildMinimalPdf(['uno', 'dos', 'tres', 'cuatro']);
    const pages = await extractPdfText(bufferOf(pdf), 2);
    expect(pages).toHaveLength(2);
    expect(pages.map((page) => page.page)).toEqual([1, 2]);
  });

  it('devuelve páginas vacías en vez de lanzar cuando el PDF no tiene texto', async () => {
    const pages = await extractPdfText(bufferOf(buildEmptyPdf()));
    expect(pages).toEqual([]);
  });

  it('no lanza con basura que solo empieza como un PDF', async () => {
    const basura = new Uint8Array(Buffer.from('%PDF-1.7\nesto no es un pdf en absoluto', 'latin1'));
    await expect(extractPdfText(bufferOf(basura))).resolves.toEqual([]);
  });

  it('infla un stream comprimido con FlateDecode, que es como viajan los PDF reales', async () => {
    const pdf = buildMinimalPdf(['Texto comprimido', 'Segunda del comprimida'], { compress: true });
    const pages = await extractPdfText(bufferOf(pdf));

    expect(pages).toHaveLength(2);
    expect(pages[0].text).toBe('Texto comprimido');
    expect(pages[1].text).toBe('Segunda del comprimida');
  });

  it('lee un literal con paréntesis escapados sin cortar el texto', async () => {
    const pdf = buildMinimalPdf(['Estudiante (Ana Pérez) solicito']);
    const pages = await extractPdfText(bufferOf(pdf));
    expect(pages[0].text).toBe('Estudiante (Ana Pérez) solicito');
  });

  it('lee varias líneas de una página en el orden en que se dibujaron', async () => {
    const pdf = buildMinimalPdf(['linea uno\nlinea dos\nlinea tres']);
    const pages = await extractPdfText(bufferOf(pdf));
    expect(pages[0].text.split('\n')).toEqual(['linea uno', 'linea dos', 'linea tres']);
  });
});

describe('slicePagesForContext', () => {
  it('concatena con marcador de página visible', () => {
    const salida = slicePagesForContext(
      [
        { page: 1, text: 'Hola mundo' },
        { page: 2, text: 'Segunda pagina' },
      ],
      500,
    );
    expect(salida).toBe('[[página 1]]\nHola mundo\n\n[[página 2]]\nSegunda pagina');
  });

  it('salta las páginas sin texto', () => {
    const salida = slicePagesForContext(
      [
        { page: 1, text: '' },
        { page: 2, text: 'contenido' },
      ],
      500,
    );
    expect(salida).toBe('[[página 2]]\ncontenido');
  });

  it('marca el recorte para que la omisión no se lea como el final del documento', () => {
    const salida = slicePagesForContext(
      [
        { page: 1, text: 'primer bloque' },
        { page: 2, text: 'segundo bloque' },
      ],
      40,
    );
    expect(salida).toContain('[[página 1]]');
    expect(salida).toContain('[[texto recortado por límite de contexto]]');
    expect(salida).toContain('[[el resto de las páginas no caben en el contexto disponible]]');
    expect(salida.length).toBeLessThanOrEqual(140);
  });

  it('devuelve cadena vacía si no hay ninguna página con texto', () => {
    expect(slicePagesForContext([{ page: 1, text: '   ' }], 500)).toBe('');
  });
});
