// =============================================================================
// Cliente HTTP de la SPA. Sin URLs absolutas y sin estado: solo fetch.
// El cliente solo llama a la API propia; InsForge permanece server-side.
// =============================================================================

import type { AuditResult } from '../skills/audit/schema';
import type { AuditResultType, CaseStatus, ErrorCategory, EvidenceStatus, TranscriptData } from '../skills/audit/types';
import type { ComparisonOutcomePayload } from '../skills/review/schema';

// -----------------------------------------------------------------------------
// Formas de la API (contrato compartido con el servidor)
// -----------------------------------------------------------------------------

/** De dónde sale la resolución que gobierna el caso. */
export type ResolutionSource = 'HUMAN' | 'AI';

export interface CaseSummary {
  id: string;
  status: CaseStatus;
  studentIdentifier: string | null;
  evidenceCount: number;
  createdAt: string;
  updatedAt: string;
  /**
   * Resolución vigente y su origen.
   *
   * OPCIONAL a propósito: un servidor que todavía no la calcule debe dejar la
   * fila exactamente como estaba, y la UI no dibuja distintivo de origen
   * cuando no recibe una resolución. `null` y `undefined` significan lo mismo
   * para el listado: no hay resolución que mostrar.
   */
  effectiveResolution?: EffectiveResolution | null;
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

/**
 * Revisión humana del caso. Es ÚNICA por caso y, si existe, ES la resolución
 * final: el dictamen de la auditoría se conserva intacto y no la sobrescribe.
 *
 * `result` es `AuditResultType` porque el vocabulario humano es, por diseño, el
 * MISMO conjunto cerrado que puede emitir el Audit Skill (`HUMAN_RESOLUTIONS` es
 * un alias de `AUDIT_RESULTS`), no una lista paralela.
 */
export interface CaseReviewDto {
  id: string;
  caseId: string;
  /** Auditoría cuyo dictamen se compara. Inmutable: la revisión no apunta a "la última". */
  auditId: string;
  result: AuditResultType;
  comment: string;
  createdAt: string;
}

/** Estado TÉCNICO de la comparación; no es un veredicto. */
export type ComparisonStatus = 'RUNNING' | 'COMPLETED' | 'ERROR';

/**
 * Juicio de la IA sobre si el dictamen original coincide con la decisión humana.
 *
 * El veredicto viaja en `resultJson` (validado por Zod y con la metadata real de
 * OpenRouter agregada por el servidor) y es `null` mientras la comparación no
 * esté `COMPLETED`: no se publica un veredicto a medio hacer.
 */
export interface ComparisonDto {
  id: string;
  caseReviewId: string;
  auditId: string;
  status: ComparisonStatus;
  resultJson: ComparisonOutcomePayload | null;
  provider: string;
  model: string;
  errorCategory: ErrorCategory | null;
  latencyMs: number | null;
  deadlineAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Resolución que gobierna el caso AHORA, y de dónde sale. `null` cuando no hay
 * ni dictamen emitido ni decisión registrada: afirmar una sería inventarla.
 */
export interface EffectiveResolution {
  result: string;
  source: ResolutionSource;
}

/** Estado vigente de la revisión humana de un caso. */
export interface CaseReviewResponse {
  review: CaseReviewDto | null;
  comparison: ComparisonDto | null;
  effectiveResolution: EffectiveResolution | null;
}

export interface CaseDetailResponse {
  case: CaseDetail;
  evidences: Evidence[];
  audit: AuditDetail | null;
  audits: AuditHistoryItem[];
  review: CaseReviewDto | null;
  comparison: ComparisonDto | null;
  effectiveResolution: EffectiveResolution | null;
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
    review: data.review ?? null,
    comparison: data.comparison ?? null,
    effectiveResolution: data.effectiveResolution ?? null,
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

// -----------------------------------------------------------------------------
// Revisión humana y comparación con la IA
//
// Estas tres llamadas son las que sostienen la regla de producto central: la
// revisión es ÚNICA por caso y NINGUNA de ellas puede reabrirla.
//   - `submitCaseReview` es la única que la crea; el servidor responde 409 si ya
//     existe, y la UI no ofrece reintento en ese caso.
//   - `getCaseReview` es SOLO lectura: es la que permite retomar el polling tras
//     una recarga sin crear una segunda revisión ni una segunda comparación.
//   - `retryComparison` reabre la fila de comparación en ERROR y nada más.
// -----------------------------------------------------------------------------

/** Lee el estado vigente de la revisión. `GET` puro: nunca crea nada. */
export async function getCaseReview(caseId: string): Promise<CaseReviewResponse> {
  const data = await request<Partial<CaseReviewResponse>>(casePath(caseId, '/review'), {}, [200]);
  return {
    review: data.review ?? null,
    comparison: data.comparison ?? null,
    effectiveResolution: data.effectiveResolution ?? null,
  };
}

/**
 * Registra la revisión humana y arranca su comparación en la misma llamada.
 *
 * El comentario se RECORTA antes de viajar porque es exactamente lo que valida
 * el servidor (`HumanReviewInputSchema` hace `.trim()`): mandarlo sin recortar
 * convertiría un comentario válido en uno de 2001 caracteres por los espacios.
 *
 * Lanza `ApiError` con `status` 400 (validación) o 409 (ya existe revisión).
 */
export async function submitCaseReview(
  caseId: string,
  input: { result: AuditResultType; comment: string },
): Promise<{ review: CaseReviewDto; comparison: ComparisonDto }> {
  const data = await request<{ review: CaseReviewDto; comparison: ComparisonDto }>(
    casePath(caseId, '/review'),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ result: input.result, comment: input.comment.trim() }),
    },
    [200, 201],
  );
  return { review: data.review, comparison: data.comparison };
}

/**
 * Reintenta UNA comparación en ERROR. El servidor responde 400 si no es
 * reintentable, así que la UI sólo lo ofrece con `comparison.status === 'ERROR'`.
 */
export async function retryComparison(caseId: string): Promise<ComparisonDto> {
  const data = await request<{ comparison: ComparisonDto }>(casePath(caseId, '/comparison'), { method: 'POST' }, [
    200,
    201,
  ]);
  return data.comparison;
}
