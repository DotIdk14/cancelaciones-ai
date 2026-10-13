/** Métricas técnicas y de evaluación; no contienen criterio normativo. */
export type EvaluationState = 'AGREEMENT' | 'DISAGREEMENT' | 'PENDING_ADVISOR' | 'PENDING_COORDINATOR' | 'PENDING_COMPARISON' | 'COMPARISON_RUNNING' | 'COMPARISON_ERROR' | 'AUDIT_ERROR' | 'AUDIT_RUNNING' | 'INVALID_COMPARISON';

export interface ActivityMetrics {
  executions: number;
  completed: number;
  failed: number;
  running: number;
  uniqueCases: number;
  reaudits: number;
  retried: number;
  fallback: number;
  providerCalls: number;
  executionsWithoutCallTrace: number;
  tokens: number;
  executionsWithoutTokenTrace: number;
  knownCostUsd: number;
  executionsWithUnknownCost: number;
  avgKnownCostPerExecutionUsd: number | null;
  avgKnownCostPerCaseUsd: number | null;
}

export interface MonthlyActivity {
  timezone: 'UTC';
  audits: ActivityMetrics;
  comparisons: ActivityMetrics;
  knownTotalCostUsd: number;
  unknownCostExecutions: number;
  estimatedCostUsd: number | null;
}

export interface QualityCase {
  caseId: string;
  auditId: string;
  identifier: string;
  responsible: string | null;
  responsibleName?: string | null;
  auditedAt: string;
  aiResolution: string | null;
  originalConfidence: number | null;
  advisorResolution: string | null;
  finalResolution: string | null;
  comparisonId: string | null;
  comparisonConfidence: number | null;
  substantiveAgreement: boolean | null;
  exactAgreement: boolean | null;
  state: EvaluationState;
  latestExecutionStatus?: string;
  country: string | null;
  campus: string | null;
  guideline: string | null;
}

export interface QualityEvaluation {
  issued: number;
  finalized: number;
  validComparisons: number;
  agreements: number;
  disagreements: number;
  pendingEvaluation: number;
  failedComparisons: number;
  technicalErrors: number;
  runningAudits: number;
  withoutConfidence: number;
  agreementRate: number | null;
  coverageRate: number | null;
  exactAgreements: number;
  exactComparisons: number;
  rows: QualityCase[];
  historicalVersions: number;
  historicalRows?: QualityCase[];
  calibration: Array<{
    band: string;
    cases: number;
    evaluated: number;
    agreements: number;
    disagreements: number;
    declaredConfidence: number | null;
    observedAgreement: number | null;
    gap: number | null;
  }>;
}
