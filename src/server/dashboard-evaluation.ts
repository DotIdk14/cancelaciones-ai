import type { EvaluationState, QualityCase, QualityEvaluation } from '../lib/dashboard-metrics-contracts.js';
import type { DashboardMetricRow } from './dashboard-contracts.js';

export interface EvaluationMetricRow extends DashboardMetricRow {
  case_review_id: string;
  external_case_id: string | null;
  review_audit_id: string | null;
  advisor_result: string | null;
  final_result: string | null;
  comparison_id: string | null;
  comparison_status: string | null;
  comparison_agrees: boolean | null;
  comparison_confidence: number | null;
  latest_execution_status: string;
}

export function validConfidence(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

export function evaluationCase(row: EvaluationMetricRow): QualityCase {
  const issued = row.audit_status === 'COMPLETED' && row.result !== null;
  const linked = row.review_audit_id === row.id;
  const finalResolution = linked ? row.final_result : null;
  const comparable = issued && finalResolution != null && row.comparison_status === 'COMPLETED' && typeof row.comparison_agrees === 'boolean';
  let state: EvaluationState;
  if (!issued) state = row.audit_status === 'ERROR' ? 'AUDIT_ERROR' : 'AUDIT_RUNNING';
  else if (!linked || !row.advisor_result) state = 'PENDING_ADVISOR';
  else if (!finalResolution) state = 'PENDING_COORDINATOR';
  else if (!row.comparison_id) state = 'PENDING_COMPARISON';
  else if (row.comparison_status === 'ERROR') state = 'COMPARISON_ERROR';
  else if (row.comparison_status === 'RUNNING') state = 'COMPARISON_RUNNING';
  else if (!comparable) state = 'INVALID_COMPARISON';
  else state = row.comparison_agrees ? 'AGREEMENT' : 'DISAGREEMENT';
  return {
    caseId: row.case_id, auditId: row.id, identifier: row.external_case_id ?? row.case_id.slice(0, 8),
    responsible: row.responsible, auditedAt: row.created_at, aiResolution: issued ? row.result : null,
    originalConfidence: issued ? validConfidence(row.confidence) : null,
    advisorResolution: linked ? row.advisor_result : null, finalResolution: finalResolution ?? null,
    comparisonId: linked && finalResolution ? row.comparison_id : null,
    comparisonConfidence: comparable ? validConfidence(row.comparison_confidence) : null,
    substantiveAgreement: comparable ? row.comparison_agrees : null,
    exactAgreement: issued && finalResolution != null ? row.result === finalResolution : null,
    latestExecutionStatus: row.latest_execution_status,
    state, country: row.country, campus: row.campus, guideline: row.guideline,
  };
}

/** KPI y detalle proceden del mismo array filtrado. No modifica confianza ni decisiones. */
export function aggregateEvaluation(rows: EvaluationMetricRow[], historicalVersions: number): QualityEvaluation {
  const details = rows.map(evaluationCase);
  const issued = details.filter(row => row.aiResolution !== null);
  const final = issued.filter(row => row.finalResolution !== null);
  const evaluated = issued.filter(row => row.substantiveAgreement !== null);
  const agreements = evaluated.filter(row => row.substantiveAgreement === true).length;
  return {
    issued: issued.length, finalized: final.length, validComparisons: evaluated.length,
    agreements, disagreements: evaluated.length - agreements,
    pendingEvaluation: issued.filter(row => row.finalResolution === null).length,
    failedComparisons: details.filter(row => row.state === 'COMPARISON_ERROR').length,
    technicalErrors: rows.filter(row => row.latest_execution_status === 'ERROR').length,
    runningAudits: rows.filter(row => row.latest_execution_status === 'RUNNING').length,
    withoutConfidence: issued.filter(row => row.originalConfidence === null).length,
    agreementRate: evaluated.length ? agreements / evaluated.length : null,
    coverageRate: issued.length ? evaluated.length / issued.length : null,
    exactAgreements: final.filter(row => row.exactAgreement).length, exactComparisons: final.length,
    rows: details, historicalVersions,
    calibration: [
      { band: '0–49 %', min: 0, max: 0.5 }, { band: '50–69 %', min: 0.5, max: 0.7 },
      { band: '70–89 %', min: 0.7, max: 0.9 }, { band: '90–100 %', min: 0.9, max: 1.01 },
    ].map(({ band, min, max }) => {
      const cases = issued.filter(row => row.originalConfidence !== null && row.originalConfidence >= min && row.originalConfidence < max);
      const sample = cases.filter(row => row.substantiveAgreement !== null);
      const agreed = sample.filter(row => row.substantiveAgreement).length;
      const declaredConfidence = sample.length ? sample.reduce((sum, row) => sum + row.originalConfidence!, 0) / sample.length : null;
      const observedAgreement = sample.length ? agreed / sample.length : null;
      return { band, cases: cases.length, evaluated: sample.length, agreements: agreed, disagreements: sample.length - agreed,
        declaredConfidence, observedAgreement, gap: declaredConfidence === null || observedAgreement === null ? null : declaredConfidence - observedAgreement };
    }),
  };
}
