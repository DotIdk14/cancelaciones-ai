// =============================================================================
// Tipos del Audit Skill — Cancelaciones, Bajas y Deserción de Estudiantes UTEL
// =============================================================================
// Contrato de entrada y salida del Skill. La salida ES el resultado de la
// auditoría: el backend no vuelve a clasificar después de que OpenRouter
// responde y Zod valida.
// =============================================================================

/** Únicas clasificaciones que puede emitir el Skill. */
export const AUDIT_RESULTS = [
  'CANCELACION_VENTA',
  'BAJA',
  'CANCELACION_VENTA_OPERATIVA',
  'CANCELACION_MATRICULA',
  'DICTAMINACION',
  'EVIDENCIA_INSUFICIENTE',
] as const;

export type AuditResultType = (typeof AUDIT_RESULTS)[number];

/** Estados del caso. */
export const CASE_STATUSES = ['DRAFT', 'READY', 'AUDITING', 'COMPLETED', 'ERROR'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** Estados de una evidencia. */
export const EVIDENCE_STATUSES = ['UPLOADED', 'TRANSCRIBING', 'READY', 'ERROR'] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

/**
 * Relación temporal entre la solicitud de no continuar y el inicio del ciclo.
 *
 * Es un vocabulario CERRADO y describe una ÚNICA comparación: la fecha en que el
 * estudiante expresó que no quería continuar frente a la fecha de inicio de ciclo
 * acreditada. Nunca se calcula contra una fecha administrativa.
 */
export const TEMPORAL_RELATIONS = [
  'ANTES_DEL_INICIO',
  'MISMO_DIA_DEL_INICIO',
  'DESPUES_DEL_INICIO',
  'NO_DETERMINABLE',
] as const;
export type TemporalRelation = (typeof TEMPORAL_RELATIONS)[number];

/**
 * `key` reservado del fact que acredita la fecha de inicio de ciclo.
 *
 * El backend NO inventa ni deduce esta fecha: sólo verifica que, cuando el modelo
 * afirma una `cycleStartDate`, exista este fact con su evidencia, su cita textual
 * y una confianza menor que 1 (una fecha crítica siempre tiene calidad variable).
 */
export const CYCLE_START_FACT_KEY = 'cycle_start_date';

export const EVIDENCE_KINDS = ['IMAGE', 'PDF', 'AUDIO', 'TEXT'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** Categorías de error del producto, incluidas causas detalladas del transporte IA. */
export const ERROR_CATEGORIES = [
  'UPLOAD_ERROR',
  'TRANSCRIPTION_ERROR',
  'AI_PROVIDER_ERROR',
  'INVALID_AI_RESPONSE',
  'TRUNCATED_OUTPUT',
  'SCHEMA_VALIDATION_ERROR',
  'INVALID_EVIDENCE_REFERENCE',
  'RATE_LIMIT',
  'PAYMENT_REQUIRED',
  'PROVIDER_UNAVAILABLE',
  'UNSUPPORTED_MODEL_CAPABILITY',
  'CAPABILITY_CATALOG_UNAVAILABLE',
  'STORAGE_ERROR',
  'DATABASE_ERROR',
  'AUTH_ERROR',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'UNKNOWN',
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

/** Categorías de error del API (alias público, sin UNKNOWN). */
export const API_ERROR_CATEGORIES = ERROR_CATEGORIES.filter((c) => c !== 'UNKNOWN') as readonly Exclude<
  ErrorCategory,
  'UNKNOWN'
>[];

/** Evidencia tal como la consume el Skill (tras preparación técnica). */
export interface EvidenceInputItem {
  evidenceId: string;
  filename: string;
  mimeType: string;
  kind: EvidenceKind;
  /** contenido textual listo para contexto (texto extraído, transcripción) */
  text?: string;
  /** indica si `text`/transcripción fue recortado para respetar límites de contexto */
  truncated?: boolean;
  originalChars?: number;
  /** contenido visual listo para el modelo (base64 de imagen) */
  imageBase64?: string;
  /** páginas de PDF como imágenes cuando el texto es insuficiente */
  pagesBase64?: string[];
  /** PDF crudo en base64 (data URI) para envío nativo al modelo multimodal cuando el texto es insuficiente */
  pdfBase64?: string;
  /** transcripción AssemblyAI normalizada (para audio READY) */
  transcript?: TranscriptData | null;
  /** metadatos técnicos */
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

/** Transcripción normalizada de AssemblyAI (sección 11 del encargo). */
export interface TranscriptData {
  transcript: string;
  durationSeconds: number | null;
  speakers: Array<{
    speaker: string;
    start: number;
    end: number;
    text: string;
    confidence: number | null;
  }>;
}

/** Entrada del Skill. */
export interface AuditSkillInput {
  caseId: string;
  studentIdentifier: string | null;
  evidences: EvidenceInputItem[];
}

/** Metadata de uso que OpenRouter reporta de verdad (null cuando no existe). */
export interface ModelUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  estimatedCostUSD: number | null;
}

/** Resultado de la ejecución del Skill. */
export interface ProcedureCheck {
  procedureSection: string;
  criterion: string;
  status: 'ACREDITADO' | 'NO_ACREDITADO' | 'NO_DETERMINABLE';
  reasoning: string;
  evidenceIds: string[];
  observedValues: Array<{ label: string; value: string }>;
}

export interface MissingEvidenceItem {
  title: string;
  reason: string;
  acceptedEvidence: string[];
  relatedProcedureSection: string;
  relatedEvidenceIds: string[];
  blocking: boolean;
}

export interface ProvisionalResolution {
  result: Exclude<AuditResultType, 'EVIDENCIA_INSUFICIENTE'>;
  rationale: string;
  procedureSection: string;
  evidenceIds: string[];
}

/**
 * Análisis temporal de la solicitud frente al inicio de ciclo.
 *
 * Existe para que una fecha de inicio de ciclo NUNCA pueda ser confundida con una
 * fecha administrativa. El modelo es el único que puede determinar `cycleStartDate`
 * y lo hace POR SIGNIFICADO SEMÁNTICO, no porque sea la única fecha visible: cada
 * fecha del expediente se revisa buscando la que representa el INICIO ACADÉMICO.
 *
 * Reglas estructurales que el backend verifica (sin reclasificar nunca):
 *  - `cycleStartDate` exige `cycleStartEvidenceIds` y `cycleStartEvidenceText`.
 *  - Una relación distinta de `NO_DETERMINABLE` exige AMBAS fechas acreditadas.
 *  - Una fecha ausente implica `evidenceIds: []` (nada se referencia sin fecha).
 *  - `case.cycleStartDate` debe coincidir con `cycleStartDate` (la UI lee `case`).
 *
 * Cuando no hay evidencia que acredite el inicio académico, `cycleStartDate` es
 * `null` y `relationToCycleStart` es `NO_DETERMINABLE`. No se deduce de otras fechas.
 */
export interface TemporalAnalysis {
  /** Fecha real de inicio de ciclo/clases en ISO `YYYY-MM-DD`, o null si no está acreditada. */
  cycleStartDate: string | null;
  /** Evidencias que acreditan explícitamente el inicio académico. */
  cycleStartEvidenceIds: string[];
  /** Cita textual que acredita el inicio académico. */
  cycleStartEvidenceText: string | null;
  /** Fecha en que el estudiante expresó que no quería continuar, o null. */
  cancellationRequestDate: string | null;
  /** Evidencias que acreditan la fecha de la solicitud. */
  cancellationRequestEvidenceIds: string[];
  /** `cancellationRequestDate` frente a `cycleStartDate`. Única comparación válida. */
  relationToCycleStart: TemporalRelation;
  /** Por qué la relación es esa, y por qué se descartó cada fecha administrativa. */
  reasoning: string;
}

export interface AuditSkillOutput {
  case: {
    matricula: string | null;
    studentName: string | null;
    program: string | null;
    cycle: string | null;
    cycleStartDate: string | null;
  };
  evidenceSummary: Array<{
    evidenceId: string;
    filename: string;
    detectedType: string;
    description: string;
    relevant: boolean;
  }>;
  facts: Array<{
    key: string;
    label: string;
    value: string | number | boolean | null;
    confidence: number;
    evidenceIds: string[];
    evidenceText: string | null;
  }>;
  timeline: Array<{
    date: string | null;
    event: string;
    evidenceIds: string[];
  }>;
  conflicts: Array<{
    description: string;
    evidenceIds: string[];
  }>;
  temporalAnalysis: TemporalAnalysis;
  audit: {
    result: AuditResultType;
    rule: string;
    procedureSection: string;
    auditPath: {
      hypothesis: string;
      procedureSections: string[];
      reasoning: string;
    };
    provisionalResolution: ProvisionalResolution | null;
    reasoning: string;
    confidence: number;
    supportingEvidenceIds: string[];
    missingEvidence: MissingEvidenceItem[];
    procedureChecks: ProcedureCheck[];
    observations: string[];
  };
  model: {
    provider: 'openrouter';
    model: string;
  };
  usage: ModelUsage;
}

/** Registro durable de una auditoría (fila de la tabla `audits`). */
export interface AuditRecordRow {
  id: string;
  caseId: string;
  status: 'RUNNING' | 'COMPLETED' | 'ERROR';
  provider: string;
  model: string;
  resultJson: AuditSkillOutput | null;
  errorCategory: ErrorCategory | null;
  latencyMs: number | null;
  createdAt: string;
}
