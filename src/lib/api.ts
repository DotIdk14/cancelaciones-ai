// =============================================================================
// Cliente HTTP de la SPA. Sin URLs absolutas y sin estado: solo fetch.
// El cliente solo llama a la API propia; InsForge permanece server-side.
// =============================================================================

import type { AuditResult } from '../skills/audit/schema';
import type { CaseStatus, ErrorCategory, EvidenceStatus, TranscriptData } from '../skills/audit/types';

// -----------------------------------------------------------------------------
// Formas de la API (contrato compartido con el servidor)
// -----------------------------------------------------------------------------

export interface CaseSummary {
  id: string;
  status: CaseStatus;
  studentIdentifier: string | null;
  evidenceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CaseDetail {
  id: string;
  status: CaseStatus;
  studentIdentifier: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Evidence {
  id: string;
  caseId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  hash: string;
  storagePath: string;
  processingStatus: EvidenceStatus;
  processingError: string | null;
  transcript: TranscriptData | null;
  createdAt: string;
}

export type AuditRunStatus = 'RUNNING' | 'COMPLETED' | 'ERROR';

export interface AuditDetail {
  id: string;
  caseId: string;
  status: AuditRunStatus;
  provider: string;
  model: string;
  resultJson: AuditResult | null;
  errorCategory: ErrorCategory | null;
  latencyMs: number | null;
  evidenceFingerprint: string | null;
  attemptNumber: number | null;
  deadlineAt: string | null;
  createdAt: string;
}

export interface AuditHistoryItem {
  id: string;
  status: AuditRunStatus;
  result: string | null;
  confidence: number | null;
  provider: string;
  model: string;
  errorCategory: ErrorCategory | null;
  latencyMs: number | null;
  evidenceFingerprint: string | null;
  attemptNumber: number | null;
  createdAt: string;
}

export interface CaseDetailResponse {
  case: CaseDetail;
  evidences: Evidence[];
  audit: AuditDetail | null;
  audits: AuditHistoryItem[];
}

/** Respuesta de `POST /api/cases/:caseId/audit` cuando aún hay audio procesándose. */
export interface StartAuditPending {
  kind: 'pending';
  pendingEvidence: string[];
}

export interface StartAuditFinished {
  kind: 'finished';
  audit: AuditDetail;
}

export type StartAuditResponse = StartAuditPending | StartAuditFinished;

export interface ErrorState {
  category: string;
  message: string;
}

// -----------------------------------------------------------------------------
// Errores
// -----------------------------------------------------------------------------

/** Error normalizado de la API: `{ error: { category, message } }`. */
export class ApiError extends Error {
  readonly category: string;
  readonly status: number;

  constructor(category: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.category = category;
    this.status = status;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Lee el cuerpo de error de una respuesta no exitosa. Nunca lanza. */
export async function readError(res: Response): Promise<ApiError> {
  let category = 'UNKNOWN';
  let message = `Error ${res.status} al llamar al servidor.`;

  try {
    const data: unknown = await res.json();
    if (isRecord(data) && isRecord(data.error)) {
      const rawCategory = data.error.category;
      const rawMessage = data.error.message;
      if (typeof rawCategory === 'string' && rawCategory !== '') category = rawCategory;
      if (typeof rawMessage === 'string' && rawMessage !== '') message = rawMessage;
    }
  } catch {
    // Respuesta sin cuerpo JSON (p. ej. gateway): se conserva el mensaje por defecto.
  }

  return new ApiError(category, message, res.status);
}

/** Convierte cualquier excepción en un estado mostrable. */
export function toErrorState(error: unknown): ErrorState {
  if (error instanceof ApiError) return { category: error.category, message: error.message };
  if (error instanceof Error && error.message) {
    return { category: 'UNKNOWN', message: error.message };
  }
  return { category: 'UNKNOWN', message: 'Ocurrió un error inesperado. Intenta de nuevo.' };
}

// -----------------------------------------------------------------------------
// Nucleo de fetch
// -----------------------------------------------------------------------------

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
}

async function request<T>(url: string, options: RequestOptions, expected: number[]): Promise<T> {
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: options.headers,
    body: options.body,
  });
  if (!expected.includes(res.status)) throw await readError(res);
  return (await res.json()) as T;
}

function casePath(caseId: string, suffix = ''): string {
  return `/api/cases/${encodeURIComponent(caseId)}${suffix}`;
}

// -----------------------------------------------------------------------------
// Casos
// -----------------------------------------------------------------------------

export async function listCases(): Promise<CaseSummary[]> {
  const data = await request<{ cases: CaseSummary[] }>('/api/cases', {}, [200]);
  return data.cases ?? [];
}

export async function createCase(studentIdentifier?: string): Promise<CaseSummary> {
  const data = await request<{ case: CaseSummary }>(
    '/api/cases',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(studentIdentifier ? { studentIdentifier } : {}),
    },
    [200, 201],
  );
  return data.case;
}

export async function getCase(caseId: string): Promise<CaseDetailResponse> {
  const data = await request<CaseDetailResponse>(casePath(caseId), {}, [200]);
  return {
    case: data.case,
    evidences: data.evidences ?? [],
    audit: data.audit ?? null,
    audits: data.audits ?? [],
  };
}

// -----------------------------------------------------------------------------
// Evidencias
// -----------------------------------------------------------------------------

/**
 * Sube el archivo como cuerpo binario crudo (sin multipart).
 * El nombre viaja en `x-file-name` URL-encoded porque HTTP headers no admiten
 * caracteres no ASCII.
 */
export async function uploadEvidence(caseId: string, file: File): Promise<Evidence> {
  const res = await fetch(casePath(caseId, '/evidence'), {
    method: 'POST',
    headers: {
      'content-type': file.type !== '' ? file.type : 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
    },
    body: file,
  });
  if (res.status !== 201) throw await readError(res);
  const data = (await res.json()) as { evidence: Evidence };
  return data.evidence;
}

export async function deleteEvidence(caseId: string, evidenceId: string): Promise<void> {
  await request<{ ok: true }>(casePath(caseId, `/evidence/${encodeURIComponent(evidenceId)}`), { method: 'DELETE' }, [200]);
}

/** URL de descarga del binario original. */
export function evidenceDownloadUrl(evidenceId: string): string {
  return `/api/evidence/${encodeURIComponent(evidenceId)}/download`;
}

/** URL de descarga pensada para render inline (`<img>`, `<audio>`). */
export function evidencePreviewUrl(evidenceId: string): string {
  return `/api/evidence/${encodeURIComponent(evidenceId)}/download?preview=1`;
}

// -----------------------------------------------------------------------------
// Auditoría
// -----------------------------------------------------------------------------

/**
 * Dispara la auditoría. El servidor puede responder:
 *  - 200 con el audit ya terminado (o el COMPLETED existente),
 *  - 202 con `pendingEvidence` cuando falta transcripción.
 */
export async function startAudit(caseId: string): Promise<StartAuditResponse> {
  const res = await fetch(casePath(caseId, '/audit'), { method: 'POST' });
  if (res.status === 200) {
    const data = (await res.json()) as { audit: AuditDetail };
    return { kind: 'finished', audit: data.audit };
  }
  if (res.status === 202) {
    const data = (await res.json()) as { audit: AuditDetail | null; pendingEvidence: string[] };
    return { kind: 'pending', pendingEvidence: data.pendingEvidence ?? [] };
  }
  throw await readError(res);
}

export async function getAudit(caseId: string): Promise<AuditDetail | null> {
  const data = await request<{ audit: AuditDetail | null }>(casePath(caseId, '/audit'), {}, [200]);
  return data.audit ?? null;
}
