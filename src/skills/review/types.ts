// =============================================================================
// Tipos del módulo de revisión humana — Cancelaciones, Bajas y Deserción UTEL
// =============================================================================
//
// QUÉ ES ESTE MÓDULO Y QUÉ NO ES
//   Una persona registra UNA única revisión por caso. Esa revisión es la
//   RESOLUCIÓN FINAL del caso, y la auditoría original NO se modifica: el
//   dictamen sigue siendo el que emitió el modelo, con su id y su `result_json`
//   intactos. Lo que se agrega es una COMPARACIÓN durable que evalúa si el
//   dictamen original coincide o discrepa de la decisión humana.
//
//   La comparación NO es un segundo dictamen. No tiene campo `result`, no
//   reclasifica y no sustituye nada: es un juicio con trazabilidad (secciones
//   del procedimiento y evidencia citada) sobre la distancia entre dos
//   resoluciones. Quien resuelve es la persona; NO_RULES_ENGINE.
//
//   El procedimiento V5 se CONSUME (POLICY_IS_IMMUTABLE): el módulo no lo
//   modifica, no lo interpreta y no busca política en ninguna otra fuente.
// =============================================================================

import { AUDIT_RESULTS, type ErrorCategory, type EvidenceInputItem, type ModelUsage } from '../audit/types.js';

// -----------------------------------------------------------------------------
// Vocabulario cerrado de la resolución humana
//
// DERIVADO, NO DUPLICADO: es el MISMO vocabulario que puede emitir el Audit
// Skill (`AUDIT_RESULTS`), y por eso es un alias y no una lista escrita a mano.
// Una lista propia podría derivar en dos vocabularios que ya no significan lo
// mismo, y entonces `effectiveResolution.source = 'AI'` y `= 'HUMAN'` serían
// comparables sólo por el texto. Con el alias, la persona elige en el mismo
// dominio que el Skill y la comparación entre ambos es siempre significativa.
// -----------------------------------------------------------------------------
export const HUMAN_RESOLUTIONS = AUDIT_RESULTS;
export type HumanResolution = (typeof HUMAN_RESOLUTIONS)[number];

/**
 * Límites del comentario humano.
 *
 * El mínimo existe porque `comment` es la justificación que la persona Opone a
 * un dictamen: un resultado sin razonamiento no es revisable por nadie y deja
 * la fila durable sin contenido humano que comparar. El máximo existe para que
 * el comentario siga siendo un argumento y no un expediente pegado dentro de
 * una columna, y para acotar el contexto que se inyecta en la comparación.
 */
export const REVIEW_COMMENT_MIN = 10;
export const REVIEW_COMMENT_MAX = 2000;

// -----------------------------------------------------------------------------
// Estados de una comparación (mismo vocabulario técnico que `audits.status`:
// RUNNING -> COMPLETED | ERROR, y es estado TÉCNICO, no veredicto).
// -----------------------------------------------------------------------------
export const COMPARISON_STATUSES = ['RUNNING', 'COMPLETED', 'ERROR'] as const;
export type ComparisonStatus = (typeof COMPARISON_STATUSES)[number];

/**
 * Veredicto de la comparación, tal como lo emite el modelo.
 *
 * `agrees` responde una sola pregunta: ¿el dictamen original coincide con la
 * resolución humana? `discrepancyReason` es la CONSECUENCIA de esa respuesta y
 * es obligatorio exactamente cuando `agrees === false` (lo verifica
 * `ComparisonResultSchema`): una discrepancia sin motivo es exactamente el dato
 * inútil para el producto.
 *
 * `procedureSections` y `evidenceIds` son obligatorios y no vacíos
 * (TRACE_EVERY_DECISION): una conclusión normativa sin sección del Procedimiento
 * V5 ni sin evidencia citada no se puede auditar contra la fuente oficial, que
 * es el criterio de este producto.
 */
export interface ComparisonResult {
  agrees: boolean;
  /** Por qué coincide o discrepa, en términos del expediente y del procedimiento. */
  explanation: string;
  /** Confianza de la comparación en [0,1]. Nunca es 1 sobre una discrepancia sin acreditar. */
  confidence: number;
  /** Causa concreta de la discrepancia, o `null` si `agrees === true`. */
  discrepancyReason: string | null;
  /** Secciones del Procedimiento V5 realmente aplicadas. */
  procedureSections: string[];
  /** Evidencias del expediente que sostienen la comparación. */
  evidenceIds: string[];
}

/**
 * Lo que se persiste en `case_comparisons.result_json`: el veredicto validado
 * MÁS la metadata técnica real que reporta OpenRouter. La metadata la agrega el
 * servidor; el modelo no puede declararla (mismo contrato que `AuditResult`).
 */
export interface ComparisonOutcome extends ComparisonResult {
  model: { provider: 'openrouter'; model: string };
  usage: ModelUsage;
}

/** Entrada del Skill de comparación. */
export interface ComparisonSkillInput {
  caseId: string;
  studentIdentifier: string | null;
  /** Resolución humana registrada: la que resuelve el caso. */
  humanResult: HumanResolution;
  /** Comentario humano. Contenido NO CONFIABLE para el modelo. */
  humanComment: string;
  /** `audits.result_json` de la auditoría REFERENCIADA por la revisión. */
  auditResultJson: unknown;
  /** Evidencias del expediente (mismas que leyó la auditoría). */
  evidences: EvidenceInputItem[];
}

/** Row durable de `case_reviews`. */
export interface CaseReviewRecord {
  id: string;
  caseId: string;
  /** Auditoría cuyo dictamen se compara. La revisión NUNCA apunta a "la última". */
  auditId: string;
  result: HumanResolution;
  comment: string;
  createdAt: string;
  createdBy: string | null;
}

/** Row durable de `case_comparisons`. */
export interface ComparisonRecord {
  id: string;
  caseReviewId: string;
  auditId: string;
  status: ComparisonStatus;
  resultJson: ComparisonOutcome | null;
  provider: string;
  model: string;
  errorCategory: ErrorCategory | null;
  latencyMs: number | null;
  deadlineAt: string | null;
  createdAt: string;
  updatedAt: string;
}