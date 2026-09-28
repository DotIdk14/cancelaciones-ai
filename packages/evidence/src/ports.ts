import type { EvidenceContentStatus, EvidenceKind, EvidenceStatus } from '@cancelaciones/shared';

/**
 * Puertos del paquete. Solo interfaces: este paquete no conoce InsForge, OpenRouter
 * ni AssemblyAI, recibe todo por inyección. Quien lo usa decide si la implementación
 * real habla HTTP, lee de disco o es un doble de test.
 *
 * Estas interfaces son deliberadamente *mínimas*: cada método es algo que el paquete
 * de verdad necesita. Un método added "por si acaso" es una vía de acoplamiento
 * que después nadie puede cambiar sin romper el doble de test de otro.
 */

/**
 * Acceso binario al bucket de evidencias.
 *
 * `download` devuelve `data: null` **o** `error` cuando algo falla: un SDK que
 * responde 404 con cuerpo vacío no siempre puebla el campo de error, así que el
 * llamador tiene que mirar los dos. Nunca se asume que `error` viene poblado.
 */
export interface EvidenceStorage {
  download(
    bucket: string,
    key: string,
  ): Promise<{ data: Blob | ArrayBuffer | null; error?: { message?: string } | null }>;
  upload(bucket: string, key: string, body: Blob): Promise<{ error?: { message?: string } | null }>;
}

/** Fila de evidencia tal y como la expone la tabla, ya normalizada a tipos planos. */
export interface EvidenceRecord {
  id: string;
  auditId: string;
  originalFilename: string;
  safeFilename: string;
  detectedMimeType: string;
  kind: EvidenceKind;
  sizeBytes: number;
  sha256: string;
  storageBucket: string;
  storageKey: string | null;
  status: EvidenceStatus;
  contentStatus: EvidenceContentStatus;
  contentError: string | null;
  createdAt: string;
}

/**
 * Persistencia de evidencia. El paquete **no** escribe por su cuenta: quien llama
 * (el handler de subida o el job) persiste el resultado de `prepareEvidenceContent`.
 * Estos métodos existen para que el llamador pueda leer y marcar.
 */
export interface EvidenceStore {
  findById(evidenceId: string): Promise<EvidenceRecord | null>;
  findByAudit(auditId: string): Promise<EvidenceRecord[]>;
  markContentStatus(evidenceId: string, contentStatus: EvidenceContentStatus, error?: string | null): Promise<void>;
  findByAuditAndSha256(auditId: string, sha256: string): Promise<EvidenceRecord | null>;
}

export interface CaseRecord {
  id: string;
  displayName: string | null;
  externalCaseId: string | null;
  classStartDate: string | null;
  ticketStartAt: string | null;
  studentName: string | null;
  studentEnrollment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CaseStore {
  findById(caseId: string): Promise<CaseRecord | null>;
}

export interface AudioUtterance {
  startMs: number;
  endMs: number;
  speaker?: string | null;
  text: string;
}

export interface AudioWord {
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
  speaker?: string | null;
}

export type AudioJobStatus = 'queued' | 'processing' | 'completed' | 'error';

/**
 * Proveedor de transcripción. El camino principal de una evidencia de audio es el
 * webhook; este puerto existe para *enviar* el archivo y para el polling acotado
 * de respaldo (`fetchAudioTranscript`).
 */
export interface AudioProvider {
  submit(audio: Uint8Array, options: { speakerLabels: boolean; languageCode: string }): Promise<{ assemblyId: string }>;
  status(assemblyId: string): Promise<{
    status: AudioJobStatus;
    text?: string;
    utterances?: AudioUtterance[];
    words?: AudioWord[];
    error?: string;
  }>;
}

/**
 * Proveedor de visión. `prompt` viaja por el puerto a propósito: el prompt de
 * transcripción literal es parte de este paquete y debe poder auditarse, no
 * quedar escondido dentro de un cliente HTTP.
 */
export interface VisionProvider {
  /** Nombre corto del proveedor, solo para trazar coste en `aiCall`. */
  readonly name?: string;
  describeImage(input: {
    base64: string;
    mimeType: string;
    filename: string;
    prompt: string;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null; model: string }>;
}
