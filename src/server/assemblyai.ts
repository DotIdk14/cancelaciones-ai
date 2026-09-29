// =============================================================================
// AssemblyAI — SOLO transcripción (secciones 10 y 11 del encargo).
// =============================================================================
// El audio se sube al endpoint /upload y luego se crea el transcript con
// diarización de hablantes y utterances. La estructura normalizada alimenta
// el Audit Skill. AssemblyAI NO decide negocio: solo transcribe.
// =============================================================================

import { getEnv } from './env.js';
import { ApiError } from './http.js';
import type { TranscriptData } from '../skills/audit/types.js';

const API_BASE = 'https://api.assemblyai.com/v2';

function apiKey(): string {
  const key = getEnv().ASSEMBLYAI_API_KEY;
  if (!key) {
    throw new ApiError(500, 'TRANSCRIPTION_ERROR', 'Transcripción no configurada (falta ASSEMBLYAI_API_KEY)');
  }
  return key;
}

async function assemblyFetch(path: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: apiKey(),
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `AssemblyAI respondió HTTP ${response.status}`;
    throw new ApiError(502, 'TRANSCRIPTION_ERROR', message);
  }
  return body;
}

/** Sube el audio y crea el transcript. Devuelve el id de AssemblyAI. */
export async function submitTranscription(audio: Buffer): Promise<string> {
  // 1) Upload del audio crudo.
  const uploadResponse = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    headers: {
      Authorization: apiKey(),
      'Content-Type': 'application/octet-stream',
    },
    body: new Uint8Array(audio),
  });
  const uploadText = await uploadResponse.text();
  let uploadBody: { upload_url?: unknown } | null = null;
  try {
    uploadBody = uploadText ? JSON.parse(uploadText) : null;
  } catch {
    uploadBody = null;
  }
  if (!uploadResponse.ok || !uploadBody?.upload_url || typeof uploadBody.upload_url !== 'string') {
    throw new ApiError(502, 'TRANSCRIPTION_ERROR', formatUploadError(uploadResponse.status, uploadText));
  }

  // 2) Crear el transcript con diarización y utterances.
  const createBody = await assemblyFetch('/transcript', {
    method: 'POST',
    body: JSON.stringify({
      audio_url: uploadBody.upload_url,
      speaker_labels: true,
      language_detection: true,
    }),
  });
  const created = createBody as { id?: unknown };
  if (!created.id || typeof created.id !== 'string') {
    throw new ApiError(502, 'TRANSCRIPTION_ERROR', 'AssemblyAI no devolvió un id de transcripción');
  }
  return created.id;
}

function formatUploadError(status: number, bodyText: string): string {
  const trimmed = bodyText.trim();
  let providerMessage = '';
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error: unknown }).error === 'string') {
        providerMessage = (parsed as { error: string }).error;
      }
    } catch {
      providerMessage = trimmed;
    }
  }
  const safeMessage = sanitizeProviderMessage(providerMessage || 'AssemblyAI no devolvió upload_url');
  return `AssemblyAI upload falló (HTTP ${status}): ${safeMessage}`;
}

function sanitizeProviderMessage(message: string): string {
  return message
    .replace(/(api[_-]?key|secret|token|authorization)[=:]\s*(?:(?:bearer|basic)\s+)?\S+/gi, '$1=[oculto]')
    .slice(0, 300);
}

export interface TranscriptionStatus {
  state: 'TRANSCRIBING' | 'READY' | 'ERROR';
  transcript: TranscriptData | null;
  error?: string;
}

interface AssemblyTranscriptJson {
  id?: string;
  status?: string;
  text?: string;
  audio_duration?: number;
  error?: string;
  utterances?: Array<{
    speaker?: string;
    start?: number;
    end?: number;
    text?: string;
    confidence?: number;
  }>;
}

/** Consulta el estado y normaliza la transcripción si completó. */
export async function getTranscription(transcriptId: string): Promise<TranscriptionStatus> {
  const body = (await assemblyFetch(`/transcript/${encodeURIComponent(transcriptId)}`, {
    method: 'GET',
  })) as AssemblyTranscriptJson | null;

  const status = body?.status ?? 'error';
  if (status === 'completed') {
    return { state: 'READY', transcript: normalizeTranscript(body ?? {}) };
  }
  if (status === 'error') {
    return { state: 'ERROR', transcript: null, error: body?.error ?? 'Error de transcripción' };
  }
  return { state: 'TRANSCRIBING', transcript: null };
}

function normalizeTranscript(body: AssemblyTranscriptJson): TranscriptData {
  const utterances = Array.isArray(body.utterances) ? body.utterances : [];
  return {
    transcript: typeof body.text === 'string' ? body.text : '',
    durationSeconds: typeof body.audio_duration === 'number' ? body.audio_duration : null,
    speakers: utterances.map((utterance) => ({
      speaker: utterance.speaker ?? 'speaker_unknown',
      start: typeof utterance.start === 'number' ? utterance.start : 0,
      end: typeof utterance.end === 'number' ? utterance.end : 0,
      text: utterance.text ?? '',
      confidence: typeof utterance.confidence === 'number' ? utterance.confidence : null,
    })),
  };
}
