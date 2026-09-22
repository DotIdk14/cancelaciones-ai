import { stableFingerprint } from '@cancelaciones/domain';

export type ConditionState = 'TRUE' | 'FALSE' | 'UNKNOWN' | 'NOT_APPLICABLE';
export type RuleStatus = 'SATISFIED' | 'NOT_SATISFIED' | 'UNKNOWN' | 'NOT_APPLICABLE' | 'BLOCKED_BY_MISSING_NORMATIVE_SOURCE';
export type RuleCategory = 'OUTCOME_RULE' | 'EXCLUSION_RULE' | 'PROCESS_RULE' | 'EVIDENCE_RULE' | 'SLA_RULE' | 'INFORMATIONAL_RULE';
export type MissingSeverity = 'NON_BLOCKING' | 'IMPORTANT' | 'BLOCKING';
export type OutcomeStatus = 'DETERMINED' | 'DETERMINED_WITH_WARNINGS' | 'CONFLICTED' | 'INDETERMINATE';
export type Outcome = 'CANCELACION_VENTA' | 'BAJA' | 'CANCELACION_VENTA_OPERATIVA' | 'CANCELACION_MATRICULA' | 'RETENCION' | 'NO_APLICA_CANCELACION_VENTA';

export interface PolicySource { documentCode: string; version: string; section: string; page: number; }
export interface Fact<T = unknown> {
  id: string; type: string; value: T; source?: EvidenceRef; extractionConfidence?: number;
}
export interface EvidenceRef {
  evidenceId: string; artifactId?: string; page?: number; timestampStart?: number; timestampEnd?: number; cell?: string; sha256?: string;
}
export interface ConditionTrace {
  id: string; description: string; state: ConditionState; factIds: string[]; evidenceRefs: EvidenceRef[]; missingFacts?: string[];
}
export interface EvaluatedRule {
  ruleId: string; category: RuleCategory; status: RuleStatus; source: PolicySource;
  conditions: ConditionTrace[]; factsUsed: string[]; evidenceRefs: EvidenceRef[];
  outcomeEffect?: Outcome; missingFacts: string[]; blockedBySource?: string;
}
export interface MissingData { factType: string; rulesAffected: string[]; whyNeeded: string; severity: MissingSeverity; }
export interface Conflict { ruleIds: string[]; outcomes: Outcome[]; reason: string; resolvedBy?: { type: 'EXPLICIT_POLICY' | 'OWNER_OPERATIONAL_PRECEDENCE'; citation?: PolicySource; precedenceId?: string; reason: string }; }
export interface OwnerPrecedence { id: string; rulesInvolved: string[]; resolution: Outcome; reason: string; approvedBy: string; approvedAt: string; version: string; active: boolean; }
export interface PolicyEvaluation {
  policyCode: string; policyVersion: string; rulesFingerprint: string; factsFingerprint: string;
  evaluatedRules: EvaluatedRule[]; satisfiedRules: string[]; unknownRules: string[]; notApplicableRules: string[];
  missingData: MissingData[]; conflicts: Conflict[]; suggestedOutcome: Outcome | null; outcomeStatus: OutcomeStatus;
  reviewRequired: boolean; decisiveRules: string[]; supportingRules: string[]; exclusions: string[];
  trace: { decision: string; ruleIds: string[]; factIds: string[]; evidenceRefs: EvidenceRef[] };
}
export type HistoricalOutcomeComparison = 'MATCH' | 'DIFFERENT' | 'HUMAN_OUTCOME_MISSING' | 'AI_INDETERMINATE' | 'AI_CONFLICTED' | 'NOT_COMPARABLE';
export type DiscrepancyClassification = 'EXTRACTION_ERROR' | 'RULE_ENGINE_ERROR' | 'MISSING_EVIDENCE' | 'HUMAN_REFERENCE_ERROR' | 'AMBIGUOUS_POLICY' | 'MISSING_NORMATIVE_SOURCE' | 'OWNER_PRECEDENCE_NEEDED' | 'POLICY_VERSION_MISMATCH' | 'EXPECTED_DIFFERENCE' | 'OTHER';
export interface NormativeShadowComparison {
  comparison: HistoricalOutcomeComparison;
  machineOutcome: Outcome | null;
  humanOutcome: string | null;
  policyVersion: string;
  classification?: DiscrepancyClassification;
}

export function compareHistoricalOutcome(input: {
  evaluation: PolicyEvaluation;
  humanOutcome?: string | null;
  humanPolicyVersion?: string | null;
}): NormativeShadowComparison {
  if (!input.humanOutcome) return { comparison: 'HUMAN_OUTCOME_MISSING', machineOutcome: input.evaluation.suggestedOutcome, humanOutcome: null, policyVersion: input.evaluation.policyVersion };
  if (input.humanPolicyVersion && input.humanPolicyVersion !== input.evaluation.policyVersion) {
    return { comparison: 'NOT_COMPARABLE', machineOutcome: input.evaluation.suggestedOutcome, humanOutcome: input.humanOutcome, policyVersion: input.evaluation.policyVersion, classification: 'POLICY_VERSION_MISMATCH' };
  }
  if (input.evaluation.outcomeStatus === 'CONFLICTED') return { comparison: 'AI_CONFLICTED', machineOutcome: null, humanOutcome: input.humanOutcome, policyVersion: input.evaluation.policyVersion };
  if (input.evaluation.outcomeStatus === 'INDETERMINATE') return { comparison: 'AI_INDETERMINATE', machineOutcome: null, humanOutcome: input.humanOutcome, policyVersion: input.evaluation.policyVersion };
  return {
    comparison: input.evaluation.suggestedOutcome === input.humanOutcome ? 'MATCH' : 'DIFFERENT',
    machineOutcome: input.evaluation.suggestedOutcome,
    humanOutcome: input.humanOutcome,
    policyVersion: input.evaluation.policyVersion,
  };
}

export interface ContactAttempt { id: string; kind: 'CALL' | 'WRITTEN'; occurredAt: string; successful?: boolean; evidenceRefs?: EvidenceRef[]; }
export interface ContactFacts {
  attempts?: ContactAttempt[]; callAttempts?: ContactAttempt[]; writtenInteractions?: ContactAttempt[];
  effectiveContact?: boolean; studentLevel?: 'LICENCIATURA' | 'POSGRADO' | string;
  classroomHasLogin?: boolean; classroomHasEvaluationMode?: boolean; classroomHasActivities?: boolean;
}
export interface PolicyFacts { contact?: ContactFacts; student?: { startDate?: string; level?: string }; [key: string]: unknown; }

const source = (version: string, section: string, page: number): PolicySource => ({ documentCode: 'GDM_GAM_PRD_MLG_003', version, section, page });
const refFor = (fact: Fact): EvidenceRef[] => fact.source ? [fact.source] : [];
function factByType(facts: Fact[], type: string): Fact | undefined { return facts.find((fact) => fact.type === type); }
function condition(id: string, description: string, state: ConditionState, facts: Fact[] = [], missingFacts: string[] = []): ConditionTrace {
  return { id, description, state, factIds: facts.map((fact) => fact.id), evidenceRefs: facts.flatMap(refFor), missingFacts };
}
const stateToRule = (states: ConditionState[]): RuleStatus => {
  if (states.includes('UNKNOWN')) return 'UNKNOWN';
  if (states.every((state) => state === 'NOT_APPLICABLE')) return 'NOT_APPLICABLE';
  return states.every((state) => state === 'TRUE') ? 'SATISFIED' : 'NOT_SATISFIED';
};

export function isBusinessDay(date: Date | string): boolean { const day = new Date(date).getUTCDay(); return day !== 0 && day !== 6; }
export function businessDaysBetween(start: Date | string, end: Date | string): number {
  const from = new Date(start); const to = new Date(end); if (from.getTime() === to.getTime()) return 0;
  const direction = from < to ? 1 : -1; let count = 0; const cursor = new Date(from);
  while ((direction > 0 && cursor < to) || (direction < 0 && cursor > to)) { cursor.setDate(cursor.getDate() + direction); if (isBusinessDay(cursor)) count += direction; }
  return count;
}

export function countValidCalls(attempts: ContactAttempt[]): number {
  return attempts.filter((a) => a.kind === 'CALL').length;
}
export function groupCalls(attempts: ContactAttempt[], gapHours = 6): ContactAttempt[][] {
  const calls = attempts.filter((a) => a.kind === 'CALL').slice().sort((a, b) => +new Date(a.occurredAt) - +new Date(b.occurredAt));
  const groups: ContactAttempt[][] = [];
  for (const call of calls) { const previous = groups.at(-1)?.at(-1); if (!previous || (+new Date(call.occurredAt) - +new Date(previous.occurredAt)) >= gapHours * 3600000) groups.push([call]); else groups.at(-1)?.push(call); }
  return groups;
}
export function calculateInteractionDistribution(attempts: ContactAttempt[]): { week1: number; week2: number; total: number } {
  const dates = attempts.filter((a) => a.kind === 'WRITTEN').map((a) => +new Date(a.occurredAt)); if (!dates.length) return { week1: 0, week2: 0, total: 0 };
  const first = Math.min(...dates); const week1 = dates.filter((d) => d - first < 7 * 86400000).length;
  return { week1, week2: dates.length - week1, total: dates.length };
}

function v5Rules(facts: Fact[]): EvaluatedRule[] {
  const calls = factByType(facts, 'contact.callAttempts'); const written = factByType(facts, 'contact.writtenInteractions');
  const callList = (calls?.value as ContactAttempt[] | undefined) ?? []; const writtenList = (written?.value as ContactAttempt[] | undefined) ?? [];
  const all = [calls, written].filter((f): f is Fact => Boolean(f));
  const count = condition('calls-count', 'Al menos 16 llamadas', calls ? (countValidCalls(callList) >= 16 ? 'TRUE' : 'FALSE') : 'UNKNOWN', calls ? [calls] : [], calls ? [] : ['contact.callAttempts']);
  const spacing = condition('calls-spacing', 'Llamadas con separacion minima de 6 horas', calls ? (groupCalls(callList).length >= 16 ? 'TRUE' : 'FALSE') : 'UNKNOWN', calls ? [calls] : [], calls ? [] : ['contact.callAttempts']);
  const writtenCount = condition('written-count', 'Al menos 6 interacciones escritas', written ? (writtenList.length >= 6 ? 'TRUE' : 'FALSE') : 'UNKNOWN', written ? [written] : [], written ? [] : ['contact.writtenInteractions']);
  const distribution = calculateInteractionDistribution(writtenList);
  const distributionState: ConditionState = written ? (distribution.total === 0 ? 'FALSE' : distribution.week1 / distribution.total >= .7 && distribution.week2 / distribution.total >= .3 ? 'TRUE' : 'UNKNOWN') : 'UNKNOWN';
  const distributionCondition = condition('written-distribution', 'Distribucion 70/30 entre semanas', distributionState, written ? [written] : [], written ? [] : ['contact.writtenInteractions']);
  const contactRule: EvaluatedRule = { ruleId: 'GDM-V5-5.2-A-CONTACT-ATTEMPTS', category: 'PROCESS_RULE', status: stateToRule([count.state, spacing.state, writtenCount.state, distributionCondition.state]), source: source('5', '5.2', 3), conditions: [count, spacing, writtenCount, distributionCondition], factsUsed: all.map((f) => f.id), evidenceRefs: all.flatMap(refFor), missingFacts: all.length === 2 ? [] : ['contact.callAttempts', 'contact.writtenInteractions'].filter((x) => !all.some((f) => f.type === x)) };
  const effective = factByType(facts, 'contact.effectiveContact');
  const level = factByType(facts, 'student.level');
  const noContact = condition('no-effective-contact', 'No existe contacto efectivo', effective ? (effective.value === false ? 'TRUE' : 'FALSE') : 'UNKNOWN', effective ? [effective] : [], effective ? [] : ['contact.effectiveContact']);
  const levelValue = typeof level?.value === 'string' ? level.value.toUpperCase() : undefined;
  const academicFacts = levelValue === 'LICENCIATURA'
    ? [factByType(facts, 'classroom.hasLogin'), factByType(facts, 'classroom.hasEvaluationMode')]
    : [factByType(facts, 'classroom.hasActivities')];
  const academicConditions: ConditionTrace[] = [
    condition('student-level', 'Nivel academico determina los criterios aplicables', level ? 'TRUE' : 'UNKNOWN', level ? [level] : [], level ? [] : ['student.level']),
  ];
  if (levelValue === 'LICENCIATURA') {
    const [login, evaluationMode] = academicFacts;
    academicConditions.push(
      condition('licenciatura-no-login', 'Licenciatura sin acceso al aula', login ? (login.value === false ? 'TRUE' : 'FALSE') : 'UNKNOWN', login ? [login] : [], login ? [] : ['classroom.hasLogin']),
      condition('licenciatura-no-evaluation-mode', 'Licenciatura sin modalidad seleccionada', evaluationMode ? (evaluationMode.value === false ? 'TRUE' : 'FALSE') : 'UNKNOWN', evaluationMode ? [evaluationMode] : [], evaluationMode ? [] : ['classroom.hasEvaluationMode']),
    );
  } else {
    const activities = academicFacts[0];
    academicConditions.push(
      condition('non-licenciatura-no-activity', 'Nivel distinto de licenciatura sin actividad academica', activities ? (activities.value === false ? 'TRUE' : 'FALSE') : 'UNKNOWN', activities ? [activities] : [], activities ? [] : ['classroom.hasActivities']),
    );
  }
  const unreachableConditions = [noContact, ...academicConditions];
  const levelRuleId = levelValue === 'LICENCIATURA' ? 'GDM-V5-5.8-A-LICENCIATURA' : 'GDM-V5-5.8-A-NON-LICENCIATURA';
  return [contactRule, { ruleId: levelRuleId, category: 'OUTCOME_RULE', status: stateToRule(unreachableConditions.map((c) => c.state)), source: source('5', '5.8.a', 9), conditions: unreachableConditions, factsUsed: unreachableConditions.flatMap((c) => c.factIds), evidenceRefs: unreachableConditions.flatMap((c) => c.evidenceRefs), outcomeEffect: 'CANCELACION_VENTA', missingFacts: unreachableConditions.flatMap((c) => c.missingFacts ?? []) }];
}
function v2Rules(facts: Fact[]): EvaluatedRule[] {
  const rules = v5Rules(facts);
  return rules.map((rule) => ({ ...rule, ruleId: rule.ruleId.replace('V5', 'V2'), source: { ...rule.source, version: '2' } }));
}
export const policySets: Record<string, Record<string, (facts: Fact[]) => EvaluatedRule[]>> = { GDM_GAM_PRD_MLG_003: { '2': v2Rules, '5': v5Rules } };

export function evaluatePolicy(input: { policyCode: string; policyVersion: string; facts: Fact[]; ownerPrecedences?: OwnerPrecedence[] }): PolicyEvaluation {
  if (!input.policyCode || !input.policyVersion) throw new Error('policyCode y policyVersion son obligatorios');
  const set = policySets[input.policyCode]?.[input.policyVersion]; if (!set) throw new Error(`Policy no soportada: ${input.policyCode} v${input.policyVersion}`);
  const evaluatedRules = set(input.facts);
  const outcomes = evaluatedRules.filter((r) => r.status === 'SATISFIED' && r.outcomeEffect).map((r) => r.outcomeEffect as Outcome);
  const conflicts: Conflict[] = []; const unique = [...new Set(outcomes)];
  if (unique.length > 1) conflicts.push({ ruleIds: evaluatedRules.filter((r) => r.outcomeEffect && r.status === 'SATISFIED').map((r) => r.ruleId), outcomes: unique, reason: 'Reglas de outcome satisfechas producen resultados incompatibles.' });
  const missingData: MissingData[] = [...new Set(evaluatedRules.flatMap((r) => r.missingFacts))].map((factType) => ({ factType, rulesAffected: evaluatedRules.filter((r) => r.missingFacts.includes(factType)).map((r) => r.ruleId), whyNeeded: 'Se requiere para evaluar una condicion normativa.', severity: evaluatedRules.some((r) => r.category === 'OUTCOME_RULE' && r.missingFacts.includes(factType)) ? 'BLOCKING' : 'IMPORTANT' }));
  const unknownRules = evaluatedRules.filter((r) => r.status === 'UNKNOWN' || r.status === 'BLOCKED_BY_MISSING_NORMATIVE_SOURCE');
  const satisfied = evaluatedRules.filter((r) => r.status === 'SATISFIED');
  const suggestedOutcome = conflicts.length ? null : (satisfied.find((r) => r.outcomeEffect)?.outcomeEffect ?? null);
  const status: OutcomeStatus = conflicts.length ? 'CONFLICTED' : suggestedOutcome ? (unknownRules.length ? 'DETERMINED_WITH_WARNINGS' : 'DETERMINED') : (unknownRules.length ? 'INDETERMINATE' : 'DETERMINED');
  const decisiveRules = satisfied.filter((r) => r.outcomeEffect).map((r) => r.ruleId);
  return { policyCode: input.policyCode, policyVersion: input.policyVersion, rulesFingerprint: stableFingerprint(evaluatedRules), factsFingerprint: stableFingerprint(input.facts), evaluatedRules, satisfiedRules: satisfied.map((r) => r.ruleId), unknownRules: unknownRules.map((r) => r.ruleId), notApplicableRules: evaluatedRules.filter((r) => r.status === 'NOT_APPLICABLE').map((r) => r.ruleId), missingData, conflicts, suggestedOutcome, outcomeStatus: status, reviewRequired: status !== 'DETERMINED', decisiveRules, supportingRules: satisfied.filter((r) => !r.outcomeEffect).map((r) => r.ruleId), exclusions: evaluatedRules.filter((r) => r.category === 'EXCLUSION_RULE').map((r) => r.ruleId), trace: { decision: suggestedOutcome ?? status, ruleIds: decisiveRules, factIds: decisiveRules.flatMap((id) => evaluatedRules.find((r) => r.ruleId === id)?.factsUsed ?? []), evidenceRefs: decisiveRules.flatMap((id) => evaluatedRules.find((r) => r.ruleId === id)?.evidenceRefs ?? []) } };
}
