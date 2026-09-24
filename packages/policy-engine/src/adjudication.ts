import type { Outcome, PolicyEvaluation, RuleStatus } from './index';

/** Reposición estructural mínima para no acoplar el adjudicador a las evaluaciones completas. */
export interface RuleViewLike {
  ruleId: string;
  category: string;
  status: string;
  outcomeEffect?: string | null;
  source?: { documentCode: string; version: string; section: string; page: number };
}

export interface EvidenceRefLike {
  evidenceId: string;
  artifactId?: string;
  page?: number;
  timestampStart?: number;
  timestampEnd?: number;
  sha256?: string;
}

/**
 * Decisión candidata producida por el Policy Reasoner (IA).
 *
 * La IA interpreta la evidencia y propone un resultado probable, pero NUNCA
 * inventa normativa: todo reference de regla debe existir en el catálogo formal
 * y será verificado por el Rule Engine validador.
 */
export interface CandidateDecision {
  probableOutcome: Outcome;
  /** SUPPORTED | PROBABLE | UNCERTAIN | INSUFFICIENT_EVIDENCE | CONFLICTED */
  outcomeStatus: AdjudicationStatus;
  ruleRefs: Array<{
    ruleId: string;
    section: string;
    justification: string;
  }>;
  evidenceRefs: EvidenceRefLike[];
  evidenceGaps: string[];
  conditionNotes: Array<{ factType: string; note: string; evidenceId?: string }>;
  explanation: string;
  /** Ruta de razonamiento estructurada (sin cadena de pensamiento privada). */
  reasoningTrace: Array<{ step: string; factType?: string; ruleId?: string; evidenceId?: string }>;
}

/**
 * Estados finales de la adjudicación híbrida.
 * Se mantienen los estados previos del motor (DETERMINED, …) por back-compat;
 * estos reemplazan al INDETERMINATE como terminal del flujo.
 */
export type AdjudicationStatus =
  | 'SUPPORTED'
  | 'PROBABLE'
  | 'UNCERTAIN'
  | 'INSUFFICIENT_EVIDENCE'
  | 'CONFLICTED'
  | 'POLICY_VALIDATION_FAILED';

export type ValidationVerdict = 'PASS' | 'PARTIAL' | 'FAIL';

export interface RuleValidationItem {
  ruleId: string;
  citedByCandidate: boolean;
  evaluatedStatus: RuleStatus | string;
  candidateCompatible: boolean;
  detail: string;
}

export interface PolicyValidation {
  verdict: ValidationVerdict;
  /** FAIL -> POLICY_VALIDATION_FAILED en la adjudicación. */
  failures: string[];
  warnings: string[];
  rules: RuleValidationItem[];
  validatedBy: { code: string; version: string; rulesFingerprint: string; factsFingerprint: string };
}

export interface ConfidenceModel {
  /** Confianza final 0..1 (redondeada a 2 decimales). */
  value: number;
  /** Ingredientes explicables del modelo (documentados). */
  rationale: string[];
  components: {
    ruleSupport: number;
    graphConsistency: number;
    sourceCoverage: number;
    factConfidence: number;
    evidenceCoverage: number;
  };
}

export interface AdjudicatedResult {
  probableOutcome: Outcome | null;
  status: AdjudicationStatus;
  confidence: ConfidenceModel;
  validation: PolicyValidation;
  evidenceGaps: string[];
  pendingValidations: string[];
  mandatoryHumanReview: true;
  graph: {
    factTypes: string[];
    conflicts: number;
    missingFacts: string[];
  };
  candidate: CandidateDecision;
  evaluatedRules: Array<{ ruleId: string; status: string; outcomeEffect?: string | null }>;
  trace: {
    decision: string;
    ruleIds: string[];
    evidenceRefs: EvidenceRefLike[];
  };
}

export interface GraphStatsInput {
  factTypes: string[];
  conflicts: number;
  missingFacts: string[];
  /** sourceCompleteness -> cantidad de hechos con esa completitud */
  completeness: Record<string, number>;
  factConfidenceAvg: number;
}

/* ------------------------------------------------------------------ */
/* Modelo de confianza explicable                                     */
/* ------------------------------------------------------------------ */

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Confianza explicable (0..1). Ningún componente decide la norma: solo acompaña
 * al RESULTADO PROBABLE. Fórmula documentada:
 *
 *   confianza = 0.35·ruleSupport
 *             + 0.25·graphConsistency
 *             + 0.20·sourceCoverage
 *             + 0.10·factConfidence
 *             + 0.10·evidenceCoverage
 *
 * con penalizaciones explícitas por contradicciones y por validación fallida.
 * - ruleSupport: proporción de reglas citadas por el candidato que el validador
 *   marca SATISFIED (compatibles con el outcome).
 * - graphConsistency: 1 - (conflicts / max(1, factTypes)).
 * - sourceCoverage: pesos COMPLETE=1, PARTIAL=0.5, UNKNOWN=0 sobre el total.
 * - factConfidence: promedio de confianza de extracción de los hechos decisivos.
 * - evidenceCoverage: 1 - (gaps declarados / hechos esperados del inventario).
 */
export function computeConfidence(input: {
  ruleSupportScore: number;
  graph: GraphStatsInput;
  evidenceGaps: string[];
  validationVerdict: ValidationVerdict;
  missingFacts: string[];
}): ConfidenceModel {
  const { ruleSupportScore, graph, evidenceGaps, validationVerdict, missingFacts } = input;
  const ruleSupport = clamp01(ruleSupportScore);
  const graphConsistency = graph.factTypes.length === 0 ? 0 : clamp01(1 - graph.conflicts / graph.factTypes.length);
  const totalCompleteness = Math.max(1, Object.values(graph.completeness).reduce((a, b) => a + b, 0));
  const sourceCoverage = clamp01(
    (graph.completeness.COMPLETE ?? 0) * 1
    + (graph.completeness.PARTIAL ?? 0) * 0.5
    + (graph.completeness.UNKNOWN ?? 0) * 0
  ) / totalCompleteness;
  const factConfidence = clamp01(graph.factConfidenceAvg);
  const expectedFacts = graph.factTypes.length + missingFacts.length;
  const evidenceCoverage = expectedFacts === 0 ? 0 : clamp01(1 - evidenceGaps.length / expectedFacts);

  let value = 0.35 * ruleSupport + 0.25 * graphConsistency + 0.20 * sourceCoverage + 0.10 * factConfidence + 0.10 * evidenceCoverage;
  const rationale: string[] = [
    `ruleSupport=${ruleSupport.toFixed(2)} (peso 0.35): reglas citadas satisfechas/validadas`,
    `graphConsistency=${graphConsistency.toFixed(2)} (peso 0.25): ${graph.conflicts} contradiccion(es) sobre ${graph.factTypes.length} tipos de hechos`,
    `sourceCoverage=${sourceCoverage.toFixed(2)} (peso 0.20): completitud de fuentes de contacto`,
    `factConfidence=${factConfidence.toFixed(2)} (peso 0.10): confianza media de extraccion de hechos decisivos`,
    `evidenceCoverage=${evidenceCoverage.toFixed(2)} (peso 0.10): cobertura de evidencia frente a gaps declarados`,
  ];

  if (graph.conflicts > 0) {
    value -= 0.08 * graph.conflicts;
    rationale.push(`penalizacion -${(0.08 * graph.conflicts).toFixed(2)} por contradicciones sin resolver`);
  }
  if (validationVerdict === 'FAIL') {
    value -= 0.3;
    rationale.push('penalizacion -0.30 por validacion de politica fallida');
  } else if (validationVerdict === 'PARTIAL') {
    value -= 0.12;
    rationale.push('penalizacion -0.12 por validacion parcial (reglas pendientes)');
  }

  return {
    value: Math.round(clamp01(value) * 100) / 100,
    rationale,
    components: { ruleSupport, graphConsistency, sourceCoverage, factConfidence, evidenceCoverage },
  };
}

/* ------------------------------------------------------------------ */
/* Validador (Rule Engine como protector)                              */
/* ------------------------------------------------------------------ */

function ruleOutcomeEffect(rule: { outcomeEffect?: unknown }): Outcome | null {
  return typeof rule.outcomeEffect === 'string' ? rule.outcomeEffect as Outcome : null;
}

/**
 * Valida la decisión candidata contra la evaluación formal del Rule Engine.
 *
 * Roles: el Rule Engine ya NO decide por sí solo; valida que la propuesta de la
 * IA pueda sustentarse en reglas reales del catálogo (POLICY_IS_IMMUTABLE):
 *  - reglas citadas inexistentes                  -> FAIL (la IA inventó normativa)
 *  - regla citada con efecto contrario al candidato -> FAIL (contradicción formal)
 *  - evaluación con outcome conocido y distinto    -> FAIL
 *  - candidato coherente pero con reglas UNKNOWN   -> PARTIAL (pendientes)
 *  - candidato coherente sin reglas pendientes     -> PASS
 */
export function validateCandidateDecision(input: {
  candidate: CandidateDecision;
  evaluation: { suggestedOutcome: Outcome | null; outcomeStatus: string; evaluatedRules: RuleViewLike[]; rulesFingerprint: string; factsFingerprint: string };
  knownRuleIds?: string[];
}): PolicyValidation {
  const { candidate, evaluation } = input;
  const rules: RuleValidationItem[] = [];
  const failures: string[] = [];
  const warnings: string[] = [];

  const known = new Set(input.knownRuleIds ?? []);
  const byId = new Map(evaluation.evaluatedRules.map((r) => [r.ruleId, r]));

  for (const ref of candidate.ruleRefs) {
    if (known.size > 0 && !known.has(ref.ruleId)) {
      failures.push(`Regla citada fuera del catalogo formal: ${ref.ruleId} (seccion ${ref.section}).`);
      rules.push({ ruleId: ref.ruleId, citedByCandidate: true, evaluatedStatus: 'UNKNOWN', candidateCompatible: false, detail: 'regla no existe en el catalogo formal' });
      continue;
    }
    const evaluated = byId.get(ref.ruleId);
    if (!evaluated) {
      failures.push(`Regla citada no fue evaluada por el Rule Engine: ${ref.ruleId}.`);
      rules.push({ ruleId: ref.ruleId, citedByCandidate: true, evaluatedStatus: 'UNKNOWN', candidateCompatible: false, detail: 'sin evaluacion formal disponible' });
      continue;
    }
    const effect = ruleOutcomeEffect(evaluated);
    if (effect && effect !== candidate.probableOutcome) {
      failures.push(`Regla ${ref.ruleId} resuelve ${effect}, no el outcome candidato ${candidate.probableOutcome}.`);
      rules.push({ ruleId: ref.ruleId, citedByCandidate: true, evaluatedStatus: evaluated.status, candidateCompatible: false, detail: `efecto formal ${effect} contradice al candidato` });
      continue;
    }
    if (evaluated.status === 'SATISFIED' || evaluated.status === 'NOT_SATISFIED') {
      rules.push({ ruleId: ref.ruleId, citedByCandidate: true, evaluatedStatus: evaluated.status, candidateCompatible: true, detail: `regla evaluada ${evaluated.status} compatible con ${candidate.probableOutcome}` });
      continue;
    }
    warnings.push(`Regla citada ${ref.ruleId} esta ${evaluated.status}: pendiente de evidencia o fuente.`);
    rules.push({ ruleId: ref.ruleId, citedByCandidate: true, evaluatedStatus: evaluated.status, candidateCompatible: true, detail: `regla ${evaluated.status}: pendiente` });
  }

  for (const rule of evaluation.evaluatedRules) {
    if (rules.some((r) => r.ruleId === rule.ruleId)) continue;
    const effect = ruleOutcomeEffect(rule);
    if (effect && rule.status === 'SATISFIED' && effect !== candidate.probableOutcome) {
      failures.push(`Regla formal satisfecha ${rule.ruleId} resuelve ${effect}, incompatible con ${candidate.probableOutcome}.`);
    }
    rules.push({ ruleId: rule.ruleId, citedByCandidate: false, evaluatedStatus: rule.status, candidateCompatible: !(effect && rule.status === 'SATISFIED' && effect !== candidate.probableOutcome), detail: `regla formal ${rule.status}` });
  }

  if (evaluation.suggestedOutcome && evaluation.suggestedOutcome !== candidate.probableOutcome) {
    failures.push(`El Rule Engine determina ${evaluation.suggestedOutcome}; el candidato propone ${candidate.probableOutcome}.`);
  }

  if (candidate.probableOutcome === null) {
    failures.push('El candidato no propone un outcome probable.');
  }

  const verdict: ValidationVerdict = failures.length > 0 ? 'FAIL' : warnings.length > 0 ? 'PARTIAL' : 'PASS';

  return {
    verdict,
    failures,
    warnings,
    rules,
    validatedBy: { code: 'GDM_GAM_PRD_MLG_003', version: '5', rulesFingerprint: evaluation.rulesFingerprint, factsFingerprint: evaluation.factsFingerprint },
  };
}

/* ------------------------------------------------------------------ */
/* Adjudicator                                                          */
/* ------------------------------------------------------------------ */

/**
 * Concilia el candidato de la IA con la validación del Rule Engine y produce el
 * RESULTADO PROBABLE final. Nunca se oculta tras INDETERMINATE: si no hay
 * sustento suficiente emite INSUFFICIENT_EVIDENCE con gaps explícitos.
 */
export function adjudicate(input: {
  candidate: CandidateDecision;
  validation: PolicyValidation;
  graph: GraphStatsInput;
  evaluation: Pick<PolicyEvaluation, 'evaluatedRules' | 'missingFacts'>;
}): AdjudicatedResult {
  const { candidate, validation, graph, evaluation } = input;

  const ruleSupportScore = validation.rules.filter((r) => r.citedByCandidate && r.candidateCompatible && r.evaluatedStatus === 'SATISFIED').length
    / Math.max(1, validation.rules.filter((r) => r.citedByCandidate).length);

  const confidence = computeConfidence({
    ruleSupportScore,
    graph,
    evidenceGaps: candidate.evidenceGaps,
    validationVerdict: validation.verdict,
    missingFacts: graph.missingFacts,
  });

  let status: AdjudicationStatus;
  if (validation.verdict === 'FAIL') status = 'POLICY_VALIDATION_FAILED';
  else if (candidate.outcomeStatus === 'CONFLICTED') status = 'CONFLICTED';
  else if (graph.missingFacts.length > 0 && validation.verdict === 'PARTIAL' && confidence.value < 0.5) status = 'INSUFFICIENT_EVIDENCE';
  else if (candidate.outcomeStatus === 'INSUFFICIENT_EVIDENCE') status = 'INSUFFICIENT_EVIDENCE';
  else if (validation.verdict === 'PARTIAL') status = 'PROBABLE';
  else if (candidate.outcomeStatus === 'UNCERTAIN') status = 'UNCERTAIN';
  else status = 'SUPPORTED';

  const pendingValidations = [
    ...validation.warnings,
    ...graph.missingFacts.map((fact) => `Acreditar ${fact} para validar reglas pendientes.`),
  ];

  const probableOutcome = status === 'POLICY_VALIDATION_FAILED' ? null : candidate.probableOutcome;

  return {
    probableOutcome,
    status,
    confidence,
    validation,
    evidenceGaps: candidate.evidenceGaps,
    pendingValidations,
    mandatoryHumanReview: true,
    graph: { factTypes: graph.factTypes, conflicts: graph.conflicts, missingFacts: graph.missingFacts },
    candidate,
    evaluatedRules: evaluation.evaluatedRules.map((r) => ({ ruleId: r.ruleId, status: r.status, outcomeEffect: r.outcomeEffect ?? null })),
    trace: {
      decision: probableOutcome ?? status,
      ruleIds: candidate.ruleRefs.map((r) => r.ruleId),
      evidenceRefs: candidate.evidenceRefs,
    },
  };
}

export function isAdjudicatedStatus(value: string): value is AdjudicationStatus {
  return value === 'SUPPORTED' || value === 'PROBABLE' || value === 'UNCERTAIN'
    || value === 'INSUFFICIENT_EVIDENCE' || value === 'CONFLICTED' || value === 'POLICY_VALIDATION_FAILED';
}

export const EXPECTED_OUTCOMES: readonly Outcome[] = [
  'CANCELACION_VENTA', 'BAJA', 'CANCELACION_VENTA_OPERATIVA', 'CANCELACION_MATRICULA', 'RETENCION', 'NO_APLICA_CANCELACION_VENTA',
];

/** Hechos esperados por el inventario de política (para medir cobertura de evidencia). */
export const POLICY_FACT_INVENTORY: readonly string[] = [
  'student.name', 'student.level', 'student.enrollment',
  'contact.effectiveContact', 'contact.callAttempts', 'contact.writtenInteractions',
  'classroom.hasLogin', 'classroom.hasEvaluationMode', 'classroom.hasActivities', 'classroom.hasGrades',
  'academic.lastCourseAccess', 'academic.platformAccessEvents',
];