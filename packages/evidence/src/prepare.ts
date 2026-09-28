import { EVIDENCE_BUCKET, MAX_TOOL_OUTPUT_CHARS } from '@cancelaciones/shared';
import type { EvidenceKind } from '@cancelaciones/shared';
import { describeEvidenceImage } from './vision';
import { submitAudio } from './audio';
import { extractPdfText, slicePagesForContext } from './pdf';
import { decodeToText, toBytes } from './text';
import type { AudioProvider, EvidenceRecord, EvidenceStorage, VisionProvider } from './ports';

/** Códigos de fallo que un llamador puede ramificar sin parsear texto libre. */
export const EVIDENCE_ERROR_CODES = [
  'EVIDENCE_DOWNLOAD_FAILED',
  'EVIDENCE_STORAGE_KEY_MISSING',
  'PDF_TEXT_UNAVAILABLE',
  'DOCUMENT_TEXT_UNAVAILABLE',
  'VISION_PROVIDER_MISSING',
  'AUDIO_PROVIDER_MISSING',
  'EVIDENCE_PREPARE_FAILED',
  'ASSEMBLY_SUBMIT_FAILED',
  'ASSEMBLY_SUBMIT_TIMEOUT',
  'ASSEMBLY_TRANSCRIPTION_FAILED',
  'ASSEMBLY_POLL_TIMEOUT',
  'ASSEMBLY_POLL_EXHAUSTED',
  'AUDIO_ABORTED',
] as const;

export type EvidenceErrorCode = (typeof EVIDENCE_ERROR_CODES)[number];

export interface EvidenceError {
  code: string;
  message: string;
}

export interface PrepareEvidenceInput {
  evidence: EvidenceRecord;
  storage: EvidenceStorage;
  providers: { vision?: VisionProvider; audio?: AudioProvider };
  config: {
    visionModel: string;
    visionTimeoutMs: number;
    audioPollMaxAttempts: number;
    audioPollIntervalMs: number;
    audioPollTimeoutMs: number;
    maxToolOutputChars: number;
    /** Tope de páginas a leer de un PDF. Por defecto 40. */
    maxPdfPages?: number;
  };
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
}

export interface PreparedContent {
  evidenceId: string;
  kind: EvidenceKind;
  status: 'READY' | 'WAITING_EXTERNAL' | 'FAILED';
  /** Texto plano listo para el agente. `null` cuando el contenido es un audio todavía en vuelo. */
  text: string | null;
  /** Datos de audio cuando aplica. */
  audio: { assemblyId: string } | null;
  pages: number;
  error: EvidenceError | null;
  aiCall: { model: string; inputTokens: number | null; outputTokens: number | null } | null;
}

const DEFAULT_MAX_PDF_PAGES = 40;

function truncateTo(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = '\n[[texto recortado por límite de contexto]]';
  if (maxChars <= marker.length) return text.slice(0, maxChars);
  return `${text.slice(0, Math.max(0, maxChars - marker.length)).trimEnd()}${marker}`;
}

/**
 * Un `maxToolOutputChars` inválido (0, negativo, `NaN`) no puede recortarse a nada:
 * se cae al límite compartido para no convertir un error de configuración en un
 * "no hay contenido" que el agente interpretaría como evidencia vacía.
 */
function resolveMaxChars(configured: number): number {
  return Number.isFinite(configured) && configured > 0 ? Math.trunc(configured) : MAX_TOOL_OUTPUT_CHARS;
}

/** Propaga un código conocido si el error lo trae en el prefijo, para no perder la trazabilidad. */
function classifyError(error: unknown): EvidenceError {
  const message = error instanceof Error ? error.message : String(error);
  const code = EVIDENCE_ERROR_CODES.find((candidate) => message === candidate || message.startsWith(`${candidate}:`));
  return { code: code ?? 'EVIDENCE_PREPARE_FAILED', message };
}

function failure(evidence: EvidenceRecord, code: string, message: string): PreparedContent {
  return {
    evidenceId: evidence.id,
    kind: evidence.kind,
    status: 'FAILED',
    text: null,
    audio: null,
    pages: 0,
    error: { code, message },
    aiCall: null,
  };
}

interface DownloadedEvidence {
  bytes: Uint8Array;
}

async function downloadEvidence(
  input: PrepareEvidenceInput,
): Promise<DownloadedEvidence | PreparedContent> {
  const { evidence, storage } = input;
  if (!evidence.storageKey) {
    return failure(
      evidence,
      'EVIDENCE_STORAGE_KEY_MISSING',
      `La evidencia ${evidence.id} no tiene clave de storage: no se puede leer su contenido.`,
    );
  }
  const bucket = evidence.storageBucket || EVIDENCE_BUCKET;
  const response = await storage.download(bucket, evidence.storageKey);
  if (response.error || response.data === null) {
    return failure(
      evidence,
      'EVIDENCE_DOWNLOAD_FAILED',
      response.error?.message ?? `No se pudo descargar la evidencia ${evidence.id} de ${bucket}.`,
    );
  }
  try {
    return { bytes: await toBytes(response.data) };
  } catch (error) {
    return failure(
      evidence,
      'EVIDENCE_DOWNLOAD_FAILED',
      `El contenido descargado de la evidencia ${evidence.id} no es legible: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function prepareTextLike(
  input: PrepareEvidenceInput,
  bytes: Uint8Array,
  maxChars: number,
): Promise<PreparedContent> {
  const { evidence } = input;
  const text = truncateTo(await decodeToText(bytes), maxChars);
  return {
    evidenceId: evidence.id,
    kind: evidence.kind,
    status: 'READY',
    text,
    audio: null,
    pages: 0,
    error: null,
    aiCall: null,
  };
}

async function preparePdf(
  input: PrepareEvidenceInput,
  bytes: Uint8Array,
  maxChars: number,
): Promise<PreparedContent> {
  const { evidence } = input;
  const maxPages = input.config.maxPdfPages ?? DEFAULT_MAX_PDF_PAGES;
  const pages = await extractPdfText(bytes, maxPages);
  const usable = pages.filter((page) => page.text.trim().length > 0);

  if (usable.length === 0) {
    const vision = input.providers.vision;
    if (vision?.describeDocument) {
      const description = await vision.describeDocument({
        base64: Buffer.from(bytes).toString('base64'),
        mimeType: evidence.detectedMimeType,
        filename: evidence.safeFilename,
        prompt: [
          'Describe este PDF escaneado o sin capa de texto.',
          'Transcribe literalmente todo el texto visible, conservando el orden de lectura.',
          'No interpretes, no concluyas, no resumas.',
          `El extractor local no encontró texto en las primeras ${pages.length} páginas; deja constancia de páginas visibles si puedes identificarlas.`,
        ].join(' '),
        timeoutMs: input.config.visionTimeoutMs,
        signal: input.signal,
      });
      return {
        evidenceId: evidence.id,
        kind: evidence.kind,
        status: 'READY',
        text: truncateTo(`[[PDF sin capa de texto; transcripción visual del documento completo]]\n${description.text}`, maxChars),
        audio: null,
        pages: pages.length,
        error: null,
        aiCall: {
          model: description.model,
          inputTokens: description.inputTokens,
          outputTokens: description.outputTokens,
        },
      };
    }
    return failure(
      evidence,
      'PDF_TEXT_UNAVAILABLE',
      `El PDF ${evidence.originalFilename} no tiene capa de texto legible en sus primeras ${pages.length} páginas. Puede estar escaneado como imagen: el agente debe tratarlo como evidencia no legible, no como un fallo de carga.`,
    );
  }

  const text = slicePagesForContext(usable, maxChars);
  return {
    evidenceId: evidence.id,
    kind: evidence.kind,
    status: 'READY',
    text,
    audio: null,
    pages: pages.length,
    error: null,
    aiCall: null,
  };
}

async function prepareImage(input: PrepareEvidenceInput, bytes: Uint8Array): Promise<PreparedContent> {
  const { evidence } = input;
  const vision = input.providers.vision;
  if (!vision) {
    return failure(
      evidence,
      'VISION_PROVIDER_MISSING',
      `La evidencia ${evidence.id} es una imagen pero no hay proveedor de visión configurado: no se puede describir su contenido.`,
    );
  }
  const description = await describeEvidenceImage({
    evidence,
    bytes,
    provider: vision,
    model: input.config.visionModel,
    timeoutMs: input.config.visionTimeoutMs,
    signal: input.signal,
  });
  return {
    evidenceId: evidence.id,
    kind: evidence.kind,
    status: 'READY',
    text: truncateTo(description.text, resolveMaxChars(input.config.maxToolOutputChars)),
    audio: null,
    pages: 0,
    error: null,
    aiCall: {
      model: description.model,
      inputTokens: description.inputTokens,
      outputTokens: description.outputTokens,
    },
  };
}

async function prepareAudio(input: PrepareEvidenceInput, bytes: Uint8Array): Promise<PreparedContent> {
  const { evidence } = input;
  const audio = input.providers.audio;
  if (!audio) {
    return failure(
      evidence,
      'AUDIO_PROVIDER_MISSING',
      `La evidencia ${evidence.id} es un audio pero no hay proveedor de transcripción configurado: no se puede obtener su contenido.`,
    );
  }
  // Camino principal: el webhook entrega la transcripción. Aquí solo se envía y se
  // devuelve el identificador; el polling acotado de `fetchAudioTranscript` lo
  // dispara el webhook como red de seguridad, nunca este camino.
  const submitted = await submitAudio({
    evidence,
    bytes,
    provider: audio,
    timeoutMs: input.config.audioPollTimeoutMs,
    signal: input.signal,
  });
  return {
    evidenceId: evidence.id,
    kind: evidence.kind,
    status: 'WAITING_EXTERNAL',
    text: null,
    audio: { assemblyId: submitted.assemblyId },
    pages: 0,
    error: null,
    aiCall: null,
  };
}

/**
 * Deja una evidencia en un estado consultable y devuelve el resultado.
 *
 * No escribe en base de datos ni en storage: eso es de quien llama. La separación
 * es deliberada, es lo que hace testeable esta lógica sin levantar el ciclo de
 * vida de una evidencia (subida, job, webhook, persistencia) entero.
 *
 * `status` es siempre un hecho del contenido, nunca una opinión:
 *  - `READY`: hay texto que el agente puede leer ya.
 *  - `WAITING_EXTERNAL`: se envió a un tercero y el texto llegará por webhook.
 *  - `FAILED`: no se pudo obtener contenido, con un código que explica por qué.
 *
 * Los parámetros `sleep`, `now` y `signal` se propagan aunque hoy solo los consume
 * el polling acotado: mantienen la superficie de la función estable para que el
 * llamador pueda inyectarlos siempre sin ramificar por `kind`.
 */
export async function prepareEvidenceContent(input: PrepareEvidenceInput): Promise<PreparedContent> {
  const { evidence } = input;
  const maxChars = resolveMaxChars(input.config.maxToolOutputChars);

  let downloaded: DownloadedEvidence | PreparedContent;
  try {
    downloaded = await downloadEvidence(input);
  } catch (error) {
    return failure(
      evidence,
      'EVIDENCE_DOWNLOAD_FAILED',
      `Fallo al descargar la evidencia ${evidence.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if ('error' in downloaded && downloaded.error !== null) return downloaded;
  if (!('bytes' in downloaded)) {
    return failure(evidence, 'EVIDENCE_DOWNLOAD_FAILED', `No se obtuvo contenido para la evidencia ${evidence.id}.`);
  }

  try {
    switch (evidence.kind) {
      case 'TEXT':
      case 'SPREADSHEET':
        return await prepareTextLike(input, downloaded.bytes, maxChars);
      case 'PDF':
        return await preparePdf(input, downloaded.bytes, maxChars);
      case 'IMAGE':
        return await prepareImage(input, downloaded.bytes);
      case 'AUDIO':
        return await prepareAudio(input, downloaded.bytes);
      case 'DOCUMENT':
        // `.docx` y `.xlsx` son contenedores ZIP: no hay forma honesta de sacarles texto
        // sin un lector de OOXML, y decodificarlos como utf-8 produciría bytes
        // basura presentados como evidencia. Se declara no disponible en vez de
        // inventar una transcripción.
        return failure(
          evidence,
          'DOCUMENT_TEXT_UNAVAILABLE',
          `La evidencia ${evidence.originalFilename} es un documento de Office y este paquete no incluye lector de OOXML: su contenido no puede extraerse como texto.`,
        );
      default:
        return failure(evidence, 'EVIDENCE_PREPARE_FAILED', `Tipo de evidencia no soportado: ${String(evidence.kind)}.`);
    }
  } catch (error) {
    const classified = classifyError(error);
    return failure(evidence, classified.code, classified.message);
  }
}
