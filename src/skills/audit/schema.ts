import { z } from 'zod';
import {
  AUDIT_RESULTS,
  CYCLE_START_FACT_KEY,
  EVIDENCE_CHANNELS,
  EVIDENCE_COUNTRIES,
  SECTION_5_2_MINIMUMS,
  TEMPORAL_RELATIONS,
} from './types.js';
import { ApiError } from '../../server/http.js';

// =============================================================================
// Schemas del Audit Skill.
// El LLM sólo emite el assessment. Metadata técnica (modelo/usage/coste) se
// agrega en servidor desde OpenRouter real; nunca desde la respuesta del modelo.
// =============================================================================

/** `2026-09-28` — la fecha se normaliza a ISO para que la comparación sea unívoca. */
const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'INVALID_AI_RESPONSE: la fecha debe estar en formato ISO YYYY-MM-DD');

/**
 * Análisis temporal solicitud vs. inicio de ciclo.
 *
 * Vive en el MISMO nivel que `facts`/`timeline`/`conflicts` porque es un hecho
 * de primera clase del expediente, no una nota: es lo que impide que una fecha
 * administrativa se use como fecha de inicio académico.
 */
const TemporalAnalysisSchema = z
  .object({
    cycleStartDate: IsoDate.nullable(),
    cycleStartEvidenceIds: z.array(z.string().min(1)),
    cycleStartEvidenceText: z.string().nullable(),
    cancellationRequestDate: IsoDate.nullable(),
    cancellationRequestEvidenceIds: z.array(z.string().min(1)),
    relationToCycleStart: z.enum(TEMPORAL_RELATIONS),
    reasoning: z.string().min(1),
  })
  .strict();

/**
 * Origen de la cancelación: país de operación y canal por el que el estudiante
 * la expresó.
 *
 * Es vocabulario CERRADO (ver `EVIDENCE_COUNTRIES` / `EVIDENCE_CHANNELS`): el
 * modelo elige de la lista o emite `null`. No es texto libre, y por eso puede
 * proyectarse a columnas de `cases` sin la prohibición que aplica a `audit.rule`.
 * `evidenceIds` acredita la afirmación cuando hay valor; la coherencia entre
 * ambos se comprueba en reglas de negocio, no en el shape.
 */
const OriginSchema = z
  .object({
    country: z.enum(EVIDENCE_COUNTRIES).nullable(),
    channel: z.enum(EVIDENCE_CHANNELS).nullable(),
    evidenceIds: z.array(z.string().min(1)),
    evidenceText: z.string().nullable(),
  })
  .strict();

const MissingEvidenceSchema = z.object({
  title: z.string().min(1),
  reason: z.string().min(1),
  acceptedEvidence: z.array(z.string().min(1)).min(1),
  relatedProcedureSection: z.string().min(1),
  relatedEvidenceIds: z.array(z.string().min(1)),
  blocking: z.boolean(),
}).strict();

const ProcedureCheckSchema = z.object({
  procedureSection: z.string().min(1),
  criterion: z.string().min(1),
  status: z.enum(['ACREDITADO', 'NO_ACREDITADO', 'NO_DETERMINABLE']),
  reasoning: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)),
  observedValues: z.array(z.object({
    label: z.string().min(1),
    value: z.string().min(1),
  }).strict()),
}).strict();

const ProvisionalResolutionSchema = z.object({
  result: z.enum(AUDIT_RESULTS).exclude(['EVIDENCIA_INSUFICIENTE']),
  rationale: z.string().min(1),
  procedureSection: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)),
}).strict();

export const AiAuditAssessmentSchema = z
  .object({
    case: z.object({
      matricula: z.string().nullable(),
      studentName: z.string().nullable(),
      program: z.string().nullable(),
      cycle: z.string().nullable(),
      cycleStartDate: z.string().nullable(),
    }),

    evidenceSummary: z.array(
      z.object({
        evidenceId: z.string(),
        filename: z.string(),
        detectedType: z.string(),
        description: z.string(),
        relevant: z.boolean(),
      }),
    ),

    facts: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
        confidence: z.number().min(0).max(1),
        evidenceIds: z.array(z.string()),
        evidenceText: z.string().nullable(),
      }),
    ),

    timeline: z.array(
      z.object({
        date: z.string().nullable(),
        event: z.string(),
        evidenceIds: z.array(z.string()),
      }),
    ),

    conflicts: z.array(
      z.object({
        description: z.string(),
        evidenceIds: z.array(z.string()),
      }),
    ),

    temporalAnalysis: TemporalAnalysisSchema,

    origin: OriginSchema,

    audit: z.object({
      result: z.enum(AUDIT_RESULTS),
      rule: z.string().min(1),
      procedureSection: z.string().min(1),
      auditPath: z.object({
        hypothesis: z.string().min(1),
        procedureSections: z.array(z.string().min(1)).min(1),
        reasoning: z.string().min(1),
      }).strict(),
      provisionalResolution: ProvisionalResolutionSchema.nullable(),
      reasoning: z.string().min(1),
      confidence: z.number().min(0).max(1),
      supportingEvidenceIds: z.array(z.string().min(1)),
      missingEvidence: z.array(MissingEvidenceSchema),
      procedureChecks: z.array(ProcedureCheckSchema),
      observations: z.array(z.string()),
    }),
  })
  .strict();

export const AuditResultSchema = AiAuditAssessmentSchema.extend({
  model: z.object({
    provider: z.literal('openrouter'),
    model: z.string(),
  }),
  usage: z.object({
    promptTokens: z.number().nullable(),
    completionTokens: z.number().nullable(),
    totalTokens: z.number().nullable(),
    estimatedCostUSD: z.number().nullable(),
  }),
}).strict();

export type AiAuditAssessment = z.infer<typeof AiAuditAssessmentSchema>;
export type AuditResult = z.infer<typeof AuditResultSchema>;

export function parseAiAuditAssessment(raw: unknown): AiAuditAssessment {
  return parseWithInvalidAiError(AiAuditAssessmentSchema, raw);
}

export function parseAuditResult(raw: unknown): AuditResult {
  return parseWithInvalidAiError(AuditResultSchema, raw);
}

interface ValidatedAssessment {
  case: { cycleStartDate: string | null };
  facts: Array<{ key: string; value: string | number | boolean | null; confidence: number; evidenceIds: string[]; evidenceText: string | null }>;
  temporalAnalysis: {
    cycleStartDate: string | null;
    cycleStartEvidenceIds: string[];
    cycleStartEvidenceText: string | null;
    cancellationRequestDate: string | null;
    cancellationRequestEvidenceIds: string[];
    relationToCycleStart: string;
  };
  origin: {
    country: string | null;
    channel: string | null;
    evidenceIds: string[];
  };
  audit: {
    result: string;
    rule: string;
    procedureSection: string;
    auditPath: { procedureSections: string[] };
    confidence: number;
    supportingEvidenceIds: string[];
    missingEvidence: Array<{ title: string; reason: string; relatedProcedureSection: string; blocking: boolean }>;
    procedureChecks: Array<{ procedureSection: string; status: string; evidenceIds: string[]; observedValues: Array<{ label: string; value: string }> }>;
    provisionalResolution: { evidenceIds: string[] } | null;
  };
}

const SECTION_5_2_VALUES = {
  callsRequired: 'llamadas requeridas',
  callsObserved: 'llamadas acreditadas',
  writtenInteractionsRequired: 'interacciones escritas requeridas',
  writtenInteractionsObserved: 'interacciones escritas acreditadas',
} as const;

function refersToProcedureSection(value: string, section: string): boolean {
  return new RegExp(`(^|[^0-9])${section.replace('.', '\\.')}([^0-9]|$)`).test(value);
}

function validateContactAttemptsMinimum(assessment: ValidatedAssessment): void {
  const sections = [
    assessment.audit.procedureSection,
    ...assessment.audit.auditPath.procedureSections,
    ...assessment.audit.procedureChecks.map((check) => check.procedureSection),
  ];
  if (!sections.some((section) => refersToProcedureSection(section, '5.2'))) return;

  const check = assessment.audit.procedureChecks.find((item) => refersToProcedureSection(item.procedureSection, '5.2'));
  if (!check) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.procedureChecks: la ruta aplica 5.2 y exige un check de intentos mínimos de contacto');
  }

  const valueFor = (label: string): string | undefined =>
    check.observedValues.find((value) => value.label.toLowerCase() === label)?.value;
  const requiredCalls = valueFor(SECTION_5_2_VALUES.callsRequired);
  const observedCalls = valueFor(SECTION_5_2_VALUES.callsObserved);
  const requiredWritten = valueFor(SECTION_5_2_VALUES.writtenInteractionsRequired);
  const observedWritten = valueFor(SECTION_5_2_VALUES.writtenInteractionsObserved);
  if (
    requiredCalls !== String(SECTION_5_2_MINIMUMS.calls)
    || requiredWritten !== String(SECTION_5_2_MINIMUMS.writtenInteractions)
    || observedCalls === undefined
    || observedWritten === undefined
  ) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.procedureChecks: 5.2 exige los conteos observados y los mínimos exactos de llamadas e interacciones escritas');
  }

  const parseObservedCount = (value: string): number | null => {
    if (value === 'NO_DETERMINABLE') return null;
    if (!/^(0|[1-9]\d*)$/.test(value)) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.procedureChecks: los conteos de 5.2 deben ser enteros no negativos o NO_DETERMINABLE');
    }
    return Number(value);
  };
  const calls = parseObservedCount(observedCalls);
  const writtenInteractions = parseObservedCount(observedWritten);
  const callsMissing = calls === null ? null : Math.max(0, SECTION_5_2_MINIMUMS.calls - calls);
  const writtenMissing = writtenInteractions === null
    ? null
    : Math.max(0, SECTION_5_2_MINIMUMS.writtenInteractions - writtenInteractions);
  const countShortfall = (callsMissing !== null && callsMissing > 0) || (writtenMissing !== null && writtenMissing > 0);
  const countsUndetermined = calls === null || writtenInteractions === null;
  const requirementNotMet = countShortfall || countsUndetermined || check.status !== 'ACREDITADO';

  if (!requirementNotMet) return;
  if (countShortfall && check.status !== 'NO_ACREDITADO') {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.procedureChecks 5.2: un conteo inferior al mínimo debe tener status NO_ACREDITADO');
  }
  if (countsUndetermined && !countShortfall && check.status !== 'NO_DETERMINABLE') {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.procedureChecks 5.2: un conteo no comprobable debe tener status NO_DETERMINABLE');
  }
  if (assessment.audit.result !== 'EVIDENCIA_INSUFICIENTE') {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.result: no se puede dictaminar mientras 5.2 esté incumplido o no sea determinable; usa EVIDENCIA_INSUFICIENTE');
  }
  const blockingAttempts = assessment.audit.missingEvidence.find((item) =>
    item.blocking
    && refersToProcedureSection(item.relatedProcedureSection, '5.2')
    && item.title.toLowerCase().includes('intentos mínimos de contacto'),
  );
  if (!blockingAttempts) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.missingEvidence: 5.2 exige un item bloqueante "Intentos mínimos de contacto" relacionado con la sección 5.2');
  }

  const reason = blockingAttempts.reason.toLowerCase();
  const callsMissingPhrase = callsMissing === 1 ? 'falta 1 llamada' : `faltan ${callsMissing} llamadas`;
  if (callsMissing !== null && callsMissing > 0 && !reason.includes(callsMissingPhrase)) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', `INVALID_AI_RESPONSE: audit.missingEvidence: debe explicar que faltan ${callsMissing} llamadas para cumplir 5.2`);
  }
  const writtenMissingPhrase = writtenMissing === 1
    ? 'falta 1 interacción escrita'
    : `faltan ${writtenMissing} interacciones escritas`;
  if (writtenMissing !== null && writtenMissing > 0 && !reason.includes(writtenMissingPhrase)) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', `INVALID_AI_RESPONSE: audit.missingEvidence: debe explicar que faltan ${writtenMissing} interacciones escritas para cumplir 5.2`);
  }
  if (countsUndetermined && !reason.includes('no fue posible acreditar')) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.missingEvidence: debe indicar que no fue posible acreditar el conteo de intentos de 5.2');
  }
}

function validateBusinessRules(assessment: ValidatedAssessment): void {
  if (assessment.audit.rule.trim().length === 0) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.rule: debe ser un string no vacío');
  }
  if (assessment.audit.procedureSection.trim().length === 0) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.procedureSection: debe ser un string no vacío');
  }
  if (assessment.audit.result !== 'EVIDENCIA_INSUFICIENTE' && assessment.audit.supportingEvidenceIds.length === 0) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.supportingEvidenceIds: debe incluir al menos una evidencia');
  }
  if (assessment.audit.result === 'EVIDENCIA_INSUFICIENTE') {
    if (assessment.audit.provisionalResolution === null) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.provisionalResolution: EVIDENCIA_INSUFICIENTE exige una orientación provisional');
    }
    if (assessment.audit.missingEvidence.length === 0) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.missingEvidence: EVIDENCIA_INSUFICIENTE exige al menos un elemento');
    }
    if (!assessment.audit.missingEvidence.some((item) => item.blocking)) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.missingEvidence: al menos un item debe tener blocking === true');
    }
  }
  if (assessment.audit.result !== 'EVIDENCIA_INSUFICIENTE' && assessment.audit.provisionalResolution !== null) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.provisionalResolution: solo aplica a EVIDENCIA_INSUFICIENTE');
  }
  const hasBlocking = assessment.audit.missingEvidence.some((item) => item.blocking);
  if (hasBlocking && assessment.audit.result !== 'EVIDENCIA_INSUFICIENTE') {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.missingEvidence: no puede haber bloqueo cuando el resultado no es EVIDENCIA_INSUFICIENTE');
  }
  assessment.audit.procedureChecks.forEach((check, index) => {
    if (check.status === 'ACREDITADO' && (check.evidenceIds.length === 0 || check.observedValues.length === 0)) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `INVALID_AI_RESPONSE: audit.procedureChecks.${index}.status: ACREDITADO exige evidencia y valores observados`);
    }
    if (check.status === 'NO_ACREDITADO' && (check.evidenceIds.length === 0 || check.observedValues.length === 0)) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `INVALID_AI_RESPONSE: audit.procedureChecks.${index}.status: NO_ACREDITADO exige evidencia y valores observados que sustenten la ausencia`);
    }
  });
  validateContactAttemptsMinimum(assessment);
  validateTemporalCoherence(assessment);
  validateOrigin(assessment);
}

/**
 * Coherencia del origen: un valor afirmado exige la evidencia que lo acredita.
 *
 * No reclasifica ni completa el dato: solo rechaza lo internamente imposible. Un
 * país o un canal sin `evidenceIds` es una afirmación sin respaldo, y como el
 * dictamen es la fuente de verdad de la columna, ese valor se proyectaría a la
 * base como un hecho que nadie puede verificar.
 *
 * Un `null` en cambio es legítimo: "no determinable" es un resultado válido, no
 * una carencia, y no obliga a `EVIDENCIA_INSUFICIENTE` ni a `missingEvidence`.
 */
function validateOrigin(assessment: ValidatedAssessment): void {
  const origin = assessment.origin;
  if (origin == null) return;
  const path = 'INVALID_AI_RESPONSE: origin.evidenceIds';
  if (origin.country !== null && origin.evidenceIds.length === 0) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', `${path}: origin.country exige al menos una evidencia que lo acredite`);
  }
  if (origin.channel !== null && origin.evidenceIds.length === 0) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', `${path}: origin.channel exige al menos una evidencia que lo acredite`);
  }
}

/**
 * Coherencia del análisis temporal.
 *
 * NO reclasifica y NO calcula la relación: el modelo ya la emitió. Sólo rechaza
 * assessments que son internamente imposibles, que es exactamente donde se
 * escondía el defecto que motivó este bloque:
 *
 *  1. Una `cycleStartDate` afirmada sin evidencia ni cita textual no está
 *     acreditada: sería una fecha inventada.
 *  2. Una relación `DESPUES_DEL_INICIO` (o `ANTES_DEL_INICIO`) sin AMBAS fechas
 *     acreditadas no es una comparación: es una afirmación. Sin `cycleStartDate`
 *     no se puede afirmar que la solicitud fue posterior al inicio, que es
 *     justamente el razonamiento que convertía una baja en BAJA.
 *  3. Una fecha `null` con `evidenceIds` no vacíos referencia evidencia que no
 *     respalda nada.
 *  4. `case.cycleStartDate` es lo que muestra la UI. Si divergiera de
 *     `temporalAnalysis.cycleStartDate`, la pantalla afirmaría una fecha que el
 *     análisis temporal no sostiene.
 *  5. Una fecha de inicio acreditada DEBE tener su fact `cycle_start_date` con
 *     evidencia y cita, y con confianza < 1: una fecha crítica declarada con
 *     certeza absoluta es, por definición, una fecha mal caracterizada.
 *  6. Si la relación es `NO_DETERMINABLE`, el dictamen no puede declararse con
 *     confianza máxima: la cronología crítica quedó sin acreditar.
 */
function validateTemporalCoherence(assessment: ValidatedAssessment): void {
  const temporal = assessment.temporalAnalysis;
  const path = 'INVALID_AI_RESPONSE: temporalAnalysis';

  if (temporal.cycleStartDate !== null) {
    if (temporal.cycleStartEvidenceIds.length === 0) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `${path}.cycleStartDate: una fecha de inicio de ciclo afirmada exige cycleStartEvidenceIds; sin evidencia no está acreditada`);
    }
    if (temporal.cycleStartEvidenceText === null || temporal.cycleStartEvidenceText.trim() === '') {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `${path}.cycleStartEvidenceText: una fecha de inicio de ciclo afirmada exige la cita textual que la identifica como inicio académico`);
    }
  } else if (temporal.cycleStartEvidenceIds.length > 0) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', `${path}.cycleStartEvidenceIds: sin cycleStartDate no puede haber evidencia que acredite el inicio de ciclo`);
  }

  if (temporal.cancellationRequestDate === null && temporal.cancellationRequestEvidenceIds.length > 0) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', `${path}.cancellationRequestEvidenceIds: sin cancellationRequestDate no puede haber evidencia que acredite la fecha de la solicitud`);
  }

  if (temporal.relationToCycleStart !== 'NO_DETERMINABLE') {
    if (temporal.cycleStartDate === null) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `${path}.relationToCycleStart: ${temporal.relationToCycleStart} exige un cycleStartDate acreditado; sin él la relación no es determinable`);
    }
    if (temporal.cancellationRequestDate === null) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `${path}.relationToCycleStart: ${temporal.relationToCycleStart} exige un cancellationRequestDate acreditado; la comparación es entre la solicitud y el inicio de ciclo`);
    }
  }

  if (temporal.cycleStartDate !== null && assessment.case.cycleStartDate !== temporal.cycleStartDate) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', `INVALID_AI_RESPONSE: case.cycleStartDate debe coincidir con temporalAnalysis.cycleStartDate (${temporal.cycleStartDate}); la UI muestra case.cycleStartDate`);
  }

  if (temporal.cycleStartDate !== null) {
    const fact = assessment.facts.find((item) => item.key === CYCLE_START_FACT_KEY);
    if (!fact) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `INVALID_AI_RESPONSE: facts: cycleStartDate afirmada exige el fact "${CYCLE_START_FACT_KEY}" con su evidencia y su cita`);
    }
    if (fact.value !== temporal.cycleStartDate) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `INVALID_AI_RESPONSE: facts.${CYCLE_START_FACT_KEY}.value debe ser la fecha de inicio acreditada (${temporal.cycleStartDate})`);
    }
    if (fact.evidenceIds.length === 0 || fact.evidenceText === null || fact.evidenceText.trim() === '') {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `INVALID_AI_RESPONSE: facts.${CYCLE_START_FACT_KEY}: exige evidenceIds y evidenceText que acrediten la fecha de inicio`);
    }
    if (fact.confidence >= 1) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `INVALID_AI_RESPONSE: facts.${CYCLE_START_FACT_KEY}.confidence: una fecha crítica usada para el dictamen no admite confianza 1`);
    }
  }

  if (temporal.relationToCycleStart === 'NO_DETERMINABLE' && assessment.audit.confidence >= 1) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.confidence: con relationToCycleStart NO_DETERMINABLE el dictamen no admite confianza 1; la cronología crítica no está acreditada');
  }
}

function parseWithInvalidAiError<T>(schema: z.ZodType<T>, raw: unknown): T {
  try {
    const parsed = schema.parse(raw);
    if (parsed && typeof parsed === 'object' && 'audit' in parsed) {
      validateBusinessRules(parsed as unknown as ValidatedAssessment);
    }
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `INVALID_AI_RESPONSE: ${details.join(' | ')}`);
    }
    throw error;
  }
}
