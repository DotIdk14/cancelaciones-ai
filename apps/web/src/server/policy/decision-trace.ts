import type { DatabaseClient } from '@cancelaciones/db';
import type { PolicyEvaluation, EvaluatedRule, ConditionTrace, RuleStatus, Outcome, OutcomeStatus, DecisionStatus } from '@cancelaciones/policy-engine';

/**
 * ============================================================================
 * AUDIT DECISION TRACE V1
 * ============================================================================
 *
 * QUÉ ES
 * Una proyección de lo que YA OCURRIÓ. Une lo que el motor normativo decidió
 * con los hechos sellados que usó, y lo devuelve en una forma que permita
 * responder "¿por qué decidió esto?" sin leer código.
 *
 * QUÉ NO ES — y esta es la restricción que manda sobre todo lo demás
 *
 *     TRACE != POLICY ENGINE
 *
 * Este módulo NO importa `evaluatePolicy`. No lo llama, ni en pruebas, ni por
 * error, ni "para comprobar". Si lo hiciera, el trace dejaría de ser un
 * registro y pasaría a ser una segunda evaluación que además puede discrepar de
 * la original. Un trace que recalcula es peor que no tener trace: da una
 * respuesta con apariencia de evidencia que en realidad es una segunda opinión.
 *
 * Consecuencia práctica: todo lo que sale de aquí viene de una fila ya
 * persistida (`engine_runs`, `engine_rule_results`, `fact_run_frozen_snapshots`,
 * `audit_evaluation_envelopes`, `audit_runs`). Si un dato no está persistido,
 * NO se estima: se devuelve `null` o `[]` y el documento lo dice. Ver §15 de la
 * especificación: es preferible un hueco declarado a una relación inventada.
 *
 * POR QUÉ NO HAY TABLA NUEVA
 * La información que hace falta YA está persistida y es durable. `engine_runs`
 * guarda el `evaluation` completo en jsonb; `engine_rule_results` guarda el
 * resultado por regla; `fact_run_frozen_snapshots` guarda los hechos sellados y
 * su procedencia. Añadir una tabla sería una segunda copia de la verdad que
 * puede divergir de la primera, que es exactamente el fallo que la fase
 * Foundation vino a cerrar.
 *
 * PII
 * Este documento contiene valores de hechos, que pueden incluir nombre, correo o
 * teléfono de una persona. Eso es lo que el trace es. Por eso NUNCA se escribe
 * en logs: sale por HTTP, con la autorización de la auditoría, y se descarga de
 * forma explícita. Ver `operational-log.ts`.
 */

/** Razón técnica, NO normativa. Clasifica dónde está el problema, no qué debe decidirse. */
export type DecisionTraceDiagnosticCode =
  | 'EVIDENCE_EXTRACTION_GAP'
  | 'FACT_NORMALIZATION_GAP'
  | 'MISSING_EVIDENCE'
  | 'MISSING_FACT'
  | 'CONTRADICTORY_EVIDENCE'
  | 'POLICY_COVERAGE_GAP'
  | 'MISSING_NORMATIVE_SOURCE'
  | 'RULE_EVALUATION_PATH'
  | 'OUTCOME_AGGREGATION'
  | 'SYSTEM_ERROR'
  | 'PERSISTENCE_ERROR';

export interface DecisionTraceDiagnostic {
  code: DecisionTraceDiagnosticCode;
  /** Cuántos elementos persistidos motivan el código. */
  occurrences: number;
  /** Referencias realestaken del registro, nunca inventadas. */
  refs: string[];
  detail: string;
}

export interface DecisionTraceFactUsage {
  ruleId: string;
  conditionId: string;
  /** El estado que el motor YA persistió para esa condición. */
  conditionState: ConditionTrace['state'];
  observedValue: string | null;
}

export interface DecisionTraceFact {
  id: string;
  type: string;
  value: unknown;
  source: unknown;
  extractionConfidence: number | null;
  /** Condiciones que consumieron este hecho, con el estado quepersistieron. */
  usedBy: DecisionTraceFactUsage[];
  /** `true` si el hecho está en `missingFacts` de la evaluación persistida. */
  reportedMissing: boolean;
}

export interface DecisionTraceCondition {
  id: string;
  description: string;
  state: ConditionTrace['state'];
  factIds: string[];
  evidenceRefs: unknown[];
  missingFacts: string[];
  observedValue: string | null;
}

export interface DecisionTraceRule {
  ruleId: string;
  category: string | null;
  status: RuleStatus;
  source: { documentCode?: string; version?: string; section?: string; page?: number | string } | null;
  conditions: DecisionTraceCondition[];
  factsUsed: string[];
  missingFacts: string[];
  evidenceRefs: unknown[];
  outcomeEffect: string | null;
  /** `true` si esta regla aparece en `decisiveRules`. */
  decisive: boolean;
  /** Estado según la fila persistida en `engine_rule_results`, si existe. */
  persistedStatus: string | null;
}

export interface DecisionTraceComparison {
  /** La decisión humana NUNCA entra en la decisión de máquina. Esto va aparte, y sólo como comparación. */
  humanOutcome: string | null;
  humanPolicyVersion: string | null;
  /** Coincidencia declarada por el propio motor (`compareHistoricalOutcome`). Nunca se recalcula aquí. */
  comparison: string | null;
  classification: string | null;
  note: string;
}

export interface AuditDecisionTraceV1 {
  schemaVersion: 'audit-decision-trace-v1';
  /** El trace es un REGISTRO. No autoriza nada y noSuggesta nada. */
  readonly: true;
  audit: { auditId: string; externalCaseId: string | null; displayName: string | null };
  execution: {
    engineRunId: string;
    factRunId: string | null;
    createdAt: string | null;
    status: string;
    policyCode: string;
    policyVersion: string;
    policySourceId: string | null;
    extractorVersion: string | null;
    factsFingerprint: string | null;
    rulesFingerprint: string | null;
    /** `null` cuando no está persistido. No se infiere desde el rulesFingerprint. */
    engineVersion: string | null;
  };
  /** Otras corridas de la misma auditoría. Nunca se ocultan (§30). */
  availableRuns: Array<{ engineRunId: string; createdAt: string | null; policyVersion: string; rulesFingerprint: string | null; outcomeStatus: string; suggestedOutcome: string | null; isSelected: boolean }>;
  facts: DecisionTraceFact[];
  rules: DecisionTraceRule[];
  aggregation: {
    suggestedOutcome: Outcome | null;
    outcomeStatus: OutcomeStatus;
    decisionStatus: DecisionStatus;
    reviewRequired: boolean;
    decisiveRules: string[];
    supportingRules: string[];
    opposingRules: string[];
    pendingRules: string[];
    conflictingRules: string[];
    blockedRules: string[];
    exclusions: string[];
    satisfiedRules: string[];
    unknownRules: string[];
    notApplicableRules: string[];
  };
  evidence: {
    evidenceRefs: unknown[];
    missingEvidence: string[];
    conflicts: unknown[];
  };
  coverage: { softwareCoverageGaps: string[]; missingNormativeSources: string[] };
  review: { required: boolean; missingFacts: string[]; missingData: unknown[]; nextActions: unknown[]; reason: string | null };
  /** Diagnóstico TÉCNICO. No es una valoración normativa de la política. */
  diagnostics: DecisionTraceDiagnostic[];
  /** Envoltura durable si existe. `null` si la ejecución no la tiene. */
  envelope: { schemaVersion: string; envelopeHash: string; createdAt: string | null } | null;
  comparison: DecisionTraceComparison;
  /** Verbatim del motor. Es la evidencia primaria; el resto es proyección. */
  evaluationVerbatim: unknown;
}

const EMPTY_COMPARISON: DecisionTraceComparison = {
  humanOutcome: null,
  humanPolicyVersion: null,
  comparison: null,
  classification: null,
  note: 'No hay decisión humana registrada para esta ejecución. La sección existe para que se vea que NO la hay.',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Proyecta un hecho sellado. `UNKNOWN` no se materializa aquí: el estado de una
 * condición lo persistió el motor y se lee de las condiciones, no se recalcula
 * desde el valor del hecho. Un `value` ausente o `null` se reporta tal cual.
 */
function projectFact(entry: unknown, usageById: Map<string, DecisionTraceFactUsage[]>, missingFacts: Set<string>): DecisionTraceFact | null {
  const record = asRecord(entry);
  if (!record) return null;
  const id = asString(record.id);
  const type = asString(record.type);
  if (!id || !type) return null;
  return {
    id,
    type,
    value: 'value' in record ? record.value : null,
    source: 'source' in record ? record.source : null,
    extractionConfidence: asNumberOrNull(record.extractionConfidence),
    usedBy: usageById.get(id) ?? [],
    reportedMissing: missingFacts.has(type),
  };
}

/**
 * Une cada hecho con las condiciones que lo consumieron. Es una CRUCIA entre dos
 * cosas ya persistidas (`snapshot.facts` y `evaluation.evaluatedRules`), no un
 * cálculo: sólo se emparejan ids que las dos fuentes mencionan.
 */
function indexUsage(rules: EvaluatedRule[]): Map<string, DecisionTraceFactUsage[]> {
  const index = new Map<string, DecisionTraceFactUsage[]>();
  for (const rule of rules) {
    for (const condition of rule.conditions ?? []) {
      for (const factId of condition.factIds ?? []) {
        const list = index.get(factId) ?? [];
        list.push({
          ruleId: rule.ruleId,
          conditionId: condition.id,
          conditionState: condition.state,
          observedValue: condition.observedValue ?? null,
        });
        index.set(factId, list);
      }
    }
  }
  return index;
}

function projectRule(rule: EvaluatedRule, persisted: Map<string, string>, decisive: Set<string>): DecisionTraceRule {
  return {
    ruleId: rule.ruleId,
    category: rule.category ?? null,
    status: rule.status,
    source: rule.source ?? null,
    conditions: (rule.conditions ?? []).map((condition) => ({
      id: condition.id,
      description: condition.description,
      state: condition.state,
      factIds: asStringArray(condition.factIds),
      evidenceRefs: Array.isArray(condition.evidenceRefs) ? condition.evidenceRefs : [],
      missingFacts: asStringArray(condition.missingFacts),
      observedValue: condition.observedValue ?? null,
    })),
    factsUsed: asStringArray(rule.factsUsed),
    missingFacts: asStringArray(rule.missingFacts),
    evidenceRefs: Array.isArray(rule.evidenceRefs) ? rule.evidenceRefs : [],
    outcomeEffect: rule.outcomeEffect ?? null,
    decisive: decisive.has(rule.ruleId),
    persistedStatus: persisted.get(rule.ruleId) ?? null,
  };
}

/**
 * Diagnóstico técnico derivado SOLO de campos persistidos. Cada código se
 * dispara por una condición observable en el registro, nunca por una
 * interpretación de si la política debería decir otra cosa.
 */
function diagnose(input: {
  evaluation: PolicyEvaluation;
  runStatus: string;
  envelopePresent: boolean;
  factsWithNoType: number;
}): DecisionTraceDiagnostic[] {
  const e = input.evaluation;
  const out: DecisionTraceDiagnostic[] = [];
  const push = (code: DecisionTraceDiagnosticCode, occurrences: number, refs: string[], detail: string) => {
    if (occurrences > 0) out.push({ code, occurrences, refs: refs.slice(0, 50), detail });
  };

  if (input.runStatus === 'FAILED') {
    push('SYSTEM_ERROR', 1, [], `La corrida del motor quedó en estado ${input.runStatus}.`);
  }
  if (input.runStatus === 'COMPLETED' && !input.envelopePresent) {
    push('PERSISTENCE_ERROR', 1, [], 'La corrida está COMPLETED pero no hay envelope de evaluación persistido.');
  }
  if (e.factsFingerprint === 'null' || e.factsFingerprint === '' || e.factsFingerprint == null) {
    push('FACT_NORMALIZATION_GAP', 1, [], 'La evaluación persistida no tiene factsFingerprint utilizable.');
  }
  push('MISSING_EVIDENCE', asStringArray(e.missingEvidence).length, asStringArray(e.missingEvidence), 'Hechos de evidencia que el motor marcó como ausentes.');
  push('MISSING_FACT', asStringArray(e.missingFacts).length, asStringArray(e.missingFacts), 'Tipos de hecho que el motor no pudo resolver.');
  push('CONTRADICTORY_EVIDENCE', Array.isArray(e.conflicts) ? e.conflicts.length : 0, asStringArray(e.decisiveRules), 'Conflictos entre reglas registrados por el motor.');
  push('POLICY_COVERAGE_GAP', asStringArray(e.softwareCoverageGaps).length, asStringArray(e.softwareCoverageGaps), 'Secciones normative que el software todavía no formaliza.');
  push('MISSING_NORMATIVE_SOURCE', asStringArray(e.missingNormativeSources).length, asStringArray(e.missingNormativeSources), 'Fuentes normativas que faltan para evaluar alguna regla.');
  push('RULE_EVALUATION_PATH', asStringArray(e.unknownRules).length, asStringArray(e.unknownRules), 'Reglas que el motor no pudo resolver ni a SATISFIED ni a NOT_SATISFIED.');
  const aggregationCodes = new Set<DecisionTraceDiagnosticCode>();
  if (e.outcomeStatus === 'CONFLICTED' || e.decisionStatus === 'CONFLICTED') aggregationCodes.add('OUTCOME_AGGREGATION');
  if (aggregationCodes.size > 0) {
    push('OUTCOME_AGGREGATION', 1, asStringArray(e.conflictingRules), `outcomeStatus=${e.outcomeStatus}, decisionStatus=${e.decisionStatus}.`);
  }
  if (input.factsWithNoType > 0) {
    push('FACT_NORMALIZATION_GAP', input.factsWithNoType, [], 'Hechos sellados sin `type`, que el motor no puede proyectar.');
  }
  return out;
}

export interface BuildDecisionTraceInput {
  database: DatabaseClient;
  auditId: string;
  /** Si se omite, se selecciona la más reciente y se declara cuál fue. */
  engineRunId?: string | null;
}

/**
 * Construye el trace. Determinista: mismas filas persistidas, mismo trace.
 * Sin efectos secundarios, sin escrituras, sin llamadas al motor.
 */
export async function buildDecisionTrace(input: BuildDecisionTraceInput): Promise<AuditDecisionTraceV1 | null> {
  const { database, auditId } = input;

  const runsResult = await database
    .from('engine_runs')
    .select('id,audit_id,fact_run_id,created_at,status,policy_code,policy_version,facts_fingerprint,rules_fingerprint,suggested_outcome,outcome_status,evaluation,owner_precedence_version')
    .eq('audit_id', auditId)
    .order('created_at', { ascending: false });
  if (runsResult.error) throw new Error(`DECISION_TRACE_RUNS_READ_FAILED: ${runsResult.error.message ?? 'error desconocido'}`);

  const runs = (runsResult.data ?? []) as Array<Record<string, unknown>>;
  if (runs.length === 0) return null;

  const selected = input.engineRunId ? runs.find((run) => run.id === input.engineRunId) : runs[0];
  if (!selected) return null;

  const evaluation = asRecord(selected.evaluation) as PolicyEvaluation | null;
  if (!evaluation || !Array.isArray(evaluation.evaluatedRules)) return null;

  // Resultados por regla ya persistidos: el estado de verdad de cada regla.
  const ruleResults = await database.from('engine_rule_results').select('rule_id,status').eq('engine_run_id', selected.id);
  if (ruleResults.error) throw new Error(`DECISION_TRACE_RULE_RESULTS_READ_FAILED: ${ruleResults.error.message ?? 'error desconocido'}`);
  const persistedStatuses = new Map<string, string>();
  for (const row of ruleResults.data ?? []) {
    const ruleId = asString((row as { rule_id?: unknown }).rule_id);
    const status = asString((row as { status?: unknown }).status);
    if (ruleId && status) persistedStatuses.set(ruleId, status);
  }

  // Hechos sellados + procedencia del Fact Run.
  type SnapshotRow = { facts?: unknown; extractor_version?: unknown; policy_source_id?: unknown; provenance?: unknown };
  let snapshot: SnapshotRow | null = null;
  if (selected.fact_run_id) {
    const snapshotResult = await database
      .from('fact_run_frozen_snapshots')
      .select('facts,extractor_version,policy_source_id,provenance')
      .eq('fact_run_id', selected.fact_run_id)
      .limit(1);
    if (snapshotResult.error) throw new Error(`DECISION_TRACE_SNAPSHOT_READ_FAILED: ${snapshotResult.error.message ?? 'error desconocido'}`);
    snapshot = ((snapshotResult.data ?? [])[0] as SnapshotRow | undefined) ?? null;
  }

  const envelopeResult = await database
    .from('audit_evaluation_envelopes')
    .select('schema_version,envelope_hash,created_at')
    .eq('engine_run_id', selected.id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (envelopeResult.error) throw new Error(`DECISION_TRACE_ENVELOPE_READ_FAILED: ${envelopeResult.message ?? 'error desconocido'}`);
  const envelopeRow = (envelopeResult.data ?? [])[0] as { schema_version?: unknown; envelope_hash?: unknown; created_at?: unknown } | undefined;

  // Decisión humana: sección SEPARADA. Entra en `comparison` y en ningún otro sitio.
  const humanResult = await database
    .from('audit_runs')
    .select('id,run_type,status,result,policy_version,created_at')
    .eq('audit_id', auditId)
    .in('run_type', ['HUMAN_DECISION', 'HUMAN_DECISION_EXTRACT'])
    .order('created_at', { ascending: false })
    .limit(1);
  if (humanResult.error) throw new Error(`DECISION_TRACE_HUMAN_READ_FAILED: ${humanResult.error.message ?? 'error desconocido'}`);
  const humanRow = asRecord((humanResult.data ?? [])[0]);

  const missingFacts = new Set(asStringArray(evaluation.missingFacts));
  const usage = indexUsage(evaluation.evaluatedRules);
  const snapshotFacts = Array.isArray(snapshot?.facts) ? snapshot!.facts : [];
  const facts = snapshotFacts.map((entry) => projectFact(entry, usage, missingFacts)).filter((entry): entry is DecisionTraceFact => entry !== null);
  const factsWithNoType = snapshotFacts.length - facts.length;

  const decisive = new Set(asStringArray(evaluation.decisiveRules));
  const rules = evaluation.evaluatedRules.map((rule) => projectRule(rule, persistedStatuses, decisive));

  const auditRow = await database.from('audits').select('external_case_id,display_name').eq('id', auditId).limit(1);
  const auditMeta = asRecord((auditRow.data ?? [])[0]);

  return {
    schemaVersion: 'audit-decision-trace-v1',
    readonly: true,
    audit: {
      auditId,
      externalCaseId: asString((auditMeta as { external_case_id?: unknown } | null)?.external_case_id),
      displayName: asString((auditMeta as { display_name?: unknown } | null)?.display_name),
    },
    execution: {
      engineRunId: String(selected.id),
      factRunId: selected.fact_run_id ? String(selected.fact_run_id) : null,
      createdAt: asString(selected.created_at),
      status: String(selected.status ?? 'UNKNOWN'),
      policyCode: String(evaluation.policyCode ?? selected.policy_code ?? 'UNKNOWN'),
      policyVersion: String(evaluation.policyVersion ?? selected.policy_version ?? 'UNKNOWN'),
      policySourceId: asString(snapshot?.policy_source_id),
      extractorVersion: asString(snapshot?.extractor_version),      factsFingerprint: asString(selected.facts_fingerprint) ?? asString(evaluation.factsFingerprint),
      rulesFingerprint: asString(selected.rules_fingerprint) ?? asString(evaluation.rulesFingerprint),
      engineVersion: null,
    },
    availableRuns: runs.map((run) => {
      const record = run as Record<string, unknown>;
      return {
        engineRunId: String(record.id),
        createdAt: asString(record.created_at),
        policyVersion: String(record.policy_version ?? 'UNKNOWN'),
        rulesFingerprint: asString(record.rules_fingerprint),
        outcomeStatus: String(record.outcome_status ?? 'UNKNOWN'),
        suggestedOutcome: asString(record.suggested_outcome),
        isSelected: String(record.id) === String(selected.id),
      };
    }),
    facts,
    rules,
    aggregation: {
      suggestedOutcome: (evaluation.suggestedOutcome as Outcome | null) ?? null,
      outcomeStatus: evaluation.outcomeStatus,
      decisionStatus: evaluation.decisionStatus,
      reviewRequired: evaluation.reviewRequired === true,
      decisiveRules: asStringArray(evaluation.decisiveRules),
      supportingRules: asStringArray(evaluation.supportingRules),
      opposingRules: asStringArray(evaluation.opposingRules),
      pendingRules: asStringArray(evaluation.pendingRules),
      conflictingRules: asStringArray(evaluation.conflictingRules),
      blockedRules: asStringArray(evaluation.blockedRules),
      exclusions: asStringArray(evaluation.exclusions),
      satisfiedRules: asStringArray(evaluation.satisfiedRules),
      unknownRules: asStringArray(evaluation.unknownRules),
      notApplicableRules: asStringArray(evaluation.notApplicableRules),
    },
    evidence: {
      evidenceRefs: Array.isArray(evaluation.trace?.evidenceRefs) ? evaluation.trace.evidenceRefs : [],
      missingEvidence: asStringArray(evaluation.missingEvidence),
      conflicts: Array.isArray(evaluation.conflicts) ? evaluation.conflicts : [],
    },
    coverage: {
      softwareCoverageGaps: asStringArray(evaluation.softwareCoverageGaps),
      missingNormativeSources: asStringArray(evaluation.missingNormativeSources),
    },
    review: {
      required: evaluation.reviewRequired === true,
      missingFacts: asStringArray(evaluation.missingFacts),
      missingData: Array.isArray(evaluation.missingData) ? evaluation.missingData : [],
      nextActions: Array.isArray(evaluation.nextActions) ? evaluation.nextActions : [],
      reason: asString(evaluation.suggestedReason),
    },
    diagnostics: diagnose({ evaluation, runStatus: String(selected.status ?? 'UNKNOWN'), envelopePresent: Boolean(envelopeRow), factsWithNoType }),
    envelope: envelopeRow
      ? { schemaVersion: String(envelopeRow.schema_version ?? 'UNKNOWN'), envelopeHash: String(envelopeRow.envelope_hash ?? ''), createdAt: asString(envelopeRow.created_at) }
      : null,
    comparison: humanRow
      ? {
          humanOutcome: asString(asRecord(humanRow.result)?.outcome) ?? asString(asRecord(humanRow.result)?.suggestedOutcome),
          humanPolicyVersion: asString(humanRow.policy_version),
          comparison: null,
          classification: null,
          note: 'Registrado aparte y NUNCA incorporado a la decisión de máquina. La comparación la publica el motor, no este read model.',
        }
      : EMPTY_COMPARISON,
    evaluationVerbatim: evaluation,
  };
}
