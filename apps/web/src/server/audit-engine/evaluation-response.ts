/**
 * Contrato de respuesta de la evaluación de auditoría.
 *
 * ## Por qué este módulo existe aparte del motor
 *
 * `AuditEvaluation` modela la verdad del motor. Este módulo modela lo que cruza la
 * red, y la diferencia no es cosmética: en el cable un resultado provisional y
 * uno normativo se parecían demasiado. Un cliente que leyera
 * `result.outcome` sin mirar el estado convertiría «la lectura más compatible es
 * BAJA» en un dictamen.
 *
 * ## La defensa estructural
 *
 * La respuesta es una unión discriminada por `evaluationKind`, de modo que el
 * compilador impide construir el par imposible:
 *
 * - `NORMATIVE_DETERMINATE` — la fuente primaria cierra el caso. Lleva
 *   `normativeOutcome` y **no** puede llevar un provisional por separado.
 * - `PROVISIONAL_RANKED` — hay una resolución más respaldada, pero no normativa.
 *   Lleva `closestOutcome` y `normativeOutcome` es `null` por tipo.
 * - `PROVISIONAL_UNRESOLVED` — no hay desenlace preferible. No hay ganador.
 *
 * Un cliente no puede deserializar esta respuesta y quedarse con
 * `normativeOutcome: null` sintiéndolo como cierre, porque el tipo no admite esa
 * combinación.
 *
 * ## Por qué `isNormative` no es un campo libre
 *
 * Va como discriminante literal en cada variante, no como `boolean` que alguien
 * pueda poner a `true` por descuido.
 */
import type { AuditEvaluation, Outcome, PolicyConflict } from '@cancelaciones/rule-engine-v2';

/**
 * Naturaleza de la evaluación. Es el discriminante de la unión.
 *
 * `PROVISIONAL_IS_NOT_NORMATIVE`: los dos valores provisionales existen para que
 * el cliente pueda mostrarlos sin reinterpretarlos.
 */
export type AuditEvaluationKind =
  | 'NORMATIVE_DETERMINATE'
  | 'PROVISIONAL_RANKED'
  | 'PROVISIONAL_UNRESOLVED';

/** Bloque común a las tres variantes. */
interface AuditEvaluationBase {
  readonly policyVersion: string;
  readonly rulesFingerprint: string;
  /** Estado normativo crudo del motor. */
  readonly status: AuditEvaluation['normativeStatus'];
  /** Alternativas que el motor considera pero no elige. */
  readonly alternativeOutcomes: readonly Outcome[];
  /** Ambigüedades del Owner que impiden cerrar. */
  readonly pendingAmbiguityIds: readonly string[];
  /** Reglas de fuente auxiliar que proponen desenlace sin grounding primario. */
  readonly provisionalOnlyRuleIds: readonly string[];
  /** Conflictos normativos materializados. */
  readonly conflictIds: readonly string[];
  /** Hechos requeridos y ausentes. */
  readonly missingFactIds: readonly string[];
  /** Explicación legible del estado, no genérica. */
  readonly reason: string;
  /** Huella de la traza, para enlazar a la vista de decisión. */
  readonly traceFingerprint: string;
  /** Autoridad que puede fijar el desenlace. */
  readonly normativeSource: string;
}

/** La fuente primaria cerró el caso. */
export interface NormativeDeterminateEvaluation extends AuditEvaluationBase {
  readonly evaluationKind: 'NORMATIVE_DETERMINATE';
  readonly isNormative: true;
  /** Obligatorio por tipo: `DETERMINATE` sin outcome es imposible. */
  readonly normativeOutcome: Outcome;
  /**
   * Se incluye por simetría de la interfaz del motor, pero en esta variante
   * siempre coincide con `normativeOutcome`: no hay lectura provisional separada
   * que reportar.
   */
  readonly closestOutcome: Outcome;
  readonly requiresHumanReview: false;
}

/** Hay una resolución más respaldada y no es normativa. */
export interface ProvisionalRankedEvaluation extends AuditEvaluationBase {
  readonly evaluationKind: 'PROVISIONAL_RANKED';
  readonly isNormative: false;
  /** `null` por tipo, no por convención. */
  readonly normativeOutcome: null;
  /** La resolución que la app muestra como valor principal. */
  readonly closestOutcome: Outcome;
  readonly requiresHumanReview: true;
  /** Reglas que sostienen el candidato elegido. */
  readonly supportingRuleIds: readonly string[];
}

/** No hay desenlace preferible: la evidencia no ordena. */
export interface ProvisionalUnresolvedEvaluation extends AuditEvaluationBase {
  readonly evaluationKind: 'PROVISIONAL_UNRESOLVED';
  readonly isNormative: false;
  readonly normativeOutcome: null;
  readonly closestOutcome: null;
  readonly requiresHumanReview: true;
}

export type AuditEvaluationResponse =
  | NormativeDeterminateEvaluation
  | ProvisionalRankedEvaluation
  | ProvisionalUnresolvedEvaluation;

/**
 * Construye la respuesta de red a partir de la evaluación del motor.
 *
 * La clasificación se decide por el par `(status, closestOutcome)` y no por
 * `status` a secas, porque `REQUIRES_HUMAN_REVIEW` cubre dos realidades muy
 * distintas para el auditor: una donde hay un candidato claro y otra donde la
 * evidencia no ordena nada. Colapsarlas en una sola respuesta obligaría al
 * cliente a recomputar el ranking para distinguirlas.
 */
export function toAuditEvaluationResponse(evaluation: AuditEvaluation): AuditEvaluationResponse {
  const base: AuditEvaluationBase = {
    policyVersion: evaluation.policyVersion,
    rulesFingerprint: evaluation.rulesFingerprint,
    status: evaluation.normativeStatus,
    alternativeOutcomes: evaluation.alternativeOutcomes,
    pendingAmbiguityIds: pendingAmbiguityIds(evaluation),
    provisionalOnlyRuleIds: evaluation.provisionalOnly.map((rule) => rule.ruleId),
    conflictIds: evaluation.policyConflicts.map((conflict: PolicyConflict) => conflict.conflictId),
    missingFactIds: evaluation.missingFacts.map((requirement) => requirement.factId),
    reason: statusReason(evaluation),
    traceFingerprint: evaluation.trace.fingerprint,
    normativeSource: 'GDM_GAM_PRD_MLG_003',
  };

  // 1. La fuente primaria cerró el caso.
  if (evaluation.normativeStatus === 'DETERMINATE' && evaluation.normativeOutcome !== null) {
    return {
      ...base,
      evaluationKind: 'NORMATIVE_DETERMINATE',
      isNormative: true,
      normativeOutcome: evaluation.normativeOutcome,
      closestOutcome: evaluation.normativeOutcome,
      requiresHumanReview: false,
    };
  }

  // 2. Hay una resolución más respaldada, pero no normativa.
  if (evaluation.closestOutcome !== null) {
    const chosen = evaluation.candidateTrace.find(
      (candidate) => candidate.outcome === evaluation.closestOutcome,
    );
    return {
      ...base,
      evaluationKind: 'PROVISIONAL_RANKED',
      isNormative: false,
      normativeOutcome: null,
      closestOutcome: evaluation.closestOutcome,
      requiresHumanReview: true,
      supportingRuleIds: chosen?.supportingRuleIds ?? [],
    };
  }

  // 3. La evidencia no prefiere ningún desenlace. No se fuerza uno.
  return {
    ...base,
    evaluationKind: 'PROVISIONAL_UNRESOLVED',
    isNormative: false,
    normativeOutcome: null,
    closestOutcome: null,
    requiresHumanReview: true,
  };
}

/**
 * El motivo específico del estado, tomado de la traza.
 *
 * Se lee de la traza en vez de recomputarse porque la decisión de estado y su
 * explicación ya están vinculadas ahí: recalcular en el borde introduciría una
 * segunda fuente de verdad que podría divergir del motor.
 */
function statusReason(evaluation: AuditEvaluation): string {
  const paso = evaluation.trace.entries.find(
    (entry) => entry.kind === 'STATUS' && typeof entry.value === 'object' && entry.value !== null,
  );
  const reason = (paso?.value as { reason?: unknown } | undefined)?.reason;
  return typeof reason === 'string' && reason.length > 0 ? reason : 'Sin motivo registrado.';
}

function pendingAmbiguityIds(evaluation: AuditEvaluation): readonly string[] {
  return [
    ...new Set(evaluation.provisionalOnly.flatMap((rule) => rule.awaitsAmbiguityIds)),
  ].sort();
}
