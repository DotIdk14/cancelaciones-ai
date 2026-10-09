// =============================================================================
// DTOs — forma exacta que consume la UI (contrato de API).
// =============================================================================

import type { ErrorCategory, EvidenceStatus, TranscriptData } from '../skills/audit/types.js';
import type { ComparisonOutcomePayload } from '../skills/review/schema.js';
import type { CoordinatorDecision, WorkflowState } from '../skills/review/types.js';
import { readTranscriptFromJson } from './evidence-prep.js';
import { sanitizeProviderMetadata, type AuditProviderMetadata } from './audit-observability.js';
import type { AuditRow, AuditStatus, CaseRow, CaseSummaryRow, EvidenceRow } from './cases.js';
import type { CaseReviewRow, ComparisonRow } from './reviews.js';
import type { AreaCommentArea, AreaCommentRow } from './area-comments.js';

export interface CaseSummaryDto {
  id: string;
  status: CaseRow['status'];
  studentIdentifier: string | null;
  evidenceCount: number;
  createdAt: string;
  updatedAt: string;
  effectiveResolution: EffectiveResolution | null;
  /** `false` identifica un dictamen histórico que no corresponde a los datos actuales. */
  auditIsCurrent: boolean | null;
  /**
   * Clasificación explícita del caso: `true` = prueba, `false` = real. La UI la
   * usa para etiquetar; el backend la usa para excluir las pruebas de las
   * métricas operativas (PROJECTION_IS_NOT_THE_DICTAMEN: el flag no participa en
   * el dictamen).
   */
  isTest: boolean;
}

export interface CaseDetailDto {
  id: string;
  status: CaseRow['status'];
  studentIdentifier: string | null;
  createdAt: string;
  updatedAt: string;
  isTest: boolean;
  /** Capacidad efectiva para mutar este caso, resuelta por rol y propiedad. */
  canWrite: boolean;
  /**
   * Fecha de inicio de clases aportada por una persona, con su procedencia.
   *
   * Los tres son `null` mientras nadie la haya capturado, y esa es la razón de
   * ser de los tres: la fecha sin nombre ni hora no se puede atribuir y no se
   * puede corregir con criterio. `_by` (el uuid del autor) NO se expone: es dato
   * interno de auditoría y la interfaz solo necesita mostrar quién la escribió.
   */
  cycleStartDate: string | null;
  cycleStartDateByName: string | null;
  cycleStartDateAt: string | null;
}

export interface EvidenceDto {
  id: string;
  caseId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  hash: string;
  processingStatus: EvidenceStatus;
  processingError: string | null;
  transcript: TranscriptData | null;
  createdAt: string;
}

export interface AuditDetailDto {
  id: string;
  caseId: string;
  status: AuditStatus;
  provider: string;
  model: string;
  resultJson: unknown;
  errorCategory: ErrorCategory | null;
  latencyMs: number | null;
  evidenceFingerprint: string | null;
  attemptNumber: number | null;
  deadlineAt: string | null;
  createdAt: string;
  /**
   * Metadatos técnicos del proveedor, YA SANEADOS por lista blanca
   * (`sanitizeProviderMetadata`): sin prompts, sin expediente, sin PII y sin
   * secretos. Sin este campo, un audit en ERROR solo decía "falló" y el motivo
   * real (qué intento, con qué formato, si el catálogo se confirmó, cuántos
   * tokens gastó) quedaba encerrado en `audits.provider_metadata`, sin forma
   * de consultarlo por la API. Es aditivo: no cambia ni elimina ningún campo
   * existente del contrato.
   */
  providerMetadata: AuditProviderMetadata | null;
}

export interface AuditHistoryItemDto {
  id: string;
  status: AuditStatus;
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
 * Revisión humana del caso. `result` es la RESOLUCIÓN del ASESOR; si existe una
 * decisión del coordinador, el bloque `coordinator*` la registra APARTE sin
 * sobrescribir la del asesor. La resolución efectiva del caso la deriva
 * `deriveEffectiveResolution` en lectura.
 */
export interface CaseReviewDto {
  id: string;
  caseId: string;
  /** Auditoría cuyo dictamen se compara (inmutable). */
  auditId: string;
  result: string;
  reviewerName: string | null;
  comment: string;
  createdAt: string;
  coordinatorDecision: CoordinatorDecision | null;
  coordinatorResolution: string | null;
  /** Momento en que el coordinador registró la decisión. NULL hasta que actúa. */
  coordinatorCreatedAt: string | null;
  coordinatorComment: string | null;
}

/**
 * Comentario de un área sobre el caso.
 *
 * Es texto libre de una persona y NO participa en el dictamen. Viaja tal cual
 * porque la interfaz lo muestra escapado por React; si algún día se mandara a
 * un modelo, tendría que pasar por el cercado de `src/skills/sanitize.ts` antes.
 */
export interface AreaCommentDto {
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
 * EL VEREDICTO VA PLANO. `agrees`, `explanation`, `confidence`,
 * `discrepancyReason`, `procedureSections` y `evidenceIds` son el contrato que
 * consume la interfaz, y son `null` (o `[]`) mientras la comparación no esté
 * `COMPLETED`: no se publica un veredicto a medio hacer, y `null` quiere decir
 * "todavía no existe", no "el modelo respondeu que no".
 */
export interface ComparisonDto {
  id: string;
  caseReviewId: string;
  auditId: string;
  status: 'RUNNING' | 'COMPLETED' | 'ERROR';
  agrees: boolean | null;
  explanation: string | null;
  confidence: number | null;
  discrepancyReason: string | null;
  procedureSections: string[];
  evidenceIds: string[];
  provider: string | null;
  model: string | null;
  errorCategory: ErrorCategory | null;
  latencyMs: number | null;
  createdAt: string;
  // --- superset ---------------------------------------------------------------
  // `resultJson` es el MISMO veredicto sin aplanar más la metadata real de
  // OpenRouter (modelo y usage), y `deadlineAt`/`updatedAt` son las marcas de la
  // fila. Se emiten porque el cliente (`src/lib/api.ts`) ya fue escrito contra
  // ellos, y los campos planos se DERIVAN de `resultJson`, nunca al revés: no
  // pueden divergir. Si el cliente se pasa a los planos, estos tres sobran.
  resultJson: ComparisonOutcomePayload | null;
  deadlineAt: string | null;
  updatedAt: string;
}

/**
 * Resolución que gobierna el caso en este momento, y de dónde sale.
 *
 * `HUMAN` cuando existe revisión: es la decisión de la persona y sustituye al
 * dictamen. `AI` cuando no la hay: el resultado de la auditoría COMPLETED
 * vigente. `null` cuando no hay ninguna de las dos, porque un caso sin dictamen
 * emitido y sin decisión registrada NO tiene resolución, y afirmar una sería
 * inventarla.
 */
export interface EffectiveResolution {
  result: string;
  source: 'HUMAN' | 'AI';
}

export function caseToSummary(row: CaseSummaryRow): CaseSummaryDto {
  const count = row.evidence?.[0]?.count ?? 0;
  return {
    id: row.id,
    status: row.status,
    studentIdentifier: row.student_identifier,
    evidenceCount: count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    effectiveResolution: deriveEffectiveResolution(
      row.review ?? null,
      row.auditIsCurrent === false ? null : row.audit ?? null,
    ),
    auditIsCurrent: row.auditIsCurrent ?? (row.audit ? null : null),
    // `?? false` y no el valor directo: la columna es opcional en `CaseRow` para
    // que el listado siga funcionando si la migración aún no está aplicada, y el
    // default de la columna es `false` (real).
    isTest: row.is_test ?? false,
  };
}

export function caseToDetail(row: CaseRow, canWrite = false): CaseDetailDto {
  return {
    id: row.id,
    status: row.status,
    studentIdentifier: row.student_identifier,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isTest: row.is_test ?? false,
    canWrite,
    // `?? null` y no el valor directo: las columnas son opcionales en `CaseRow`
    // para que el `select('*')` siga funcionando si la migración aún no está
    // aplicada, y una columna ausente no es lo mismo que un `NULL` explícito
    // para quien lee el DTO.
    cycleStartDate: row.cycle_start_date ?? null,
    cycleStartDateByName: row.cycle_start_date_by_name ?? null,
    cycleStartDateAt: row.cycle_start_date_at ?? null,
  };
}

export function evidenceToDto(row: EvidenceRow): EvidenceDto {
  const transcript = row.processing_status === 'READY' ? readTranscriptFromJson(row.transcript_json) : null;
  const transcriptData = row.transcript_json && typeof row.transcript_json === 'object'
    ? row.transcript_json as Record<string, unknown>
    : null;
  return {
    id: row.id,
    caseId: row.case_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    hash: row.hash,
    processingStatus: row.processing_status,
    processingError: row.processing_status === 'ERROR' && typeof transcriptData?.error === 'string'
      ? transcriptData.error
      : null,
    transcript,
    createdAt: row.created_at,
  };
}

/** JSONB llega como objeto; por defensa, si viene string se parsea. */
function parseJsonField(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

export function auditToDto(row: AuditRow): AuditDetailDto {
  return {
    id: row.id,
    caseId: row.case_id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    resultJson: row.status === 'COMPLETED' ? parseJsonField(row.result_json) : null,
    errorCategory: row.error_category,
    latencyMs: row.latency_ms,
    evidenceFingerprint: row.evidence_fingerprint,
    attemptNumber: row.attempt_number,
    deadlineAt: row.deadline_at,
    createdAt: row.created_at,
    // `provider_metadata` es JSONB: se valida la forma antes de devolverlo y, si
    // no hay nada reconocible, se responde `null` en vez de propagar basura.
    providerMetadata: sanitizeProviderMetadata(row.provider_metadata),
  };
}

export function auditHistoryItemToDto(row: AuditRow): AuditHistoryItemDto {
  const resultJson = row.status === 'COMPLETED' ? parseJsonField(row.result_json) : null;
  const output = resultJson && typeof resultJson === 'object' ? resultJson as Record<string, unknown> : null;
  const assessment = output && typeof output.audit === 'object' ? output.audit as Record<string, unknown> : null;
  return {
    id: row.id,
    status: row.status,
    result: typeof assessment?.result === 'string' ? assessment.result : null,
    confidence: typeof assessment?.confidence === 'number' ? assessment.confidence : null,
    provider: row.provider,
    model: row.model,
    errorCategory: row.error_category,
    latencyMs: row.latency_ms,
    evidenceFingerprint: row.evidence_fingerprint,
    attemptNumber: row.attempt_number,
    createdAt: row.created_at,
  };
}

export function caseReviewToDto(row: CaseReviewRow): CaseReviewDto {
  return {
    id: row.id,
    caseId: row.case_id,
    auditId: row.audit_id,
    result: row.result,
    reviewerName: row.reviewer_name ?? null,
    comment: row.comment,
    createdAt: row.created_at,
    coordinatorDecision: row.coordinator_decision ?? null,
    coordinatorResolution: row.coordinator_resolution ?? null,
    coordinatorCreatedAt: row.coordinator_created_at ?? null,
    coordinatorComment: row.coordinator_comment ?? null,
  };
}

/**
 * Estado del flujo de revisión humana, DERIVADO de la fila (nunca una columna
 * ni `cases.status`).
 *
 *   - sin fila                     → PENDING_ADVISOR (falta la decisión del asesor);
 *   - fila sin `coordinator_decision` → PENDING_COORDINATOR (falta la finalización);
 *   - fila con `coordinator_decision` → FINALIZED.
 *
 * `coordinator_decision` ausente (migración sin aplicar) se lee igual que NULL:
 * aún no hay finalización. Nunca se reutiliza `cases.status` ni `audits` para
 * este estado.
 */
export function deriveWorkflowState(review: CaseReviewRow | null): WorkflowState {
  if (!review) return 'PENDING_ADVISOR';
  return review.coordinator_decision == null ? 'PENDING_COORDINATOR' : 'FINALIZED';
}

export function areaCommentToDto(row: AreaCommentRow): AreaCommentDto {
  return {
    id: row.id,
    caseId: row.case_id,
    area: row.area,
    comment: row.comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Aplana la comparación para el contrato de la interfaz.
 *
 * El veredicto se lee UNA vez de `result_json` y los campos planos se derivan de
 * esa misma lectura, así que el contrato plano y `resultJson` no pueden
 * discrepar. Sólo se lee si la fila está `COMPLETED`: una fila RUNNING o ERROR
 * no publica veredicto, ni siquiera parcial.
 */
export function comparisonToDto(row: ComparisonRow): ComparisonDto {
  const outcome = row.status === 'COMPLETED' ? (parseJsonField(row.result_json) as ComparisonOutcomePayload | null) : null;
  return {
    id: row.id,
    caseReviewId: row.case_review_id,
    auditId: row.audit_id,
    status: row.status,
    agrees: outcome?.agrees ?? null,
    explanation: outcome?.explanation ?? null,
    confidence: outcome?.confidence ?? null,
    discrepancyReason: outcome?.discrepancyReason ?? null,
    procedureSections: outcome?.procedureSections ?? [],
    evidenceIds: outcome?.evidenceIds ?? [],
    provider: row.provider ?? null,
    model: row.model ?? null,
    errorCategory: row.error_category,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
    resultJson: outcome,
    deadlineAt: row.deadline_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Deriva la resolución efectiva EN LECTURA. No escribe nada y no toca el
 * dictamen: la auditoría original sigue siendo exactamente la que emitió el
 * modelo, y esta función sólo decide qué resultado se muestra como vigente.
 *
 * La precedencia es la del producto: la decisión de la persona manda sobre el
 * dictamen, en cualquier caso. `audit` debe ser la auditoría COMPLETED vigente
 * (el que la pasa se encarga: `latestCompletedAudit`), y aquí se vuelve a
 * comprobar el estado por si alguien pasa otra cosa.
 */
export function deriveEffectiveResolution(
  review: CaseReviewRow | null,
  audit: AuditRow | null,
): EffectiveResolution | null {
  if (review) {
    return { result: finalHumanResolution(review), source: 'HUMAN' };
  }
  if (!audit || audit.status !== 'COMPLETED') return null;
  const resultJson = parseJsonField(audit.result_json);
  const output = resultJson && typeof resultJson === 'object' ? resultJson as Record<string, unknown> : null;
  const assessment = output && typeof output.audit === 'object' ? output.audit as Record<string, unknown> : null;
  const result = assessment?.result;
  if (typeof result !== 'string' || result === '') return null;
  return { result, source: 'AI' };
}

/**
 * Resolución humana que gobierna el caso: la del coordinador cuando hubo
 * `CHANGE`, si no la del asesor. `APPROVE` conserva `result`, así que ambas
 * devuelven lo mismo en ese caso.
 */
function finalHumanResolution(review: CaseReviewRow): string {
  return review.coordinator_decision === 'CHANGE' && review.coordinator_resolution
    ? review.coordinator_resolution
    : review.result;
}
