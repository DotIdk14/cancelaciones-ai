import { AUDIO_SUBMIT_TIMEOUT_MS } from '@cancelaciones/shared';
import type { AudioProvider, AudioUtterance, AudioWord, EvidenceRecord } from './ports';

export interface AudioTranscript {
  text: string;
  utterances: AudioUtterance[];
  words: AudioWord[];
  assemblyId: string;
}

export interface SubmitAudioInput {
  evidence: EvidenceRecord;
  bytes: Uint8Array;
  provider: AudioProvider;
  /** Timeout de la llamada de envío. Por defecto el límite compartido. */
  timeoutMs?: number;
  /** Idioma de la hinted transcription. El audio de una entrevista en español no se transcribe en inglés. */
  languageCode?: string;
  signal?: AbortSignal;
}

const DEFAULT_LANGUAGE_CODE = 'es';

/**
 * Rechaza el envío con un mensaje que nombra la evidencia: un fallo de red del
 * proveedor sin saber a qué archivo corresponde es indiagnosticable, y son varios
 * audios por auditoría.
 */
export async function submitAudio(input: SubmitAudioInput): Promise<{ assemblyId: string }> {
  const timeoutMs = input.timeoutMs ?? AUDIO_SUBMIT_TIMEOUT_MS;
  const pending = input.provider.submit(input.bytes, {
    speakerLabels: true,
    languageCode: input.languageCode ?? DEFAULT_LANGUAGE_CODE,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { assemblyId } = await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`ASSEMBLY_SUBMIT_TIMEOUT: la evidencia ${input.evidence.id} no se pudo enviar`)),
          timeoutMs,
        );
      }),
    ]);
    if (!assemblyId) {
      throw new Error(`ASSEMBLY_SUBMIT_FAILED: el proveedor no devolvió identificador para ${input.evidence.id}`);
    }
    return { assemblyId };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('ASSEMBLY_')) throw error;
    const detail = error instanceof Error ? error.message : 'motivo desconocido';
    throw new Error(`ASSEMBLY_SUBMIT_FAILED: la evidencia ${input.evidence.id} no se pudo enviar: ${detail}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface FetchAudioTranscriptInput {
  assemblyId: string;
  provider: AudioProvider;
  /** Tope duro de consultas al proveedor. El bucle no puede superarlo. */
  maxAttempts: number;
  intervalMs: number;
  /** Deadline global medido desde el primer intento. */
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polling **acotado** de una transcripción en vuelo.
 *
 * Este es el camino de respaldo, no el principal: el webhook es quien trae el
 * resultado. Por eso el bucle tiene tres topes independientes y ninguno es
 * opcional: número máximo de consultas, deadline global y señal de aborto. Un
 * polling sin topes es un job que nunca termina y que se queda pagando
 * peticiones de una transcripción que ya se perdió.
 *
 * `sleep`, `now` y `signal` son inyectables para que los tests accounting el
 * tiempo no esperen de verdad: los tiempos de un polling no son comportamiento
 * observable, son infraestructura.
 */
export async function fetchAudioTranscript(input: FetchAudioTranscriptInput): Promise<AudioTranscript> {
  const sleep = input.sleep ?? defaultSleep;
  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  const maxAttempts = Math.max(1, Math.trunc(input.maxAttempts));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      if (input.signal?.aborted) throw new Error('AUDIO_ABORTED');
      const remaining = input.timeoutMs - (now() - startedAt);
      if (remaining <= 0) throw new Error('ASSEMBLY_POLL_TIMEOUT');
      await sleep(Math.min(input.intervalMs, remaining));
      if (input.signal?.aborted) throw new Error('AUDIO_ABORTED');
    }

    const result = await input.provider.status(input.assemblyId);

    if (result.status === 'completed') {
      return {
        text: result.text ?? '',
        utterances: result.utterances ?? [],
        words: result.words ?? [],
        assemblyId: input.assemblyId,
      };
    }

    if (result.status === 'error') {
      throw new Error(`ASSEMBLY_TRANSCRIPTION_FAILED: ${result.error ?? 'el proveedor no detallo el motivo'}`);
    }

    if (input.signal?.aborted) throw new Error('AUDIO_ABORTED');
    if (now() - startedAt >= input.timeoutMs) throw new Error('ASSEMBLY_POLL_TIMEOUT');
  }

  throw new Error('ASSEMBLY_POLL_EXHAUSTED');
}
