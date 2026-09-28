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
