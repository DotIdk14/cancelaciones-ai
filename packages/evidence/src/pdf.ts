import { inflateSync } from 'node:zlib';

/**
 * Extracción mínima de texto de PDF, sin dependencias de runtime.
 *
 * LÍMITE CONOCIDO Y DELIBERADO: esto no es un motor PDF. Recorre los objetos
 * indirectos con una expresión regular, infla los `stream` con `FlateDecode` y
 * lee los operadores de texto (`Tj`, `TJ`, `'`, `"`) con sus saltos de línea
 * aproximados a partir de `Td`/`TD`/`Tm`/`T*`.
 *
 * Consecuencias asumidas, todas reversibles por el llamador:
 *  - No reconstruye fuentes ni cmap: un PDF con texto codificado con CMaps
 *    personalizados (tipografías embebidas con subconjuntos) puede devolver `''`.
 *  - No devuelve coordenadas ni orden de lectura por columnas: una plantilla a
 *    dos columnas sale como dos bloques de texto, no en orden de lectura visual.
 *  - `maxPages` corta por número de página, no por caracteres: un PDF de 40
 *    páginas escaneadas puede devolver 40 páginas vacías.
 *
 * Cuando no logra texto útil, el llamador recibe páginas con `text: ''` y decide.
 * La alternativa (devolver un error) sería indistinguible de "el PDF no tiene
 * capa de texto", que es justo el caso que el agente debe ver como evidencia no
 * legible y no como un fallo del sistema.
 */

export interface PdfTextPage {
  /** 1-indexada, igual que la paginación que ve un humano. */
  page: number;
  text: string;
}

const DEFAULT_MAX_PAGES = 40;

/** Separación mínima (en milésimas de em) que se interpreta como cambio de línea. */
const NEWLINE_THRESHOLD = 0.5;

/** Un ajuste de kerning más negativo que esto se interpreta como espacio entre palabras. */
const SPACE_KERNING_THRESHOLD = -150;

/**
 * `pdfjs-dist` NO se usa, y la decisión es deliberada.
 *
 * Se evaluó como dependencia opcional resuelta con `createRequire`, y se descartó
 * por una razón concreta: no está en `pnpm-lock.yaml` ni en el `package.json` de
 * ningún paquete del workspace, así que solo aparece en el store virtual de pnpm.
 * Bajo un runner como vitest el resolutor de Vite lo encuentra y lo carga igual,
 * fuera de toda declaración; bajo `node` pelado no lo encuentra. El mismo código da
 * dos comportamientos distintos según quién lo ejecute, que es la peor forma de
 * dependencia posible. Y una vez cargado, `pdfjs-dist` v6 exige `Promise.try`
 * (`Promise.try is not a function` en Node 22), tirando rechazos no manejados que
 * tumban el test suite desde fuera.
 *
 * Añadirlo como dependencia de runtime, en cambio, son ~10 MB y un worker por
 * proceso, para resolver un caso que este extractor ya cubre: PDF con capa de
 * texto, que es lo que llega de un escaneo de documento firmado. Para lo que no
 * cubre, el llamador ve páginas vacías y lo reporta como evidencia no legible,
 * que es la respuesta honesta.
 *
 * Cuando aparezca una necesidad real de CMaps o de orden de lectura por columnas,
 * la decisión se toma con pdfjs declarado como dependencia, no con un gancho
 * invisible.
 */

/** `/Length 1234` no se confía: se busca el `endstream` real. Un `/Length` desalineado es la norma, no la excepción. */
const INDIRECT_OBJECT = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)\bendobj/g;
const STREAM_KEYWORD = /\bstream\r?\n?/;
const CONTENTS_REF = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/;
const CONTENTS_REF_ENTRY = /(\d+)\s+\d+\s+R/g;
const ROOT_REF = /\/Root\s+(\d+)\s+\d+\s+R/;
const KIDS_REF = /\/Kids\s*\[([^\]]*)\]/;

interface PdfObject {
  number: number;
  body: string;
}

function parseIndirectObjects(latin: string): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  INDIRECT_OBJECT.lastIndex = 0;
  let match = INDIRECT_OBJECT.exec(latin);
  while (match !== null) {
    objects.set(Number.parseInt(match[1], 10), { number: Number.parseInt(match[1], 10), body: match[3] });
    match = INDIRECT_OBJECT.exec(latin);
  }
  return objects;
}

function isPageObject(body: string): boolean {
  return /\/Type\s*\/Page(?![s])/.test(body);
}

function isPagesNode(body: string): boolean {
  return /\/Type\s*\/Pages/.test(body);
}

/**
 * Orden de lectura de las páginas siguiendo `/Root` → `/Pages` → `/Kids`.
 * Sin este recorrido el orden sería "orden de número de objeto", que coincide con
 * el orden real en casi todos los PDF generados, pero no en los que reinsignan
 * objetos. Si el árbol no se puede recorrer se cae al orden por número de objeto.
 */
function resolvePageOrder(objects: Map<number, PdfObject>, rootNumber: number | null): number[] {
  const order: number[] = [];
  const visited = new Set<number>();
  const walk = (objectNumber: number): void => {
    if (visited.has(objectNumber)) return;
    visited.add(objectNumber);
    const object = objects.get(objectNumber);
    if (!object) return;
    if (isPageObject(object.body)) {
      order.push(objectNumber);
      return;
    }
    const kids = KIDS_REF.exec(object.body);
    if (!kids || !isPagesNode(object.body)) return;
    CONTENTS_REF_ENTRY.lastIndex = 0;
    const refs: number[] = [];
    let match = CONTENTS_REF_ENTRY.exec(kids[1]);
    while (match !== null) {
      refs.push(Number.parseInt(match[1], 10));
      match = CONTENTS_REF_ENTRY.exec(kids[1]);
    }
    for (const child of refs) walk(child);
  };

  if (rootNumber !== null) walk(rootNumber);
  if (order.length === 0) {
    return [...objects.values()].filter((object) => isPageObject(object.body)).map((object) => object.number).sort((a, b) => a - b);
  }
  return order;
}

/** Devuelve los bytes del `stream` de un objeto, ya inflados si venía Flate. */
function decodeObjectStream(body: string): Buffer | null {
  const keyword = STREAM_KEYWORD.exec(body);
  if (!keyword) return null;
  const start = keyword.index + keyword[0].length;
  const end = body.lastIndexOf('endstream');
  if (end <= start) return null;
  const raw = Buffer.from(body.slice(start, end), 'latin1');
  if (!/FlateDecode/.test(body.slice(0, keyword.index))) return raw;
  try {
    return inflateSync(raw);
  } catch {
    // Stream truncado o con longitud declarada incorrecta: se devuelve vacío en
    // vez de propagar, porque una página ilegible no debe tumbar el documento entero.
    return null;
  }
}

function contentStreamsForPage(body: string, objects: Map<number, PdfObject>): string[] {
  const contents = CONTENTS_REF.exec(body);
  if (!contents) return [];
  const references: number[] = [];
  CONTENTS_REF_ENTRY.lastIndex = 0;
  let match = CONTENTS_REF_ENTRY.exec(contents[1]);
  while (match !== null) {
    references.push(Number.parseInt(match[1], 10));
    match = CONTENTS_REF_ENTRY.exec(contents[1]);
  }
  const streams: string[] = [];
  for (const reference of references) {
    const object = objects.get(reference);
    if (!object) continue;
    const decoded = decodeObjectStream(object.body);
    if (decoded) streams.push(decoded.toString('latin1'));
  }
  return streams;
}

type Token =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'operator'; value: string }
  | { kind: 'arrayStart' }
  | { kind: 'arrayEnd' };

const WHITESPACE = new Set(['\u0000', '\t', '\n', '\f', '\r', ' ']);
const DELIMITERS = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

/** Decodifica una cadena literal `(...)` con sus escapes octales y de un carácter. */
function readLiteralString(content: string, start: number): { value: string; next: number } {
  let raw = '';
  let depth = 0;
  let index = start;
  // El paréntesis de apertura es delimitador, no contenido: si se acumula en `raw`
  // cada texto extraído llega al agente con un "(" pegado al principio.
  if (content[index] === '(') {
    depth = 1;
    index += 1;
  }
  while (index < content.length) {
    const char = content[index];
    if (char === '\\') {
      const escaped = content[index + 1];
      const octal = /^[0-7]{1,3}/.exec(content.slice(index + 1, index + 4));
      if (octal) {
        raw += String.fromCharCode(Number.parseInt(octal[0], 8));
        index += 1 + octal[0].length;
        continue;
      }
      const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
      raw += simple[escaped] ?? escaped;
      index += 2;
      continue;
    }
    if (char === '(') {
      depth += 1;
      raw += char;
      index += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return { value: decodePdfStringBytes(Buffer.from(raw, 'latin1')), next: index + 1 };
      raw += char;
      index += 1;
      continue;
    }
    raw += char;
    index += 1;
  }
  return { value: decodePdfStringBytes(Buffer.from(raw, 'latin1')), next: index };
}

/** Lee una cadena hexadecimal `<48656C6C6F>`, incluidos los casos en UTF-16BE con BOM. */
function readHexString(content: string, start: number): { value: string; next: number } {
  const close = content.indexOf('>', start);
  if (close === -1) return { value: '', next: content.length };
  const hex = content.slice(start + 1, close).replace(/[^0-9A-Fa-f]/g, '');
  const padded = hex.length % 2 === 0 ? hex : `${hex}0`;
  return { value: decodePdfStringBytes(Buffer.from(padded, 'hex')), next: close + 1 };
}

/**
 * Los bytes de una cadena PDF no son texto: son PDFDocEncoding o, en PDF 2.0,
 * UTF-16BE con BOM. Se intenta UTF-16BE si hay BOM y, si no, UTF-8 estricto con
 * caída a latin1, que es la lectura correcta para los PDF generados por
 * navegadores y por la mayoría de suites de ofimática.
 */
function decodePdfStringBytes(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return bytes.subarray(2).swap16().toString('utf16le');
  }
  const utf8 = bytes.toString('utf8');
  if (Buffer.from(utf8, 'utf8').equals(bytes)) return utf8;
  return bytes.toString('latin1');
}

function tokenize(content: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < content.length) {
    const char = content[index];
    if (WHITESPACE.has(char)) {
      index += 1;
      continue;
    }
    if (char === '%') {
      const endOfComment = content.indexOf('\n', index);
      index = endOfComment === -1 ? content.length : endOfComment + 1;
      continue;
    }
    if (char === '(') {
      const literal = readLiteralString(content, index);
      tokens.push({ kind: 'string', value: literal.value });
      index = literal.next;
      continue;
    }
    if (char === '<' && content[index + 1] === '<') {
      tokens.push({ kind: 'operator', value: '<<' });
      index += 2;
      continue;
    }
    if (char === '<') {
      const hex = readHexString(content, index);
      tokens.push({ kind: 'string', value: hex.value });
      index = hex.next;
      continue;
    }
    if (char === '>' && content[index + 1] === '>') {
      tokens.push({ kind: 'operator', value: '>>' });
      index += 2;
      continue;
    }
    if (char === '>') {
      index += 1;
      continue;
    }
    if (char === '[') {
      tokens.push({ kind: 'arrayStart' });
      index += 1;
      continue;
    }
    if (char === ']') {
      tokens.push({ kind: 'arrayEnd' });
      index += 1;
      continue;
    }
    const end = findTokenEnd(content, index);
    const word = content.slice(index, end);
    index = end;
    if (word.length === 0) {
      index += 1;
      continue;
    }
    const asNumber = Number(word);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word) && Number.isFinite(asNumber)) {
      tokens.push({ kind: 'number', value: asNumber });
      continue;
    }
    tokens.push({ kind: 'operator', value: word });
  }
  return tokens;
}

function findTokenEnd(content: string, start: number): number {
  let index = start;
  while (index < content.length && !WHITESPACE.has(content[index]) && !DELIMITERS.has(content[index])) index += 1;
  return index;
}

/** Números que preceden a un operador, en orden de aparición. */
function operandNumbersBefore(tokens: Token[], operatorIndex: number): number[] {
  const numbers: number[] = [];
  for (let index = operatorIndex - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token.kind === 'number') {
      numbers.unshift(token.value);
      continue;
    }
    break;
  }
  return numbers;
}

/** Último argumento de un array `TJ`, emparejando corchetes hacia atrás. */
function arrayBetween(tokens: Token[], arrayStartIndex: number): Token[] {
  const inner: Token[] = [];
  let depth = 0;
  for (let index = arrayStartIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind === 'arrayStart') depth += 1;
    if (token.kind === 'arrayEnd') {
      if (depth === 0) return inner;
      depth -= 1;
    }
    inner.push(token);
  }
  return inner;
}

/** Última cadena antes de un operador de показа de texto. */
function stringBefore(tokens: Token[], operatorIndex: number): string {
  for (let index = operatorIndex - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token.kind === 'string') return token.value;
    if (token.kind === 'operator') return '';
  }
  return '';
}

function arrayStartBefore(tokens: Token[], operatorIndex: number): number {
  for (let index = operatorIndex - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token.kind === 'arrayEnd') return -1;
    if (token.kind === 'arrayStart') return index;
    if (token.kind === 'operator') return -1;
  }
  return -1;
}

function cleanExtractedText(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function textFromContentStream(content: string): string {
  const tokens = tokenize(content);
  let output = '';
  let lastY: number | null = null;

  const breakLine = (): void => {
    if (output.length === 0) return;
    if (!output.endsWith('\n')) output += '\n';
  };
  const separate = (): void => {
    if (output.length > 0 && !output.endsWith('\n') && !output.endsWith(' ')) output += ' ';
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== 'operator') continue;
    const operator = token.value;

    if (operator === 'Tj' || operator === "'") {
      output += stringBefore(tokens, index);
      if (operator === "'") breakLine();
      continue;
    }
    if (operator === '"') {
      output += stringBefore(tokens, index);
      breakLine();
      continue;
    }
    if (operator === 'TJ') {
      const arrayStartIndex = arrayStartBefore(tokens, index);
      if (arrayStartIndex === -1) continue;
      for (const item of arrayBetween(tokens, arrayStartIndex)) {
        if (item.kind === 'string') output += item.value;
        if (item.kind === 'number' && item.value <= SPACE_KERNING_THRESHOLD) separate();
      }
      continue;
    }
    if (operator === 'T*' || operator === 'BT' || operator === 'ET') {
      if (operator !== 'BT') breakLine();
      continue;
    }
    if (operator === 'Td' || operator === 'TD') {
      const operands = operandNumbersBefore(tokens, index);
      const y = operands[operands.length - 1] ?? null;
      if (lastY !== null && y !== null) {
        if (Math.abs(y - lastY) > NEWLINE_THRESHOLD) breakLine();
        else separate();
      }
      if (y !== null) lastY = y;
      continue;
    }
    if (operator === 'Tm') {
      const operands = operandNumbersBefore(tokens, index);
      const y = operands.length >= 6 ? operands[5] : null;
      if (lastY !== null && y !== null) {
        if (Math.abs(y - lastY) > NEWLINE_THRESHOLD) breakLine();
        else separate();
      }
      if (y !== null) lastY = y;
    }
  }

  return cleanExtractedText(output);
}

/**
 * Extrae el texto de un PDF por páginas.
 *
 * Nunca lanza por contenido ilegible: un PDF escaneado, corrupto o con texto
 * codificado con CMaps devuelve páginas con `text: ''`. Quien llama decide si eso
 * es un `FAILED` operativo o una evidencia que el agente debe leer como no legible.
 */
export async function extractPdfText(data: ArrayBuffer | Uint8Array, maxPages = DEFAULT_MAX_PAGES): Promise<PdfTextPage[]> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const latin = Buffer.from(bytes).toString('latin1');
  const objects = parseIndirectObjects(latin);
  if (objects.size === 0) return [];

  const rootMatch = ROOT_REF.exec(latin);
  const pageNumbers = resolvePageOrder(objects, rootMatch ? Number.parseInt(rootMatch[1], 10) : null);

  const pages: PdfTextPage[] = [];
  for (let position = 0; position < pageNumbers.length && position < maxPages; position += 1) {
    const object = objects.get(pageNumbers[position]);
    const streams = object ? contentStreamsForPage(object.body, objects) : [];
    const text = streams.map((stream) => textFromContentStream(stream)).filter((part) => part.length > 0).join('\n');
    pages.push({ page: position + 1, text });
  }
  return pages;
}

const PAGE_MARKER = (page: number): string => `[[página ${page}]]`;

/**
 * Concatena páginas con marcador explícito y recorta a `maxChars`.
 *
 * El marcador importa: sin él, un texto recortado a mitad de una frase es
 * indistinguible de un documento que realmente terminaba ahí, y el agente
 * trataría una omisión como una afirmación.
 */
export function slicePagesForContext(pages: PdfTextPage[], maxChars: number): string {
  const blocks: string[] = [];
  let used = 0;
  let truncated = false;
  for (const page of pages) {
    const pageText = page.text.trim();
    if (pageText.length === 0) continue;
    const block = `${PAGE_MARKER(page.page)}\n${pageText}`;
    if (used + block.length + 1 > maxChars) {
      const remaining = maxChars - used;
      if (remaining > PAGE_MARKER(page.page).length + 2) {
        blocks.push(`${block.slice(0, remaining).trimEnd()}\n[[texto recortado por límite de contexto]]`);
      } else if (blocks.length > 0) {
        blocks.push('[[texto recortado por límite de contexto]]');
      }
      truncated = true;
      break;
    }
    blocks.push(block);
    used += block.length + 1;
  }
  if (truncated) blocks.push(`[[el resto de las páginas no caben en el contexto disponible]]`);
  return blocks.join('\n\n');
}
