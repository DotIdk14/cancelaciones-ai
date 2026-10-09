import { z } from 'zod';
import {
  AREA_COMMENT_SCOPES,
  AUDIT_RESULTS,
  CYCLE_START_FACT_KEY,
  EVIDENCE_CHANNELS,
  EVIDENCE_COUNTRIES,
  SECTION_5_2_MINIMUMS,
  TEMPORAL_RELATIONS,
} from './types.js';
import type { AssessmentValidationContext } from './types.js';
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
 * Única definición de "esto es una fecha del contrato".
 *
 * La usan los dos lados del camino de la fecha aportada por el equipo: el
 * expediente solo la inyecta al prompt si es ISO (para que un valor inesperado
 * no pueda llevar texto) y la validación la acepta o la rechaza igual. Se
 * exporta para no duplicar el formato en dos módulos.
 */
export function isIsoDateValue(value: unknown): value is string {
  return typeof value === 'string' && IsoDate.safeParse(value).success;
}

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
  result: z.enum(AUDIT_RESULTS).exclude(['EVIDENCIA_INSUFICIENTE', 'TICKET_RECHAZADO']),
  rationale: z.string().min(1),
  procedureSection: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)),
}).strict();

/**
 * Identificación del caso TAL COMO LA VE EL MODELO.
 *
 * Sin `cycleStartDate`: esa fecha la deriva el servidor desde
 * `temporalAnalysis.cycleStartDate` (ver `deriveCaseCycleStartDate`). Pedírsela al
 * modelo obligaba a comparar dos copias del mismo dato DESPUÉS de que respondiera,
 * y esa comparación solo puede fallar tumbando el dictamen entero. Nadie leía el
 * campo: era un peso muerto con una invariante post-hoc como única defensa.
 *
 * SIN `.strict()`, a propósito. El JSON Schema que ve el proveedor ya fuerza
 * `additionalProperties: false` en los dos perfiles (`provider-schema.ts`), así que
 * quitarlo aquí NO cambia lo que se le pide al modelo: no se le pide "no emitas
 * esta clave", se le sigue prohibiendo emitirla. Lo único que `.strict()` añadía
 * era un modo de fallo —la clave que el modelo emita por costumbre tumba el
 * dictamen tras dos intentos—, que es justo la clase de fallo que la Tarea 1
 * existía para eliminar. Con `.strip()` la clave sobra se descarta, y la
 * divergencia no puede llegar a `result_json` porque `deriveCaseCycleStartDate`
 * sobrescribe la única copia después. Fijado en `tests/cycle-start-date.test.ts`.
 */
const ModelCaseSchema = z.object({
  matricula: z.string().nullable(),
  studentName: z.string().nullable(),
  program: z.string().nullable(),
  cycle: z.string().nullable(),
});

/**
 * Identificación del caso TAL COMO SE PERSISTE.
 *
 * Lleva `cycleStartDate` porque forma parte del `result_json` ya emitido y debe
 * seguir releyéndose. Descarta claves desconocidas (no `.strict()`) por el mismo
 * motivo: un dictamen guardado con una clave que este contrato ya no declara debe
 * releerse sin romperse (PROJECTION_IS_NOT_THE_DICTAMEN).
 *
 * El campo es opcional en la ENTRADA para tolerar filas históricas que no lo
 * traigan; la derivación del servidor lo rellena.
 */
const PersistedCaseSchema = ModelCaseSchema.extend({
  cycleStartDate: IsoDate.nullable().optional(),
});

export const AiAuditAssessmentSchema = z
  .object({
    case: ModelCaseSchema,

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
      rejectionReason: z.string().min(1).nullable(),
      reasoning: z.string().min(1),
      confidence: z.number().min(0).max(1),
      supportingEvidenceIds: z.array(z.string().min(1)),
      missingEvidence: z.array(MissingEvidenceSchema),
      procedureChecks: z.array(ProcedureCheckSchema),
      observations: z.array(z.string()),
    }),
  })
  .strict();

/** Snapshot de un comentario de área inyectado al expediente. */
export const AreaCommentSnapshotSchema = z.object({
  area: z.enum(AREA_COMMENT_SCOPES),
  /** Texto EXACTO que entró al prompt (ya cercado con wrapUntrusted). */
  comment: z.string(),
});

export const AuditResultSchema = AiAuditAssessmentSchema.extend({
  /** El `case` persistido suma la fecha de inicio; el del modelo no la tiene. */
  case: PersistedCaseSchema,
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
  /**
   * Snapshot de los comentarios de área que el servidor inyectó (solo
   * BACK_OFFICE / HELPDESK, ya cercados). ADITIVO y armado por el servidor: el
   * modelo nunca lo emite; un resultado histórico no lo trae y sigue siendo
   * válido (por eso es opcional).
   */
  areaComments: z.array(AreaCommentSnapshotSchema).optional(),
}).strict();

export type AiAuditAssessment = z.infer<typeof AiAuditAssessmentSchema>;
export type AuditResult = z.infer<typeof AuditResultSchema>;

/**
 * Rellena `case.cycleStartDate` con la única copia de la fecha que el dictamen
 * sostiene: `temporalAnalysis.cycleStartDate`, que sí está acreditada con
 * evidencia, cita y fact propio.
 *
 * Es una ASIGNACIÓN, no una comprobación. Antes esta relación era una invariante
 * post-hoc (`case` debía coincidir con `temporalAnalysis`): el modelo emitía las
 * dos copias y, si divergían, el dictamen entero moría en ERROR. El campo no lo
 * leía nadie, así que la divergencia no aportaba nada y solo podía costar una
 * auditoría.
 *
 * Idempotente: aplicarla dos veces sobre el mismo resultado da el mismo valor.
 * No muta el argumento.
 */
export function deriveCaseCycleStartDate(result: AuditResult): AuditResult {
  return {
    ...result,
    case: { ...result.case, cycleStartDate: result.temporalAnalysis.cycleStartDate },
  };
}

export function parseAiAuditAssessment(raw: unknown, context: AssessmentValidationContext = {}): AiAuditAssessment {
  return parseWithInvalidAiError(AiAuditAssessmentSchema, raw, context);
}

export function parseAuditResult(raw: unknown, context: AssessmentValidationContext = {}): AuditResult {
  return parseWithInvalidAiError(AuditResultSchema, raw, context);
}

interface ValidatedAssessment {
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
    rejectionReason: string | null;
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
  const routeApplies52 = sections.some((section) => refersToProcedureSection(section, '5.2'));
  if (!routeApplies52) {
    if (assessment.audit.result === 'TICKET_RECHAZADO') {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.result: TICKET_RECHAZADO exige que la ruta evalúe la sección 5.2; sin intentos mínimos en juego no hay rechazo por 5.2');
    }
    return;
  }

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

  if (!requirementNotMet) {
    if (assessment.audit.result === 'TICKET_RECHAZADO') {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.result: TICKET_RECHAZADO solo aplica cuando la sección 5.2 está incumplida o no es determinable; con los intentos acreditados emite la clasificación que corresponda');
    }
    return;
  }
  if (countShortfall && check.status !== 'NO_ACREDITADO') {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.procedureChecks 5.2: un conteo inferior al mínimo debe tener status NO_ACREDITADO');
  }
  if (countsUndetermined && !countShortfall && check.status !== 'NO_DETERMINABLE') {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.procedureChecks 5.2: un conteo no comprobable debe tener status NO_DETERMINABLE');
  }
  if (assessment.audit.result !== 'TICKET_RECHAZADO') {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.result: no se puede dictaminar mientras 5.2 esté incumplido o no sea determinable; usa TICKET_RECHAZADO');
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

function validateBusinessRules(assessment: ValidatedAssessment, context: AssessmentValidationContext): void {
  if (assessment.audit.rule.trim().length === 0) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.rule: debe ser un string no vacío');
  }
  if (assessment.audit.procedureSection.trim().length === 0) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.procedureSection: debe ser un string no vacío');
  }
  if (assessment.audit.result === 'TICKET_RECHAZADO') {
    if (assessment.audit.rejectionReason === null || assessment.audit.rejectionReason.trim() === '') {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.rejectionReason: TICKET_RECHAZADO exige la razón del rechazo con los números exactos de los intentos de la sección 5.2');
    }
  } else if (assessment.audit.rejectionReason !== null) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.rejectionReason: solo aplica a TICKET_RECHAZADO; en los demás resultados debe ser null');
  }
  if (assessment.audit.result !== 'EVIDENCIA_INSUFICIENTE' && assessment.audit.result !== 'TICKET_RECHAZADO' && assessment.audit.supportingEvidenceIds.length === 0) {
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
  if (hasBlocking && assessment.audit.result !== 'EVIDENCIA_INSUFICIENTE' && assessment.audit.result !== 'TICKET_RECHAZADO') {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.missingEvidence: no puede haber bloqueo cuando el resultado no admite evidencia faltante (solo EVIDENCIA_INSUFICIENTE o TICKET_RECHAZADO)');
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
  validateTemporalCoherence(assessment, context);
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
 * Ruta del bloque temporal en los mensajes del validador.
 *
 * Vive ACÁ y no dentro de cada función porque la rechazan dos sitios con
 * propósito distinto: las reglas de coherencia y la conciliación. El prefijo
 * `INVALID_AI_RESPONSE:` es lo que `parseWithInvalidAiError` reconoce para
 * atestar el detalle, y el `sanitizeValidationDetail` de OpenRouter lo quita
 * antes de reenviarlo al modelo.
 */
const TEMPORAL_PATH = 'INVALID_AI_RESPONSE: temporalAnalysis';

/**
 * Normaliza la fecha aportada por el equipo a la única forma que puede
 * sustentar un dictamen: ISO `YYYY-MM-DD`, o `null` si no hay captura.
 *
 * Fail-closed: si el valor no cumple el formato, se rechaza con un mensaje
 * ESTÁTICO (nunca se copia el valor al error, para no filtrar contenido de la
 * fila). El endpoint ya lo rechaza antes de escribir; esto es la segunda vuelta
 * de la puerta, porque acá el valor es lo que legitima una `cycleStartDate`.
 */
function humanCycleStartDateOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!isIsoDateValue(value)) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: cases.cycle_start_date: la fecha aportada por el equipo debe estar en formato ISO YYYY-MM-DD');
  }
  return value;
}

/**
 * Concilia la fecha afirmada por el modelo con la capturada por el equipo.
 *
 * SOLO concilia cuando la fecha del modelo NO venía acreditada. Si venía con
 * evidencia, NO la sobrescribe: la rechaza. La razón es que conciliar deja un
 * dictamen que se desmiente a sí mismo — la fecha escrita pasa a ser la
 * capturada, pero `relationToCycleStart`, `audit.result`, `audit.rule` y el
 * razonamiento se dedujeron de la OTRA, y no hay forma de recalcularlos sin
 * reclasificar. El caso real: evidencia acreditando 28/09, captura del equipo en
 * 21/08 y una solicitud del 24/09: tras conciliar, la fecha decía 21/08 y la
 * relación seguía siendo ANTES_DEL_INICIO, cuando 24/09 es posterior. El
 * `console.warn` lo registraba en un canal que ya sabemos inservible; nadie iba
 * a leer un dictamen autocontradictorio.
 *
 * Dos fechas que dicen cosas distintas NO se resuelven en silencio: la
 * prevalencia es la que es y, ahora, el fallo es visible (categoría, ruta y
 * detalle en el diagnóstico) y el modelo tiene una segunda oportunidad con un
 * feedback correctivo que le dice cuál es la fecha del caso.
 *
 * Otros dos límites deliberados:
 *
 *  - Si el modelo dejó `cycleStartDate` en `null`, NO se hereda la captura: no
 *    afirmar la fecha es un dictamen legítimo (la captura no obliga al análisis).
 *  - Solo se corrigen los VALORES (la fecha del bloque temporal y la del fact
 *    `cycle_start_date`, que son la misma copia). No se tocan las citas ni los
 *    `evidenceIds` que el modelo emitió: borrarlos taparía el error del modelo en
 *    lugar de registrarlo, y esos ids siguen cotejándose contra las evidencias
 *    reales en `validateAssessmentReferences`.
 */
function reconcileHumanCycleStartDate(assessment: ValidatedAssessment, captured: string): void {
  const temporal = assessment.temporalAnalysis;
  const asserted = temporal.cycleStartDate;
  // La captura NO se hereda: si el modelo no afirmó fecha, no hay nada que conciliar.
  if (asserted === null || asserted === captured) return;

  if (temporal.cycleStartEvidenceIds.length > 0) {
    // Mensaje en ASCII y con puntuación del alfabeto atestiguado a propósito: es
    // lo que lee el modelo en el feedback del segundo intento
    // (`sanitizeValidationDetail` recorta a ASCII) y lo que queda persistido
    // como detalle en `provider_metadata`. Si lleva acentos, se mutila; si lleva
    // `;` o `,`, el observabilidad lo descarta por no parecer atestiguado.
    throw new ApiError(
      502,
      'INVALID_AI_RESPONSE',
      `${TEMPORAL_PATH}.cycleStartDate: el caso tiene fecha de inicio aportada por el equipo (${captured}). La respuesta acredita con evidencia una fecha distinta. Afirma ${captured} con cycleStartEvidenceIds vacio.`,
    );
  }

  const fact = assessment.facts.find((item) => item.key === CYCLE_START_FACT_KEY);
  const factValue = fact?.value ?? null;
  // El fact espeja la fecha de registro: sin él, la regla del fact de más abajo
  // se encarga de exigirlo (o de rechazarlo).
  if (factValue === captured) return;

  temporal.cycleStartDate = captured;
  if (fact) fact.value = captured;

  console.warn('[audit] cycleStartDate del modelo conciliada con la fecha aportada por el equipo', {
    // Ruta limpia, sin el prefijo `INVALID_AI_RESPONSE:` que llevan los mensajes:
    // este campo es una ruta de dato (como `failurePath` en los diagnósticos).
    path: 'temporalAnalysis.cycleStartDate',
    assertedByModel: asserted,
    assertedByFact: factValue,
    capturedByTeam: captured,
  });
}

/**
 * Coherencia del análisis temporal.
 *
 * NO reclasifica y NO calcula la relación: el modelo ya la emitió. Sólo rechaza
 * assessments que son internamente imposibles, que es exactamente donde se
 * escondía el defecto que motivó este bloque:
 *
 *  1. Una `cycleStartDate` afirmada sin evidencia ni cita textual no está
 *     acreditada: sería una fecha inventada. La ÚNICA excepción es que el caso
 *     tenga una fecha de inicio aportada por el equipo (`humanCycleStartDate`):
 *     esa captura sustituye a la evidencia como fuente, y entonces
 *     `cycleStartEvidenceIds` puede ir vacío siempre que la cita declare el
 *     origen humano.
 *  2. Una relación `DESPUES_DEL_INICIO` (o `ANTES_DEL_INICIO`) sin AMBAS fechas
 *     acreditadas no es una comparación: es una afirmación. Sin `cycleStartDate`
 *     no se puede afirmar que la solicitud fue posterior al inicio, que es
 *     justamente el razonamiento que convertía una baja en BAJA.
 *  3. Una fecha `null` con `evidenceIds` no vacíos referencia evidencia que no
 *     respalda nada.
 *  4. Una fecha de inicio acreditada DEBE tener su fact `cycle_start_date`, con
 *     el mismo valor y con confianza < 1: una fecha crítica declarada con
 *     certeza absoluta es, por definición, una fecha mal caracterizada. Con
 *     origen humano, ese fact se sigue exigiendo y sus `evidenceIds` pueden ir
 *     vacíos (misma vía nueva, mismo rastro).
 *  5. Si la relación es `NO_DETERMINABLE`, el dictamen no puede declararse con
 *     confianza máxima: la cronología crítica quedó sin acreditar.
 *
 * Existencia de la captura NO heredada: que `cases.cycle_start_date` tenga un
 * valor no obliga al assessment a afirmarla; si el modelo la descarta, se
 * persiste tal cual.
 *
 * `case.cycleStartDate` ya NO se comprueba aquí: no lo emite el modelo y lo deriva
 * el servidor (`deriveCaseCycleStartDate`) desde esta misma `temporalAnalysis`.
 * Era una comprobación post-hoc de la que dependía el dictamen entero y no la leía
 * nadie.
 */
function validateTemporalCoherence(assessment: ValidatedAssessment, context: AssessmentValidationContext): void {
  const temporal = assessment.temporalAnalysis;
  const path = TEMPORAL_PATH;
  const humanCycleStartDate = humanCycleStartDateOrNull(context.humanCycleStartDate);

  // Va ANTES de las comprobaciones: la conciliación cambia el valor que las
  // demás reglas comparan, y decide si la evidencia es exigible o no.
  if (humanCycleStartDate !== null) {
    reconcileHumanCycleStartDate(assessment, humanCycleStartDate);
  }

  if (temporal.cycleStartDate !== null) {
    if (temporal.cycleStartEvidenceIds.length === 0 && humanCycleStartDate === null) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `${path}.cycleStartDate: una fecha de inicio de ciclo afirmada exige cycleStartEvidenceIds; sin evidencia no está acreditada`);
    }
    if (temporal.cycleStartEvidenceText === null || temporal.cycleStartEvidenceText.trim() === '') {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `${path}.cycleStartEvidenceText: una fecha de inicio de ciclo afirmada exige la cita textual que la identifica como inicio académico o, si la aportó el equipo, la declaración de ese origen humano`);
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

  if (temporal.cycleStartDate !== null) {
    const fact = assessment.facts.find((item) => item.key === CYCLE_START_FACT_KEY);
    if (!fact) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `INVALID_AI_RESPONSE: facts: cycleStartDate afirmada exige el fact "${CYCLE_START_FACT_KEY}" con el mismo valor, su cita y su trazabilidad`);
    }
    if (fact.value !== temporal.cycleStartDate) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `INVALID_AI_RESPONSE: facts.${CYCLE_START_FACT_KEY}.value debe ser la fecha de inicio acreditada (${temporal.cycleStartDate})`);
    }
    if (fact.evidenceIds.length === 0 && humanCycleStartDate === null) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `INVALID_AI_RESPONSE: facts.${CYCLE_START_FACT_KEY}: exige evidenceIds y evidenceText que acrediten la fecha de inicio`);
    }
    if (fact.evidenceText === null || fact.evidenceText.trim() === '') {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `INVALID_AI_RESPONSE: facts.${CYCLE_START_FACT_KEY}: exige evidenceText con la cita que acredita la fecha de inicio o, si la aportó el equipo, la declaración de ese origen humano`);
    }
    if (fact.confidence >= 1) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `INVALID_AI_RESPONSE: facts.${CYCLE_START_FACT_KEY}.confidence: una fecha crítica usada para el dictamen no admite confianza 1`);
    }
  }

  if (temporal.relationToCycleStart === 'NO_DETERMINABLE' && assessment.audit.confidence >= 1) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.confidence: con relationToCycleStart NO_DETERMINABLE el dictamen no admite confianza 1; la cronología crítica no está acreditada');
  }
}

function parseWithInvalidAiError<T>(schema: z.ZodType<T>, raw: unknown, context: AssessmentValidationContext = {}): T {
  try {
    const parsed = schema.parse(raw);
    if (parsed && typeof parsed === 'object' && 'audit' in parsed) {
      validateBusinessRules(parsed as unknown as ValidatedAssessment, context);
    }
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      const wrapped = new ApiError(502, 'INVALID_AI_RESPONSE', `INVALID_AI_RESPONSE: ${details.join(' | ')}`);
      // Atestiguamiento: SÓLO códigos de issue. El `issue.message` de Zod puede
      // ecoar valores de la respuesta ("Unrecognized key(s) in object: '...'",
      // "received X"), así que nunca se copia a observabilidad.
      wrapped.sanitizedDetail = error.issues.slice(0, 3).map((issue) => issue.code).join(' | ');
      throw wrapped;
    }
    if (error instanceof ApiError) {
      // Atestiguamiento: los ApiError de este `try` salen EXCLUSIVAMENTE de
      // `validateBusinessRules` (sin transformaciones Zod en el medio), y sus
      // mensajes son texto estático escrito aquí: fijos, rutas e índices/números
      // derivados de la respuesta, jamás texto libre del modelo. Validadores
      // ajenos (p. ej. tests o `validateAssessmentReferences`) lanzan fuera de
      // este `try` y NO se atestiguan aquí: su `message` crudo jamás llega a
      // logs. Si necesitan dejar detalle, lo atestiguan ellos mismos en su
      // propio constructor — es lo que hace `invalidEvidenceReference` en
      // `execute.ts`, que es el ÚNICO sitio que sabe qué ruta y qué id fallaron.
      error.sanitizedDetail = error.message;
    }
    throw error;
  }
}
