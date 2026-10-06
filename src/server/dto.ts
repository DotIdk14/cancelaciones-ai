// =============================================================================
// DTOs — forma exacta que consume la UI (contrato de API).
// =============================================================================

import type { ErrorCategory, EvidenceStatus, TranscriptData } from '../skills/audit/types.js';
import type { ComparisonOutcomePayload } from '../skills/review/schema.js';
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
}

export interface CaseDetailDto {
  id: string;
  status: CaseRow['status'];
  studentIdentifier: string | null;
  createdAt: string;
  updatedAt: string;
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
 * Revisión humana del caso. `result` es la RESOLUCIÓN FINAL: si existe, manda
 * sobre el dictamen de la auditoría.
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
    effectiveResolution: deriveEffectiveResolution(row.review ?? null, row.audit ?? null),
  };
}

export function caseToDetail(row: CaseRow): CaseDetailDto {
  return {
    id: row.id,
    status: row.status,
    studentIdentifier: row.student_identifier,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
  };
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
    return { result: review.result, source: 'HUMAN' };
  }
  if (!audit || audit.status !== 'COMPLETED') return null;
  const resultJson = parseJsonField(audit.result_json);
  const output = resultJson && typeof resultJson === 'object' ? resultJson as Record<string, unknown> : null;
  const assessment = output && typeof output.audit === 'object' ? output.audit as Record<string, unknown> : null;
  const result = assessment?.result;
  if (typeof result !== 'string' || result === '') return null;
  return { result, source: 'AI' };
}
