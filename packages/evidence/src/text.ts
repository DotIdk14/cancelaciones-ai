/**
 * Decodificación de texto plano para contenido de evidencia.
 *
 * Reemplaza a `apps/web/src/server/jobs/blob-text.ts`: la capacidad (abrir bytes y
 * sacar texto utf-8 presentable) vive aquí y en ningún otro sitio, porque el paquete
 * que la usa no puede importar de `apps/web`.
 */

/**
 * Caracteres de control que se eliminan. Se conservan `\t`, `\n` y `\r` porque
 * son estructura del texto (separan filas de una hoja de cálculo, líneas de un
 * `.txt`), no ruido de un binario leído como texto.
 *
 * `\x7f` (DEL) se incluye porque aparece en secuencias binarias y en textos
 * copiados desde terminales.
 */
const CONTROL_CHARS_WITHOUT_STRUCTURE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** FINITE FILE SEPARATOR y sus pares: Excel los usa como fin de celda en exportaciones antiguas. */
const CELL_AND_FIELD_SEPARATORS = /[\u001c\u001d\u001e]/g;

/** BOM UTF-8/UTF-16 al inicio: si se queda, el agente ve un carácter invisible antes de la primera palabra. */
const LEADING_BOM = /^\uFEFF/;

/** Collapse de 3+ saltos de línea a 2: un CSV con celdas vacías genera paredes de saltos que no aportan nada. */
const EXCESS_NEWLINES = /\n{3,}/g;

/** Se aplica un solo trailing newline, para que el recorte sea estable al recalcular. */
function normalizeText(raw: string): string {
  return raw
    .replace(LEADING_BOM, '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS_WITHOUT_STRUCTURE, ' ')
    .replace(CELL_AND_FIELD_SEPARATORS, ' ')
    .replace(/[^\S\n]+/g, (match) => (match.includes('\t') ? '\t' : ' '))
    .replace(EXCESS_NEWLINES, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

/**
 * Lee `Blob | ArrayBuffer | Uint8Array` y devuelve texto utf-8 presentable para el agente.
 *
 * Los tres formatos producen exactamente el mismo resultado porque la normalización
 * ocurre una sola vez, sobre el buffer, no sobre el envoltorio.
 */
export async function decodeToText(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  return normalizeText(Buffer.from(await toBytes(data)).toString('utf8'));
}

/** Extrae el buffer de cualquier entrada admitida sin copiar de más cuando ya es memoria. */
export async function toBytes(data: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Tamaño aproximado en caracteres, **sin leer el contenido**: solo mira `Blob.size` o
 * el `byteLength`. Existe para decidir si un archivo cabe en el contexto antes de
 * pagarlo con una descarga, y a propósito sobreestima: en utf-8 un byte es como
 * máximo un carácter, así que un límite derivado de aquí nunca deja pasar más de lo
 * que cabe. Para el ajuste fino está `decodeToText`.
 */
export function estimateTextChars(data: Blob | ArrayBuffer | Uint8Array): number {
  if (data instanceof Blob) return data.size;
  if (data instanceof ArrayBuffer) return data.byteLength;
  return data.byteLength;
}
