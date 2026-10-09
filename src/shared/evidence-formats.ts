// =============================================================================
// Vocabulario canónico de formatos de evidencia.
//
// Es la ÚNICA fuente de verdad compartida entre cliente y servidor para la
// allowlist de MIMEs y las reglas de firma (magic bytes). Debe ser importable
// desde el bundle del navegador: sin `node:*`, sin InsForge, sin React.
// =============================================================================

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

export interface SignatureRule {
  mime: string;
  /** Posiciones donde debe aparecer la marca (offsets desde el inicio). */
  marks: Array<{ offset: number; bytes: number[] }>;
  /** Tolerancia: si el buffer no tiene suficientes bytes, no se juzga. */
  minLength: number;
}

export const EVIDENCE_SIGNATURES: SignatureRule[] = [
  { mime: 'application/pdf', marks: [{ offset: 0, bytes: ascii('%PDF-') }], minLength: 5 },
  { mime: 'image/jpeg', marks: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }], minLength: 3 },
  {
    mime: 'image/png',
    marks: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
    minLength: 8,
  },
  { mime: 'image/gif', marks: [{ offset: 0, bytes: ascii('GIF8') }], minLength: 4 },
  // WebP: "RIFF" en 0 y "WEBP" en 8.
  {
    mime: 'image/webp',
    marks: [
      { offset: 0, bytes: ascii('RIFF') },
      { offset: 8, bytes: ascii('WEBP') },
    ],
    minLength: 12,
  },
  // WAV: RIFF....WAVE
  {
    mime: 'audio/wav',
    marks: [
      { offset: 0, bytes: ascii('RIFF') },
      { offset: 8, bytes: ascii('WAVE') },
    ],
    minLength: 12,
  },
  // M4A/MP4 (container ISO-BMFF): "ftyp" en el offset 4.
  { mime: 'audio/mp4', marks: [{ offset: 4, bytes: ascii('ftyp') }], minLength: 8 },
  { mime: 'audio/x-m4a', marks: [{ offset: 4, bytes: ascii('ftyp') }], minLength: 8 },
  { mime: 'audio/m4a', marks: [{ offset: 4, bytes: ascii('ftyp') }], minLength: 8 },
  // OGG: "OggS"
  { mime: 'audio/ogg', marks: [{ offset: 0, bytes: ascii('OggS') }], minLength: 4 },
  // WebM/Matroska: EBML 0x1A45DFA3
  { mime: 'audio/webm', marks: [{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }], minLength: 4 },
];

/** MIMEs que el servidor considera evidencia válida. */
export const EVIDENCE_MIME_ALLOWLIST = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/webm',
  'audio/ogg',
  'text/plain',
]);

const headCache = new WeakMap<Blob, Uint8Array>();

function readBlobWithFileReader(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Lee los primeros bytes de un archivo de forma compatible con navegadores y
 * entornos de prueba (jsdom). Prefiere `Blob.arrayBuffer()` cuando el corte lo
 * expone; si no, usa `FileReader` sobre el slice para no cargar archivos grandes.
 *
 * El resultado se cachea por `Blob` para evitar lecturas duplicadas cuando el
 * validador previo y `uploadEvidence` leen la misma cabecera.
 */
export async function readEvidenceHead(file: File, byteCount = 16): Promise<Uint8Array> {
  const cached = headCache.get(file);
  if (cached !== undefined) return cached;

  const slice = file.slice(0, byteCount);
  let buffer: ArrayBuffer;
  if (typeof slice.arrayBuffer === 'function') {
    buffer = await slice.arrayBuffer();
  } else {
    buffer = await readBlobWithFileReader(slice);
  }
  const head = new Uint8Array(buffer);
  headCache.set(file, head);
  return head;
}

/**
 * Cabecera ID3v2 REAL, no el prefijo de 3 letras.
 *
 * `ID3` a secas son tres bytes ASCII que un archivo de texto puede empezar
 * con ("ID3 tags son metadatos…"). Una cabecera de verdad trae versión
 * mayor, flags válidos y un tamaño *syncsafe* (los cuatro bytes < 0x80).
 */
function hasId3v2Header(head: Uint8Array): boolean {
  if (head.length < 10) return false;
  if (head[0] !== ascii('I')[0] || head[1] !== ascii('D')[0] || head[2] !== ascii('3')[0]) {
    return false;
  }
  const major = head[3]!;
  if (major < 2 || major > 4) return false; // solo ID3v2.2 / 2.3 / 2.4
  if ((head[5]! & 0xe0) !== 0) return false; // solo existen los 5 flags bajos
  for (let i = 6; i < 10; i += 1) {
    if (head[i]! >= 0x80) return false; // tamaño syncsafe
  }
  return true;
}

/**
 * Frame header MPEG plausible: 11 bits de sync, versión y capa no reservadas,
 * índice de bitrate y de sample rate no reservados.
 *
 * El sync por sí solo son 2 bytes y aparecen en binario y en texto (el BOM
 * UTF-16LE `FF FE` los cumple), así que por sí solo NO prueba que sea audio.
 */
function hasMpegFrameHeader(head: Uint8Array): boolean {
  if (head.length < 3) return false;
  if (head[0] !== 0xff) return false;
  const second = head[1]!;
  if ((second & 0xe0) !== 0xe0) return false; // 11 bits de sync
  if ((second & 0x18) === 0x08) return false; // versión reservada
  if ((second & 0x06) === 0x00) return false; // capa reservada
  const third = head[2]!;
  if ((third & 0xf0) === 0xf0) return false; // índice de bitrate reservado
  if ((third & 0x0c) === 0x0c) return false; // índice de sample rate reservado
  return true;
}

/**
 * Firmas que por sí solas no distinguen el subtipo real del contenedor:
 * - ISO-BMFF (`ftyp`) es compartido por audio y video.
 * - EBML (`1A 45 DF A3`) es compartido por webm audio, webm video y mkv.
 * - MPEG frame-sync: 2 bytes que el BOM UTF-16LE `FF FE` también cumple.
 */
const AMBIGUOUS_SIGNATURE_MIMES = new Set(['audio/mp4', 'audio/webm']);

function isAmbiguousMimeDetection(head: Uint8Array, detected: string): boolean {
  if (AMBIGUOUS_SIGNATURE_MIMES.has(detected)) return true;
  if (detected === 'audio/mpeg') {
    // Una cabecera ID3v2 completa sí prueba MPEG audio; el frame sync, no.
    return !hasId3v2Header(head);
  }
  return false;
}

/**
 * Resuelve el MIME que el cliente debe declarar combinando la firma real del
 * archivo con el MIME declarado por el browser/SO.
 *
 * - Firma inequívoca (JPEG, PNG, GIF, PDF, RIFF WEBP/WAVE, Ogg, ID3) → manda la
 *   firma. Aquí vive el arreglo del caso real: un JPEG con extensión `.png` se
 *   declara `image/jpeg` en vez de `image/png`.
 * - Firma ambigua (ISO-BMFF, EBML, frame-sync MPEG) → manda la DECLARACIÓN
 *   explícita: elegir la firma por defecto promovería en silencio un video a
 *   audio y dispararía una transcripción pagada, además de falsear el
 *   `mime_type` persistido. Sin declaración útil NO se decide: se devuelve
 *   `null` y el cliente rechaza en local, porque en un contenedor ambiguo
 *   cobrar por una transcripción equivocada es más caro que pedir una
 *   extensión.
 * - Sin firma (texto plano) → manda la declaración.
 *
 * Limitación residual: un contenedor declarado explícitamente como audio
 * (p. ej. un video renombrado `.m4a`) no puede distinguirse sin leer la caja
 * `moov`/handler. El servidor mantiene la cuota de transcripción como cota de
 * ese caso; no se resuelve aquí con más heurísticas.
 */
export function resolveEvidenceMime(head: Uint8Array, declaredMime: string): string | null {
  const detected = detectEvidenceMime(head);
  if (detected === null) {
    return declaredMime !== '' ? declaredMime : null;
  }

  if (!isAmbiguousMimeDetection(head, detected)) {
    return detected;
  }

  const normalized = declaredMime.toLowerCase().split(';')[0]?.trim() ?? '';
  if (normalized !== '' && normalized !== 'application/octet-stream') {
    return normalized;
  }
  return null;
}

/**
 * Detecta el MIME REAL de un archivo a partir de sus primeros bytes.
 *
 * - Devuelve `null` si no reconoce ninguna firma soportada (p. ej. texto
 *   plano, que no tiene magic bytes).
 * - Para MP3 devuelve `audio/mpeg` tanto con cabecera ID3 como con frame sync.
 * - Para contenedores ISO-BMFF devuelve `audio/mp4`.
 * - Desambigua RIFF por el formato en offset 8 (WEBP vs WAVE).
 */
export function detectEvidenceMime(head: Uint8Array): string | null {
  if (head.length === 0) return null;

  // MP3: cabecera ID3v2 completa o un frame header MPEG plausible.
  if (hasId3v2Header(head) || hasMpegFrameHeader(head)) return 'audio/mpeg';

  for (const rule of EVIDENCE_SIGNATURES) {
    if (head.length < rule.minLength) continue;
    let matched = true;
    for (const mark of rule.marks) {
      for (let i = 0; i < mark.bytes.length; i += 1) {
        if (head[mark.offset + i] !== mark.bytes[i]) {
          matched = false;
          break;
        }
      }
      if (!matched) break;
    }
    if (!matched) continue;
    // `OggS` son 4 bytes ASCII que un texto puede empezar a tener. La versión
    // de Ogg (offset 4, siempre 0x00) es lo que la hace una cabecera real. El
    // detector es aquí MÁS estricto que `verifyFileSignature` a propósito: no
    // queremos afirmar audio sobre texto. El servidor sigue siendo la
    // autoridad y su validación no se modifica.
    if (rule.mime === 'audio/ogg' && head[4] !== 0x00) continue;
    return rule.mime;
  }
  return null;
}
