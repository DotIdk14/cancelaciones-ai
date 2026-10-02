// =============================================================================
// Preparación técnica de evidencias (sección 8 del encargo).
// =============================================================================
// Validación MIME, límites, hash SHA-256, sanitización de nombres y
// transformación de formato (imagen a data URI, PDF a texto/archivo,
// transcript JSON a estructura normalizada). NO decide negocio.
// =============================================================================

import { createHash } from 'node:crypto';
import type { EvidenceKind, TranscriptData } from '../skills/audit/types.js';

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const AUDIO_MIMES = new Set(['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/x-m4a', 'audio/m4a', 'audio/mp3']);

const TEXT_MIMES = new Set(['text/plain']);

const FULL_MIMES = new Set([...IMAGE_MIMES, ...AUDIO_MIMES, ...TEXT_MIMES, 'application/pdf']);

/** MIME normalizado y permitido, o null si el tipo no está soportado. */
export function normalizeMime(rawInput: string): string | null {
  const raw = rawInput.toLowerCase().split(';')[0]?.trim() ?? '';
  if (!raw) return null;
  if (FULL_MIMES.has(raw)) return raw;
  return null;
}

export function detectKind(mimeType: string): EvidenceKind {
  if (mimeType.startsWith('image/')) return 'IMAGE';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType.startsWith('audio/')) return 'AUDIO';
  return 'TEXT';
}

export function isAudio(mimeType: string): boolean {
  return mimeType.startsWith('audio/');
}

/** SHA-256 hexadecimal (provenance de la evidencia). */
export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Nombre de archivo seguro: sin rutas, sin caracteres peligrosos. */
export function sanitizeFilename(raw: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? '').trim();
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);
  return cleaned.trim() || 'evidencia';
}

/** Data URI para el modelo multimodal. */
export function imageDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

/** Lee la transcripción normalizada desde `transcript_json` de la fila. */
export function readTranscriptFromJson(json: unknown): TranscriptData | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as Record<string, unknown>;
  const raw = root.transcript;
  if (!raw || typeof raw !== 'object') return null;
  const transcript = raw as Record<string, unknown>;

  const speakers = Array.isArray(transcript.speakers)
    ? transcript.speakers.map((speaker) => {
        const s = speaker as Record<string, unknown>;
        return {
          speaker: typeof s.speaker === 'string' ? s.speaker : 'speaker_unknown',
          start: typeof s.start === 'number' ? s.start : 0,
          end: typeof s.end === 'number' ? s.end : 0,
          text: typeof s.text === 'string' ? s.text : '',
          confidence: typeof s.confidence === 'number' ? s.confidence : null,
        };
      })
    : [];

  return {
    transcript: typeof transcript.transcript === 'string' ? transcript.transcript : '',
    durationSeconds: typeof transcript.durationSeconds === 'number' ? transcript.durationSeconds : null,
    speakers,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -----------------------------------------------------------------------------
// Validación por FIRMA REAL del archivo (magic bytes).
//
// El header `Content-Type` lo declara el cliente y no prueba nada: subir un
// HTML/JS con `image/png` o un PDF que en realidad es un ZIP ejecutable son
// vectores reales. Aquí se compara la firma del buffer con el MIME declarado.
// Las imágenes y el audio tienen firmas estándar; el TEXTO se acepta salvo que
// el contenido sea claramente un binario o un documento con otra firma.
// -----------------------------------------------------------------------------

interface SignatureRule {
  mime: string;
  /** Posiciones donde debe aparecer la marca (offsets desde el inicio). */
  marks: Array<{ offset: number; bytes: number[] }>;
  /** Tolerancia: si el buffer no tiene suficientes bytes, no se juzga. */
  minLength: number;
}

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

const SIGNATURES: SignatureRule[] = [
  { mime: 'application/pdf', marks: [{ offset: 0, bytes: ascii('%PDF-') }], minLength: 5 },
  { mime: 'image/jpeg', marks: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }], minLength: 3 },
  { mime: 'image/png', marks: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }], minLength: 8 },
  { mime: 'image/gif', marks: [{ offset: 0, bytes: ascii('GIF8') }], minLength: 4 },
  // WebP: "RIFF" en 0 y "WEBP" en 8.
  { mime: 'image/webp', marks: [{ offset: 0, bytes: ascii('RIFF') }, { offset: 8, bytes: ascii('WEBP') }], minLength: 12 },
  // MP3 tiene DOS firmas válidas: la cabecera ID3 o el frame sync de MPEG audio,
  // así que se resuelve fuera de la tabla (ver `verifyFileSignature`).
  // WAV: RIFF....WAVE
  { mime: 'audio/wav', marks: [{ offset: 0, bytes: ascii('RIFF') }, { offset: 8, bytes: ascii('WAVE') }], minLength: 12 },
  // M4A/MP4 (container ISO-BMFF): "ftyp" en el offset 4.
  { mime: 'audio/mp4', marks: [{ offset: 4, bytes: ascii('ftyp') }], minLength: 8 },
  { mime: 'audio/x-m4a', marks: [{ offset: 4, bytes: ascii('ftyp') }], minLength: 8 },
  { mime: 'audio/m4a', marks: [{ offset: 4, bytes: ascii('ftyp') }], minLength: 8 },
  // OGG: "OggS"
  { mime: 'audio/ogg', marks: [{ offset: 0, bytes: ascii('OggS') }], minLength: 4 },
  // WebM/Matroska: EBML 0x1A45DFA3
  { mime: 'audio/webm', marks: [{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }], minLength: 4 },
];

export interface SignatureVerdict {
  ok: boolean;
  /** Motivo del rechazo (mensaje apto para el cliente, sin detalles internos). */
  reason?: string;
}

/**
 * Comprueba que el buffer realmente sea del tipo declarado.
 *
 * - `text/plain`: sólo se rechaza si el contenido empieza por una firma clara de
 *   binario ejecutable o de archivo (`.exe`, ELF, script shebang, PK zip, PDF).
 * - Tipos con firma estricta: si no coincide, se rechaza con 415 en el endpoint.
 */
export function verifyFileSignature(buffer: Buffer, declaredMime: string): SignatureVerdict {
  if (buffer.length === 0) return { ok: false, reason: 'El archivo está vacío' };

  if (declaredMime === 'text/plain') {
    if (looksLikeBinary(buffer)) {
      return { ok: false, reason: 'El contenido no es texto legible' };
    }
    return { ok: true };
  }

  // MP3: cabecera ID3 O frame sync de MPEG audio (11 bits de sync + versión).
  if (declaredMime === 'audio/mpeg' || declaredMime === 'audio/mp3') {
    const hasId3 = buffer.subarray(0, 3).equals(Buffer.from(ascii('ID3')));
    const hasFrameSync = buffer.length >= 2 && buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0;
    return hasId3 || hasFrameSync
      ? { ok: true }
      : { ok: false, reason: 'El contenido del archivo no es audio MPEG válido' };
  }

  const rule = SIGNATURES.find((candidate) => candidate.mime === declaredMime);
  if (!rule) {
    // Tipo permitido sin firma conocida (no debería ocurrir con FULL_MIMES).
    return { ok: true };
  }
  if (buffer.length < rule.minLength) {
    return { ok: false, reason: 'El archivo está truncado o incompleto' };
  }
  for (const mark of rule.marks) {
    for (let i = 0; i < mark.bytes.length; i += 1) {
      if (buffer[mark.offset + i] !== mark.bytes[i]) {
        return {
          ok: false,
          reason: `El contenido del archivo no corresponde al tipo declarado (${declaredMime})`,
        };
      }
    }
  }
  return { ok: true };
}

/** ¿El buffer contiene una firma de binario en los primeros bytes? */
function looksLikeBinary(buffer: Buffer): boolean {
  const head = buffer.subarray(0, Math.min(buffer.length, 4096));
  const startsWith = (needle: number[]): boolean =>
    needle.every((byte, i) => head[i] === byte);
  if (startsWith(ascii('%PDF-'))) return true;
  if (startsWith(ascii('PK\x03\x04'))) return true;
  if (startsWith([0x4d, 0x5a])) return true; // MZ (PE/EXE)
  if (startsWith([0x7f, 0x45, 0x4c, 0x46])) return true; // ELF
  if (startsWith(ascii('#!'))) return true; // shebang
  if (startsWith([0x3c, 0x21, 0x44, 0x4f])) return true; // <!DO (HTML)
  // Nulos abundantemente: no es texto.
  let nulls = 0;
  for (const byte of head) if (byte === 0) nulls += 1;
  return nulls > head.length / 4;
}
