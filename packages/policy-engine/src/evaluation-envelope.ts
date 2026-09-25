import type { DecisionStatus, Outcome, OutcomeStatus, PolicyEvaluation } from './index';

export const EVALUATION_REASON_CODES = [
  'NO_POLICY_OUTCOME', 'MISSING_EVIDENCE', 'CONTRADICTORY_EVIDENCE',
  'POLICY_COVERAGE_GAP', 'MISSING_NORMATIVE_SOURCE', 'MODEL_ERROR',
  'PARSING_ERROR', 'SCHEMA_ERROR', 'PERSISTENCE_ERROR', 'HUMAN_REVIEW_REQUIRED',
] as const;

export type EvaluationReasonCode = typeof EVALUATION_REASON_CODES[number];
export type EvaluationSystemReasonCode = Extract<
  EvaluationReasonCode,
  'MODEL_ERROR' | 'PARSING_ERROR' | 'SCHEMA_ERROR' | 'PERSISTENCE_ERROR'
>;

export interface AuditEvaluationEnvelopeContextV1 {
  systemReasonCodes?: readonly EvaluationSystemReasonCode[];
  contradictoryEvidence?: readonly string[];
}

export interface AuditEvaluationEnvelopeV1 {
  schemaVersion: 'audit-evaluation-envelope-v1';
  reasonCodes: readonly EvaluationReasonCode[];
  decision: {
    suggestedOutcome: Outcome | null;
    outcomeStatus: OutcomeStatus;
    decisionStatus: DecisionStatus;
    reasonCodes: readonly Extract<EvaluationReasonCode, 'NO_POLICY_OUTCOME'>[];
  };
  evidence: {
    factsFingerprint: string;
    missingFacts: readonly string[];
    missingEvidence: readonly string[];
    contradictoryEvidence: readonly string[];
    reasonCodes: readonly Extract<EvaluationReasonCode, 'MISSING_EVIDENCE' | 'CONTRADICTORY_EVIDENCE'>[];
  };
  policy: {
    policyCode: string;
    policyVersion: string;
    rulesFingerprint: string;
    coverageGaps: readonly string[];
    missingNormativeSources: readonly string[];
    reasonCodes: readonly Extract<EvaluationReasonCode, 'POLICY_COVERAGE_GAP' | 'MISSING_NORMATIVE_SOURCE'>[];
  };
  system: {
    reasonCodes: readonly EvaluationSystemReasonCode[];
  };
  review: {
    required: boolean;
    reasonCodes: readonly Extract<EvaluationReasonCode, 'HUMAN_REVIEW_REQUIRED'>[];
  };
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function toAuditEvaluationEnvelopeV1(
  evaluation: PolicyEvaluation,
  context: AuditEvaluationEnvelopeContextV1 = {},
): AuditEvaluationEnvelopeV1 {
  const contradictoryEvidence = unique(context.contradictoryEvidence ?? []);
  const missingEvidence = unique(evaluation.missingEvidence);

  const systemReasonCodes = unique(context.systemReasonCodes ?? []);
  const policyReasonCodes: AuditEvaluationEnvelopeV1['policy']['reasonCodes'] = [
    ...(evaluation.missingNormativeSources.length > 0 ? ['MISSING_NORMATIVE_SOURCE' as const] : []),
    ...(evaluation.softwareCoverageGaps.length > 0 ? ['POLICY_COVERAGE_GAP' as const] : []),
  ];
  const evidenceReasonCodes: AuditEvaluationEnvelopeV1['evidence']['reasonCodes'] = [
    ...(contradictoryEvidence.length > 0 ? ['CONTRADICTORY_EVIDENCE' as const] : []),
    ...(missingEvidence.length > 0 ? ['MISSING_EVIDENCE' as const] : []),
  ];
  const reviewReasonCodes: AuditEvaluationEnvelopeV1['review']['reasonCodes'] = evaluation.reviewRequired
    ? ['HUMAN_REVIEW_REQUIRED']
    : [];
  const decisionReasonCodes: AuditEvaluationEnvelopeV1['decision']['reasonCodes'] = evaluation.suggestedOutcome === null
    ? ['NO_POLICY_OUTCOME']
    : [];

  return {
    schemaVersion: 'audit-evaluation-envelope-v1',
    reasonCodes: unique([
      ...systemReasonCodes,
      ...policyReasonCodes,
      ...evidenceReasonCodes,
      ...reviewReasonCodes,
      ...decisionReasonCodes,
    ]),
    decision: {
      suggestedOutcome: evaluation.suggestedOutcome,
      outcomeStatus: evaluation.outcomeStatus,
      decisionStatus: evaluation.decisionStatus,
      reasonCodes: decisionReasonCodes,
    },
    evidence: {
      factsFingerprint: evaluation.factsFingerprint,
      missingFacts: [...evaluation.missingFacts],
      missingEvidence: [...evaluation.missingEvidence],
      contradictoryEvidence,
      reasonCodes: evidenceReasonCodes,
    },
    policy: {
      policyCode: evaluation.policyCode,
      policyVersion: evaluation.policyVersion,
      rulesFingerprint: evaluation.rulesFingerprint,
      coverageGaps: [...evaluation.softwareCoverageGaps],
      missingNormativeSources: [...evaluation.missingNormativeSources],
      reasonCodes: policyReasonCodes,
    },
    system: {
      reasonCodes: systemReasonCodes,
    },
    review: {
      required: evaluation.reviewRequired,
      reasonCodes: reviewReasonCodes,
    },
  };
}
