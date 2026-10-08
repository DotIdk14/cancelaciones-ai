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
 * Resuelve el MIME que el cliente debe declarar combinando la firma real del
 * archivo con el MIME declarado por el browser/SO.
 *
 * - Si la firma es inequívoca (JPEG, PNG, etc.) manda la firma.
 * - ISO-BMFF es ambiguo (audio y video comparten `ftyp`), así que la
 *   declaración explícita manda: si el usuario declaró un subtipo de audio
 *   soportado se conserva exacto; si declaró `video/*` u otro MIME explícito
 *   se conserva tal cual y el servidor aplica su allowlist/firma; si no hay
 *   declaración útil se cae a `audio/mp4`.
 * - Si no hay firma, se confía en la declaración (p. ej. `text/plain`).
 *
 * Limitación residual: un contenedor ISO-BMFF que se declare como audio/m4a no
 * puede distinguirse de un video renombrado sin leer la caja `moov`/handler.
 * El servidor mantiene la cuota de transcripción como cota de ese caso; no se
 * resuelve aquí con más heurísticas.
 */
const ISO_BMFF_AUDIO_SUBTYPES = new Set(['audio/mp4', 'audio/x-m4a', 'audio/m4a']);

export function resolveEvidenceMime(head: Uint8Array, declaredMime: string): string | null {
  const detected = detectEvidenceMime(head);
  if (detected === 'audio/mp4') {
    const normalized = declaredMime.toLowerCase().split(';')[0]?.trim() ?? '';
    if (ISO_BMFF_AUDIO_SUBTYPES.has(normalized)) return normalized;
    if (normalized === '' || normalized === 'application/octet-stream') return 'audio/mp4';
    return normalized;
  }
  if (detected !== null) return detected;
  if (declaredMime !== '') return declaredMime;
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

  // MP3: cabecera ID3 o frame sync de MPEG audio (11 bits de sync + versión).
  const hasId3 =
    head.length >= 3 &&
    head[0] === ascii('I')[0] &&
    head[1] === ascii('D')[0] &&
    head[2] === ascii('3')[0];
  const hasFrameSync = head.length >= 2 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0;
  if (hasId3 || hasFrameSync) return 'audio/mpeg';

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
    if (matched) return rule.mime;
  }
  return null;
}
