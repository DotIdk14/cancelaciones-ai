import { describe, expect, it } from 'vitest';
import { decodeToText, estimateTextChars, toBytes } from './text';

// Sin anotar el tipo de retorno a propósito: el constructor devuelve
// `Uint8Array<ArrayBuffer>`, que es lo que `Blob` acepta. Anotarlo como `Uint8Array`
// a secas lo degrada a `ArrayBufferLike` y no compila.
const utf8 = (value: string) => new Uint8Array(Buffer.from(value, 'utf8'));

describe('decodeToText', () => {
  it('decodifica utf-8 con acentos y eñes sin perder caracteres', async () => {
    const texto = await decodeToText(utf8('Acta de ingreso: Ñandú, según lo acordado.'));
    expect(texto).toBe('Acta de ingreso: Ñandú, según lo acordado.');
  });

  it('quita el BOM y los caracteres de control pero conserva los saltos de línea', async () => {
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('primera línea\nsegunda línea', 'utf8'),
      Buffer.from([0x00, 0x07, 0x0b, 0x0c, 0x1b, 0x7f]),
      Buffer.from('tercera línea', 'utf8'),
    ]);

    const texto = await decodeToText(new Uint8Array(bytes));

    expect(texto.startsWith('﻿')).toBe(false);
    expect(texto).toBe('primera línea\nsegunda línea tercera línea');
  });

  it('normaliza CRLF y colapsa paredes de líneas vacías', async () => {
    const texto = await decodeToText(utf8('a\r\nb\r\n\r\n\r\n\r\nc'));
    expect(texto).toBe('a\nb\n\nc');
  });

  it('acepta Blob, ArrayBuffer y Uint8Array con el mismo resultado', async () => {
    const original = 'Contrato de desistimiento — Resolución 445';
    const bytes = utf8(original);
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const desdeBytes = await decodeToText(bytes);
    const desdeBuffer = await decodeToText(arrayBuffer);
    const desdeBlob = await decodeToText(new Blob([bytes]));

    expect(desdeBytes).toBe(original);
    expect(desdeBuffer).toBe(desdeBytes);
    expect(desdeBlob).toBe(desdeBytes);
  });

  it('devuelve cadena vacía para un contenido sin texto', async () => {
    expect(await decodeToText(new Uint8Array())).toBe('');
  });
});

describe('estimateTextChars', () => {
  it('estima por tamaño sin leer el contenido y sobreestima nunca por debajo', async () => {
    const bytes = utf8('áéíóú');
    // La estimación no decodifica Unicode: usa bytes como techo conservador.
    expect(estimateTextChars(bytes)).toBe(bytes.byteLength);
    expect(estimateTextChars(bytes)).toBeGreaterThanOrEqual((await decodeToText(bytes)).length);
  });

  it('mide Blob y ArrayBuffer por su tamaño', () => {
    const bytes = utf8('hola');
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    expect(estimateTextChars(new Blob([bytes]))).toBe(4);
    expect(estimateTextChars(arrayBuffer)).toBe(4);
    expect(estimateTextChars(bytes)).toBe(4);
  });
});

describe('toBytes', () => {
  it('devuelve los mismos bytes para las tres entradas', async () => {
    const bytes = utf8('evidencia');
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const fromArrayBuffer = await toBytes(arrayBuffer);
    const fromBlob = await toBytes(new Blob([bytes]));
    expect(Buffer.from(fromArrayBuffer).toString('utf8')).toBe('evidencia');
    expect(Buffer.from(fromBlob).toString('utf8')).toBe('evidencia');
  });
});
