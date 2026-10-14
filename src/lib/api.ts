// =============================================================================
// Cliente HTTP de la SPA. Sin URLs absolutas y sin estado: solo fetch.
// El cliente solo llama a la API propia; InsForge permanece server-side.
// =============================================================================

import type { AuditResult } from '../skills/audit/schema';
import type { AuditResultType, CaseStatus, ErrorCategory, EvidenceStatus, TranscriptData } from '../skills/audit/types';
import type { ComparisonOutcomePayload } from '../skills/review/schema';
import { captureEvidenceFile, readEvidenceHead, resolveEvidenceMime } from '../shared/evidence-formats.js';

// -----------------------------------------------------------------------------
// Formas de la API (contrato compartido con el servidor)
// -----------------------------------------------------------------------------

/** De dónde sale la resolución que gobierna el caso. */
export type ResolutionSource = 'HUMAN' | 'AI';

/**
 * Decisión final del Coordinador sobre la resolución del Asesor.
 *
 * Duplica el vocabulario cerrado del servidor (`COORDINATOR_DECISIONS`): el
 * cliente no importa de `src/skills/review` porque ese módulo arrastra el
 * servidor. `APPROVE` conserva la resolución del Asesor; `CHANGE` la sustituye.
 */
export type CoordinatorDecision = 'APPROVE' | 'CHANGE';

/**
 * Estado DERIVADO del flujo humano de dos etapas. No es una columna ni
 * `cases.status`: sin revisión falta el Asesor; con revisión sin decisión del
 * Coordinador falta la finalización; con decisión, el caso está finalizado.
 */
export type WorkflowState = 'PENDING_ADVISOR' | 'PENDING_COORDINATOR' | 'FINALIZED';

export interface CaseSummary {
  id: string;
  status: CaseStatus;
  studentIdentifier: string | null;
  studentName?: string | null;
  evidenceCount: number;
  createdAt: string;
  updatedAt: string;
  /** Etapa humana derivada de case_reviews; no corresponde a cases.status. */
  workflowState?: WorkflowState;
  /**
   * Resolución vigente y su origen.
   *
   * OPCIONAL a propósito: un servidor que todavía no la calcule debe dejar la
   * fila exactamente como estaba, y la UI no dibuja distintivo de origen
   * cuando no recibe una resolución. `null` y `undefined` significan lo mismo
   * para el listado: no hay resolución que mostrar.
   */
  effectiveResolution?: EffectiveResolution | null;
  /** `false` indica dictamen de IA histórico y desactualizado. */
  auditIsCurrent?: boolean | null;
  /**
   * Clasificación del caso: `true` = prueba, `false` = real.
   *
   * OPCIONAL como `effectiveResolution`: un servidor que todavía no la envíe debe
   * dejar la fila como estaba y la UI no dibuja etiqueta de prueba. El servidor
   * actual siempre la emite.
   */
  isTest?: boolean;
  canManageCases?: boolean;
  auditId?: string | null;
  auditHasHumanReview?: boolean;
  creatorRole?: 'user' | 'coordinator' | 'manager' | null;
  /** UUID estable del usuario que creó el expediente; no hay nombre autoritativo disponible. */
  creatorId?: string | null;
  assignedTo?: string | null;
  assignedName?: string | null;
}

export type CaseCreatorRole = 'user' | 'coordinator' | 'manager';

export interface CaseCreatorOption {
  creatorId: string;
  role: CaseCreatorRole;
  name: string | null;
}

export interface CaseDetail {
  id: string;
  status: CaseStatus;
  studentIdentifier: string | null;
  studentName?: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Fecha de inicio de clases que aportó una persona, con su procedencia.
   *
   * OPCIONALES a propósito, como `effectiveResolution` en el listado: un
   * servidor que todavía no las calcule debe dejar el caso tal como estaba, y
   * la interfaz no dibuja procedencia si no la recibe. `undefined` y `null`
   * significan lo mismo aquí: nadie la ha capturado.
   */
  cycleStartDate?: string | null;
  cycleStartDateByName?: string | null;
  cycleStartDateAt?: string | null;
  /** Clasificación del caso: `true` = prueba, `false` = real. */
  isTest?: boolean;
  /** Capacidad efectiva para mutar este expediente, resuelta por el servidor. */
  canWrite?: boolean;
  canManageCases?: boolean;
  country?: string | null;
  channel?: string | null;
  assignedTo?: string | null;
  assignedName?: string | null;
  externalSource?: 'FLOKZU' | null;
  externalCaseId?: string | null;
  flokzuData?: FlokzuCaseData | null;
}

export interface FlokzuCaseData {
  observations?: import('./flokzu-administrative.js').FlokzuObservation[];
  administrativeComments?: Array<{ label: string; value: string }>;
  academic: { campus: string | null; university: string | null; countryReported: string | null; program: string | null; level: string | null; block: string | null; programKey: string | null; entryDate: string | null };
  procedure: { policyReported: string | null; motive: string | null; description: string | null; requestDate: string | null; administrativeStartDate: string | null };
  operations: { currentTask: string | null; statusReported: string | null; finalizedReported: string | null; reviewerReported: string | null; supervisorReported: string | null; requesterReported: string | null; requesterArea: string | null };
  evidenceReferences: Array<{ label: string; value: string; url?: string }>;
}

export interface FlokzuImportPreview {
  batchId: string;
  exportedAt: string | null;
  totalRows: number;
  validRows: number;
  newRows: number;
  changedRows: number;
  unchangedRows: number;
  errorRows: number;
  unassignedRows: number;
  activeRows: number;
  administrativeRows: number;
  issues: Array<{ rowNumber: number; externalCaseId: string | null; message: string }>;
  assignments: Array<{ userId: string; name: string | null; count: number }>;
  rows: Array<{ rowNumber: number; externalCaseId: string; studentIdentifier: string; studentName: string; action: 'NEW' | 'UPDATE' | 'UNCHANGED'; assignmentUserId: string | null; assignmentName: string | null; canAutoAssign: boolean; classification: import('../shared/flokzu-review').FlokzuClassification; reason: string; previousStatus: string | null; nextStatus: string | null; previousTask: string | null; nextTask: string | null; previousFinalized: string | null; nextFinalized: string | null }>;
}

export interface FlokzuImportHistoryItem {
  id: string;
  status: 'PREVIEWED' | 'COMPLETED' | 'EXPIRED';
  totalRows: number;
  validRows: number;
  newRows: number;
  changedRows: number;
  unchangedRows: number;
  errorRows: number;
  issues: FlokzuImportPreview['issues'];
  result: { created?: number; updated?: number; unchanged?: number; errors?: number; unassigned?: number } | null;
  createdAt: string;
  completedAt: string | null;
}

export interface FlokzuImportedCase {
  id: string;
  externalCaseId: string;
  studentIdentifier: string | null;
  studentName: string | null;
  status: CaseStatus;
  assignedTo: string | null;
  assignedName: string | null;
  createdAt: string;
}

export interface CaseSummaryPage {
  cases: CaseSummary[];
  nextCursor: string | null;
  statusCounts?: Record<CaseStatus | 'ALL', number>;
  creatorOptions?: CaseCreatorOption[];
  responsibleOptions?: Array<{ userId: string; name: string | null }>;
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

/**
 * Un intento de OpenRouter tal como lo expone el servidor (ya saneado por lista
 * blanca en `src/server/audit-observability.ts`). Es diagnóstico técnico: la UI
 * no lo necesita para mostrar el dictamen, pero forma parte del contrato de la
 * API y sirve para explicar un fallo.
 */
export interface AuditAttemptDiagnostic {
  format: string;
  failureCategory: string | null;
  status: number | null;
  finishReason: string | null;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  retryable: boolean;
  capabilitiesVerified: boolean;
  failureReason: string | null;
  /**
   * Ruta del campo que el validador local rechazó (`null` si el fallo no tiene
   * ruta). Es lo que convierte "el modelo falló" en "este campo falló".
   */
  path: string | null;
  /**
   * Detalle SANEADO por el emisor del error (`null` si no está atestiguado).
   * Nunca texto crudo del modelo: `provider_metadata` es JSONB y el saneo es la
   * última puerta antes de que eso llegue a la pantalla.
   */
  detail: string | null;
}

/** Metadatos técnicos del proveedor, sin prompts, expediente, PII ni secretos. */
export interface AuditProviderMetadata {
  correlationId?: string;
  openrouterAttempts?: AuditAttemptDiagnostic[];
  usage?: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null; estimatedCostUSD: number | null } | null;
  stale?: boolean;
  deadlineAt?: string;
  fingerprint?: string;
}

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
  /**
   * Opcional a propósito: es un campo agregado al contrato y la UI tolera que
   * no llegue (respuestas old, caché, otros despliegues). `AuditResultPanel` no
   * lo lee, así que añadirlo no altera el render del dictamen.
   */
  providerMetadata?: AuditProviderMetadata | null;
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
  procedureSection?: string | null;
}

export async function getHistoricalAudit(caseId: string, auditId: string): Promise<AuditDetail> {
  const data = await request<{ audit: AuditDetail }>(`${casePath(caseId)}?auditId=${encodeURIComponent(auditId)}`, {}, [200]);
  return data.audit;
}

/**
 * Revisión humana del caso. Es ÚNICA por caso y, si existe, ES la resolución
 * final: el dictamen de la auditoría se conserva intacto y no la sobrescribe.
 *
 * `result` es `AuditResultType` (superset, no `HumanResolution`) porque las
 * revisiones humanas registradas ANTES de acotar el vocabulario a 6 opciones
 * pueden traer `CANCELACION_MATRICULA` o `DICTAMINACION`, y el frontend debe
 * seguir mostrándolas. El selector de nuevas revisiones sólo ofrece las 6 de
 * `HUMAN_RESOLUTIONS`.
 */
export interface CaseReviewDto {
  id: string;
  caseId: string;
  /** Auditoría cuyo dictamen se compara. Inmutable: la revisión no apunta a "la última". */
  auditId: string;
  /** Resolución del ASESOR. No se sobrescribe con la decisión del Coordinador. */
  result: AuditResultType;
  /**
   * Atribución DERIVADA por el servidor (correo de la sesión). El cliente nunca
   * la envía: un `reviewerName` del navegador se rechaza en el schema estricto.
   */
  reviewerName: string | null;
  comment: string;
  createdAt: string;
  /**
   * Bloque del Coordinador. Opcionales a propósito (mismo criterio que el resto
   * del contrato): un servidor que todavía no los emita deja la fila como estaba
   * y la UI los lee igual que `null` (aún sin finalizar).
   */
  coordinatorDecision?: CoordinatorDecision | null;
  coordinatorResolution?: string | null;
  coordinatorCreatedAt?: string | null;
  coordinatorComment?: string | null;
}

/** Estado TÉCNICO de la comparación; no es un veredicto. */
export type ComparisonStatus = 'RUNNING' | 'COMPLETED' | 'ERROR';

/**
 * Áreas que pueden dejar comentario sobre un caso.
 *
 * Duplica `AREA_COMMENT_AREAS` del servidor a propósito: el cliente no importa
 * de `src/server` porque ese módulo arrastra el cliente de InsForge al bundle
 * del navegador. El valor único es el `CHECK` de la base y el `z.enum` del
 * servidor; esta lista es la que la pantalla pinta.
 */
export const AREA_COMMENT_AREAS = [
  'BACK_OFFICE',
  'HELPDESK',
  'SCHOOL_SERVICES',
  'FINANCE',
  'ADDITIONAL',
] as const;

export type AreaCommentArea = (typeof AREA_COMMENT_AREAS)[number];

/**
 * Comentario de un área. Texto libre de una persona que NO participa en el
 * dictamen: se muestra, no se norma.
 */
export interface AreaComment {
  id: string;
  caseId: string;
  area: AreaCommentArea;
  comment: string;
  createdAt: string;
  updatedAt: string;
}

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
  /** Estado derivado del flujo de dos etapas; opcional por compatibilidad. */
  workflowState?: WorkflowState;
}

export interface CaseDetailResponse {
  case: CaseDetail;
  evidences: Evidence[];
  audit: AuditDetail | null;
  audits: AuditHistoryItem[];
  review: CaseReviewDto | null;
  comparison: ComparisonDto | null;
  effectiveResolution: EffectiveResolution | null;
  /** Si el último dictamen completado usa evidencias y datos actuales. */
  auditIsCurrent?: boolean | null;
  /** Estado derivado del flujo humano; opcional por compatibilidad. */
  workflowState?: WorkflowState;
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
  correlationId?: string;
}

// -----------------------------------------------------------------------------
// Errores
// -----------------------------------------------------------------------------

/** Error normalizado de la API: `{ error: { category, message } }`. */
export class ApiError extends Error {
  readonly category: string;
  readonly status: number;
  readonly correlationId?: string;

  constructor(category: string, message: string, status: number, correlationId?: string) {
    super(message);
    this.name = 'ApiError';
    this.category = category;
    this.status = status;
    this.correlationId = correlationId;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

let lastErrorCorrelationId: string | null = null;
export function getLastErrorCorrelationId(): string | null { return lastErrorCorrelationId; }
export function setLastErrorCorrelationId(value: string | null): void { lastErrorCorrelationId = value; }

/** Lee el cuerpo de error de una respuesta no exitosa. Nunca lanza. */
export async function readError(res: Response): Promise<ApiError> {
  const responseCorrelationId = typeof res.headers?.get === 'function' ? res.headers.get('x-correlation-id') : null;
  lastErrorCorrelationId = responseCorrelationId;
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

  return new ApiError(category, message, res.status, responseCorrelationId ?? undefined);
}

/** Señal tipada de que la sesión expiró y no pudo renovarse. */
export class SessionExpiredError extends ApiError {
  constructor() {
    super('UNAUTHENTICATED', 'Tu sesión expiró. Vuelve a iniciar sesión.', 401);
    this.name = 'SessionExpiredError';
  }
}

export function isSessionExpiredError(error: unknown): error is SessionExpiredError {
  return error instanceof SessionExpiredError;
}

/** Convierte cualquier excepción en un estado mostrable. */
export function toErrorState(error: unknown): ErrorState {
  if (error instanceof SessionExpiredError) return { category: error.category, message: error.message };
  if (error instanceof ApiError) return { category: error.category, message: error.message, ...(error.correlationId ? { correlationId: error.correlationId } : {}) };
  if (typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string' && ['NotReadableError', 'NotFoundError', 'SecurityError'].includes(error.name)) {
    return { category: 'FILE_READ_ERROR', message: 'El navegador no pudo leer el archivo. Descárgalo a una carpeta local y vuelve a seleccionarlo; puede haberse movido, cambiado o perdido el permiso de lectura. El expediente y las evidencias guardadas se conservan.' };
  }
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
  timeoutMs?: number;
}

interface SafeFetchOptions extends RequestOptions {
  /** Si es false, un 401 no dispara refresh automático. */
  retryAuth?: boolean;
}

const AUTH_ENDPOINTS = new Set(['/api/auth/session', '/api/auth/refresh']);

let activeRefresh: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'X-App-Request': '1' },
      credentials: 'same-origin',
      signal: AbortSignal.timeout(30_000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function refreshSessionInternal(): Promise<boolean> {
  if (!activeRefresh) {
    activeRefresh = performRefresh().finally(() => {
      activeRefresh = null;
    });
  }
  return activeRefresh;
}

function isMutating(method: string): boolean {
  return ['POST', 'PATCH', 'DELETE'].includes(method);
}

/**
 * Fetch con CSRF en mutaciones, retry único ante 401 y deduplicación de refresh.
 *
 * - Inyecta `X-App-Request: 1` en POST/PATCH/DELETE.
 * - Conserva `credentials: 'same-origin'`.
 * - Ante 401 (salvo en endpoints de auth) lanza UN refresh compartido; si
 *   funciona, reintenta la petición original una sola vez.
 * - Si el refresh falla o el reintento vuelve a dar 401, lanza
 *   `SessionExpiredError` para evitar bucles infinitos.
 */
async function safeFetch(url: string, options: SafeFetchOptions = {}): Promise<Response> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
    ...(isMutating(method) ? { 'X-App-Request': '1' } : {}),
  };

  const signal = AbortSignal.timeout(options.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: options.body, credentials: 'same-origin', signal });
  } catch {
    const correlationId = crypto.randomUUID();
    lastErrorCorrelationId = correlationId;
    throw new ApiError(
      signal.aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
      signal.aborted
        ? 'El servidor no respondió a tiempo. Consulta el estado guardado antes de repetir la operación.'
        : 'Se interrumpió la conexión con el servidor. Consulta el estado guardado antes de repetir la operación.',
      0,
      correlationId,
    );
  }

  if (res.status === 401 && options.retryAuth !== false && !AUTH_ENDPOINTS.has(url)) {
    const refreshed = await refreshSessionInternal();
    if (refreshed) {
      return safeFetch(url, { ...options, retryAuth: false });
    }
    throw new SessionExpiredError();
  }

  return res;
}

async function responseJson<T>(res: Response): Promise<T> {
  try { return await res.json() as T; }
  catch {
    throw new ApiError('RESPONSE_ERROR', 'No se pudo leer la respuesta completa del servidor. Consulta el estado guardado antes de repetir la operación.', res.status, res.headers.get('x-correlation-id') ?? crypto.randomUUID());
  }
}

async function request<T>(url: string, options: RequestOptions, expected: number[]): Promise<T> {
  const res = await safeFetch(url, options);
  if (!expected.includes(res.status)) throw await readError(res);
  return responseJson<T>(res);
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

export async function listCasePage(options: {
  cursor?: string | null;
  status?: CaseStatus | 'ALL';
  workflowState?: Exclude<WorkflowState, 'FINALIZED'>;
  creatorRole?: CaseCreatorRole | 'ALL';
  creatorId?: string | 'ALL';
  assignedTo?: string | 'ALL';
  limit?: number;
} = {}): Promise<CaseSummaryPage> {
  const params = new URLSearchParams({ limit: String(options.limit ?? 50) });
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.status && options.status !== 'ALL') params.set('status', options.status);
  if (options.workflowState) params.set('workflowState', options.workflowState);
  if (options.creatorRole && options.creatorRole !== 'ALL') params.set('creatorRole', options.creatorRole);
  if (options.creatorId && options.creatorId !== 'ALL') params.set('creatorId', options.creatorId);
  if (options.assignedTo && options.assignedTo !== 'ALL') params.set('assignedTo', options.assignedTo);
  return request<CaseSummaryPage>(`/api/cases?${params.toString()}`, {}, [200]);
}

export async function createCase(studentIdentifier?: string, studentName?: string, requestId?: string): Promise<CaseSummary> {
  const data = await request<{ case: CaseSummary }>(
    '/api/cases',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(requestId ? { 'x-idempotency-key': requestId } : {}) },
      body: JSON.stringify({
        ...(studentIdentifier ? { studentIdentifier } : {}),
        ...(studentName ? { studentName } : {}),
      }),
    },
    [200, 201],
  );
  return data.case;
}

export async function previewFlokzuImport(file: File): Promise<FlokzuImportPreview> {
  const form = new FormData();
  form.set('file', file);
  const response = await safeFetch('/api/cases', { method: 'POST', body: form, timeoutMs: 60_000 });
  if (response.status !== 201) throw await readError(response);
  return (await responseJson<{ preview: FlokzuImportPreview }>(response)).preview;
}

export async function confirmFlokzuImport(batchId: string): Promise<NonNullable<FlokzuImportHistoryItem['result']>> {
  const data = await request<{ result: NonNullable<FlokzuImportHistoryItem['result']> }>('/api/cases', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ batchId }),
    timeoutMs: 60_000,
  }, [200]);
  return data.result;
}

export async function getFlokzuImportHistory(importOffset = 0): Promise<{ imports: FlokzuImportHistoryItem[]; assignmentOptions: Array<{ userId: string; name: string | null }>; cases: FlokzuImportedCase[]; casesNextOffset: number | null }> {
  const params = new URLSearchParams({ view: 'imports', importOffset: String(importOffset) });
  return request(`/api/cases?${params.toString()}`, {}, [200]);
}

export async function assignImportedCase(caseId: string, assignedTo: string | null): Promise<void> {
  await request<{ ok: true }>(casePath(caseId), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assignedTo }),
  }, [200]);
}

export async function setCaseTestFlag(caseId: string, isTest: boolean): Promise<CaseDetail> {
  const data = await request<{ case: CaseDetail }>(casePath(caseId), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ isTest }),
  }, [200]);
  return data.case;
}

export async function deleteCaseDraft(caseId: string): Promise<void> {
  await request<{ deleted: true }>(casePath(caseId), {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ target: 'draft' }),
  }, [200]);
}

export async function deleteCaseAudit(caseId: string, auditId: string): Promise<void> {
  await request<{ deleted: true }>(casePath(caseId), {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ target: 'audit', auditId }),
  }, [200]);
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
    auditIsCurrent: data.auditIsCurrent ?? null,
    workflowState: data.workflowState,
  };
}

/**
 * Guarda la fecha de inicio de clases que escribió una persona.
 *
 * Es un dato humano con procedencia: el servidor guarda la fecha, su autor (el
 * de la sesión, nunca el que viaje en el cuerpo) y la hora. Guardar dos veces
 * PISA lo anterior, no acumula (UPSERT).
 *
 * NO dispara una re-auditoría (DO_NOT_REPROCESS_AI_UNNECESSARILY): quien la
 * escribe decide después si hace falta auditar de nuevo. El nombre se RECORTA
 * antes de viajar por lo mismo que en `saveAreaComment`: el servidor valida con
 * `.trim()`, así que mandarlo sin recortar convertiría un nombre válido en uno
 * de 121 caracteres.
 */
export async function setCycleStartDate(caseId: string, date: string, byName: string): Promise<CaseDetail> {
  const data = await request<{ case: CaseDetail }>(
    casePath(caseId),
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cycleStartDate: date, cycleStartDateByName: byName.trim() }),
    },
    [200],
  );
  return data.case;
}

// -----------------------------------------------------------------------------
// Evidencias
// -----------------------------------------------------------------------------

/**
 * Sube el archivo como cuerpo binario crudo (sin multipart).
 * El nombre viaja en `x-file-name` URL-encoded porque HTTP headers no admiten
 * caracteres no ASCII.
 */
const uploadRequests = new WeakMap<File, Map<string, string>>();

export async function uploadEvidence(caseId: string, file: File): Promise<Evidence> {
  file = await captureEvidenceFile(file);
  const head = await readEvidenceHead(file);
  const contentType = resolveEvidenceMime(head, file.type, file.name) ?? 'application/octet-stream';
  const requests = uploadRequests.get(file) ?? new Map<string, string>();
  let requestId = requests.get(caseId);
  if (!requestId && file.size <= 8 * 1024 * 1024 && typeof file.arrayBuffer === 'function' && crypto.subtle) {
    try {
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const identity = new TextEncoder().encode(`${file.name}\0${contentType}`);
      const bytes = new Uint8Array(fileBytes.length + identity.length);
      bytes.set(fileBytes); bytes.set(identity, fileBytes.length);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const storageKey = `evidence-request:${caseId}:${digest}`;
      const saved = sessionStorage.getItem(storageKey);
      requestId = saved && /^[a-f0-9-]{36}$/i.test(saved) ? saved : crypto.randomUUID();
      sessionStorage.setItem(storageKey, requestId);
    } catch { /* La identidad en memoria sigue disponible sin almacenamiento local. */ }
  }
  requestId ??= crypto.randomUUID();
  requests.set(caseId, requestId);
  uploadRequests.set(file, requests);

  const res = await safeFetch(casePath(caseId, '/evidence'), {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'x-file-name': encodeURIComponent(file.name),
      'x-idempotency-key': requestId,
    },
    body: file,
    timeoutMs: 120_000,
  });
  if (res.status !== 201 && res.status !== 200) throw await readError(res);
  const data = await responseJson<{ evidence: Evidence }>(res);
  if (data.evidence.processingStatus === 'ERROR') {
    throw new ApiError('TRANSCRIPTION_ERROR', `El original quedó guardado, pero su preparación falló: ${data.evidence.processingError ?? 'no se pudo iniciar la transcripción'}. Reintentar reutiliza este archivo.`, 502, res.headers.get('x-correlation-id') ?? undefined);
  }
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
  const res = await safeFetch(casePath(caseId, '/audit'), { method: 'POST', timeoutMs: 285_000 });
  if (res.status === 200) {
    const data = await responseJson<{ audit: AuditDetail }>(res);
    return { kind: 'finished', audit: data.audit };
  }
  if (res.status === 202) {
    const data = await responseJson<{ audit: AuditDetail | null; pendingEvidence: string[] }>(res);
    return { kind: 'pending', pendingEvidence: data.pendingEvidence ?? [] };
  }
  throw await readError(res);
}

export async function getAudit(caseId: string): Promise<AuditDetail | null> {
  const data = await request<{ audit: AuditDetail | null }>(casePath(caseId, '/audit'), {}, [200]);
  return data.audit ?? null;
}

// -----------------------------------------------------------------------------
// Comentarios por área
//
// Un comentario por área y caso, con UPSERT: "guardar" sustituye lo anterior.
// No participa en el dictamen y no se manda a ningún modelo.
// -----------------------------------------------------------------------------

/** Lee los comentarios del caso. `GET` puro: nunca crea nada. */
export async function getAreaComments(caseId: string): Promise<AreaComment[]> {
  const data = await request<{ comments?: AreaComment[] }>(casePath(caseId, '/area-comments'), {}, [200]);
  return data.comments ?? [];
}

/**
 * Guarda el comentario de un área.
 *
 * El texto se RECORTA antes de viajar por la misma razón que en
 * `submitCaseReview`: el servidor valida con `.trim()`, así que mandarlo sin
 * recortar convertiría un comentario válido en uno de 4001 caracteres.
 */
export async function saveAreaComment(
  caseId: string,
  input: { area: AreaCommentArea; comment: string },
): Promise<AreaComment> {
  const data = await request<{ comment: AreaComment }>(
    casePath(caseId, '/area-comments'),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ area: input.area, comment: input.comment.trim() }),
    },
    [200, 201],
  );
  return data.comment;
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
    workflowState: data.workflowState,
  };
}

/**
 * Estado del flujo humano, DERIVADO de la revisión cuando el servidor no lo
 * manda explícito. Es la MISMA regla que `deriveWorkflowState` del servidor
 * (módulo hoja, sin imports de servidor): sin fila falta el Asesor; con fila sin
 * decisión del Coordinador falta la finalización; con decisión, finalizado.
 */
export function workflowStateOf(review: CaseReviewDto | null, provided?: WorkflowState | null): WorkflowState {
  if (provided) return provided;
  if (review === null) return 'PENDING_ADVISOR';
  return review.coordinatorDecision == null ? 'PENDING_COORDINATOR' : 'FINALIZED';
}

/**
 * Registra la revisión humana de la ETAPA DE ASESOR. La comparación se genera
 * cuando el Coordinador emite la decisión final.
 *
 * El cuerpo es `{ result, comment? }`. NO se envía `reviewerName`: el servidor
 * deriva la atribución de la sesión y un `reviewerName` del cliente se rechaza
 * como campo extra (`HumanReviewInputSchema` es `strict`).
 *
 * Lanza `ApiError` con `status` 400 (validación) o 409 (ya existe revisión).
 */
export async function submitCaseReview(
  caseId: string,
  input: { result: AuditResultType; comment: string },
): Promise<{ review: CaseReviewDto; comparison: ComparisonDto | null; workflowState: WorkflowState | null }> {
  const data = await request<{ review: CaseReviewDto; comparison: ComparisonDto | null; workflowState?: WorkflowState }>(
    casePath(caseId, '/review'),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        result: input.result,
        comment: input.comment.trim(),
      }),
    },
    [200, 201],
  );
  return { review: data.review, comparison: data.comparison, workflowState: data.workflowState ?? null };
}

/**
 * Finaliza la ETAPA DE COORDINADOR sobre una revisión de Asesor y, al persistir
 * el dictamen final, inicia su comparación con IA.
 *
 * `APPROVE` conserva la resolución del Asesor y NO admite `resolution`.
 * `CHANGE` exige una resolución distinta de la del Asesor. El actor y la hora
 * los pone el servidor desde la sesión; ningún campo de atribución viaja.
 */
export async function finalizeCaseReview(
  caseId: string,
  input: { decision: CoordinatorDecision; resolution?: AuditResultType; comment?: string; country?: string; channel?: string },
): Promise<{ review: CaseReviewDto; workflowState: WorkflowState | null; comparison: ComparisonDto | null }> {
  const body: Record<string, unknown> = {
    decision: input.decision,
    comment: (input.comment ?? '').trim(),
  };
  if (input.decision === 'CHANGE' && input.resolution) body.resolution = input.resolution;
  if (input.country) body.country = input.country;
  if (input.channel) body.channel = input.channel;
  const data = await request<{ review: CaseReviewDto; workflowState?: WorkflowState; comparison?: ComparisonDto | null }>(
    casePath(caseId, '/review'),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    [200],
  );
  return { review: data.review, workflowState: data.workflowState ?? null, comparison: data.comparison ?? null };
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

export type IncidentModule = 'Resumen' | 'Calidad' | 'IA y Costos' | 'Expedientes' | 'Nueva auditoría' | 'Incidencias' | 'Otro';
export type IncidentStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
export interface TicketEventDto {
  id: string;
  event_type: 'CREATED' | 'COMMENT' | 'STATUS_CHANGED';
  body: string;
  previous_status: IncidentStatus | null;
  next_status: IncidentStatus | null;
  created_at: string;
}
export interface IncidentTicketDto {
  id: string;
  reporter_email: string;
  module: IncidentModule;
  description: string;
  status: IncidentStatus;
  context: { route?: string; correlationId?: string };
  created_at: string;
  updated_at: string;
  events: TicketEventDto[];
}
export interface SanitizedErrorDto {
  correlation_id: string;
  source: 'FRONTEND' | 'BACKEND' | 'ASYNC';
  category: string;
  module: string;
  route: string;
  created_at: string;
}

export async function reportProblem(input: { module: IncidentModule; description: string; context: { route?: string; correlationId?: string } }): Promise<IncidentTicketDto> {
  const data = await request<{ ticket: IncidentTicketDto }>('/api/dashboard/incidents', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'ticket', ...input }),
  }, [201]);
  return data.ticket;
}

export async function reportClientError(input: { source: 'FRONTEND' | 'ASYNC'; category: 'FRONTEND_ERROR' | 'UNHANDLED_REJECTION'; module: string; route: string; correlationId: string }): Promise<void> {
  await request<{ recorded: boolean }>('/api/dashboard/incidents', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'client-error', ...input }),
  }, [200]);
}

export async function addIncidentComment(input: { ticketId: string; comment: string }): Promise<void> {
  await request<{ saved: boolean }>('/api/dashboard/incidents', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'ticket-comment', ...input }),
  }, [200]);
}

export async function getIncidents(): Promise<{ tickets: IncidentTicketDto[]; errors: SanitizedErrorDto[] }> {
  return request('/api/dashboard/incidents', {}, [200]);
}

export async function updateIncident(input: { ticketId: string; status: IncidentStatus; comment?: string }): Promise<IncidentTicketDto> {
  const data = await request<{ ticket: IncidentTicketDto }>('/api/dashboard/incidents', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  }, [200]);
  return data.ticket;
}

// -----------------------------------------------------------------------------
// Sesión
// -----------------------------------------------------------------------------

export interface SessionUser {
  id: string;
  email: string;
}

/**
 * Rol de aplicación que viaja en la sesión. Vocabulario cerrado y persistido en
 * `app_memberships`: `user` se presenta como "Asesor". Duplicado del servidor a
 * propósito (el cliente no importa de `src/server`, que arrastra el SDK de
 * InsForge al bundle del navegador). Sigue siendo SOLO presentación: ningún
 * guard de la UI reemplaza la autorización server-side.
 */
export type AppRole = 'user' | 'coordinator' | 'manager';

const APP_ROLES: readonly AppRole[] = ['user', 'coordinator', 'manager'];

/** Guard de vocabulario del cliente: comparte el vocabulario con el servidor. */
export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && (APP_ROLES as readonly string[]).includes(value);
}

/** Snapshot de sesión que consume la SPA. `null` = sin sesión. */
export interface SessionSnapshot {
  /** Rol resuelto por el servidor; `null` si no resolvió o no se reconoce. */
  role: AppRole | null;
  /** Capacidades efectivas devueltas por el servidor; false ante respuesta inválida. */
  capabilities: {
    canReadAllCases: boolean;
    canReviewOwnCases: boolean;
    canFinalizeAnyCase: boolean;
    canWriteOwnedCases: boolean;
    canManageCases: boolean;
    canImportCases: boolean;
  };
}

export async function signOut(): Promise<void> {
  const res = await safeFetch('/api/auth/session', {
    method: 'DELETE',
    retryAuth: false,
  });
  if (res.status === 401) return; // la sesión ya no existía; las cookies se limpian en el servidor
  if (![204, 200].includes(res.status)) {
    throw await readError(res);
  }
}

/**
 * Refresco explícito. Devuelve el snapshot de sesión con el rol que resolvió el
 * servidor, o `null` si no hay sesión. Un rol que el servidor no reconoce se
 * degrada a `null` (no se cree una capacidad nueva desde el cliente).
 */
export async function refreshSession(): Promise<SessionSnapshot | null> {
  const res = await safeFetch('/api/auth/refresh', {
    method: 'POST',
    retryAuth: false,
  });
  if (res.status !== 200) return null;
  try {
    const data = (await res.json()) as { ok?: unknown; role?: unknown; capabilities?: Record<string, unknown> };
    const role = isAppRole(data.role) ? data.role : null;
    const caps = data.capabilities;
    return { role, capabilities: {
      canReadAllCases: caps?.canReadAllCases === true,
      canReviewOwnCases: caps?.canReviewOwnCases === true,
      canFinalizeAnyCase: caps?.canFinalizeAnyCase === true,
      canWriteOwnedCases: caps?.canWriteOwnedCases === true,
      canManageCases: caps?.canManageCases === true,
      canImportCases: caps?.canImportCases === true,
    } };
  } catch {
    return { role: null, capabilities: { canReadAllCases: false, canReviewOwnCases: false, canFinalizeAnyCase: false, canWriteOwnedCases: false, canManageCases: false, canImportCases: false } };
  }
}

export interface FlokzuReviewPageData {
  tickets: import('../shared/flokzu-review').FlokzuTicket[]; nextOffset: number | null;
  counts: { pending: number; rejected: number; finalized: number; otherStage: number; discrepancies: number };
}
export interface FlokzuTicketDetail {
  ticket: import('../shared/flokzu-review').FlokzuTicket; data: FlokzuCaseData;
  history: import('../shared/flokzu-review').FlokzuEvent[]; historyNextOffset: number | null;
}
export function getFlokzuReview(filters: Record<string,string>): Promise<FlokzuReviewPageData> {
  const params = new URLSearchParams({ view: 'flokzu-review' });
  for (const [key,value] of Object.entries(filters)) if (value) params.set(key,value);
  return request('/api/cases?'+params.toString(), {}, [200]);
}
export function getFlokzuTicket(caseId: string, historyOffset = 0): Promise<FlokzuTicketDetail> {
  return request('/api/cases?'+new URLSearchParams({view:'flokzu-review',caseId,historyOffset:String(historyOffset)}).toString(), {}, [200]);
}
export function decideFlokzuTicket(decision: import('../shared/flokzu-review').FlokzuDecision): Promise<unknown> {
  return request('/api/cases?view=flokzu-review', {method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(decision)}, [200]);
}
