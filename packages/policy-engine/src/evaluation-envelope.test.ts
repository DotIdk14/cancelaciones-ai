import { describe, expect, it } from 'vitest';
import {
  EVALUATION_REASON_CODES,
  toAuditEvaluationEnvelopeV1,
} from './evaluation-envelope';
import type { PolicyEvaluation } from './index';

const reasonCodes = [
  'NO_POLICY_OUTCOME', 'MISSING_EVIDENCE', 'CONTRADICTORY_EVIDENCE',
  'POLICY_COVERAGE_GAP', 'MISSING_NORMATIVE_SOURCE', 'MODEL_ERROR',
  'PARSING_ERROR', 'SCHEMA_ERROR', 'PERSISTENCE_ERROR', 'HUMAN_REVIEW_REQUIRED',
] as const;

function baselineEvaluation(overrides: Partial<PolicyEvaluation> = {}): PolicyEvaluation {
  return {
    policyCode: 'GDM_GAM_PRD_MLG_003',
    policyVersion: '5',
    rulesFingerprint: 'rules-fp',
    factsFingerprint: 'facts-fp',
    evaluatedRules: [],
    satisfiedRules: [],
    unknownRules: [],
    notApplicableRules: [],
    missingData: [],
    conflicts: [],
    suggestedOutcome: 'CANCELACION_VENTA',
    outcomeStatus: 'DETERMINED',
    decisionStatus: 'READY_TO_APPROVE',
    reviewRequired: false,
    suggestedReason: null,
    decisiveRules: [],
    supportingRules: ['GDM-V5-5.8-A-LICENCIATURA'],
    opposingRules: [],
    pendingRules: [],
    conflictingRules: [],
    blockedRules: [],
    exclusions: [],
    missingEvidence: [],
    missingFacts: [],
    missingNormativeSources: [],
    softwareCoverageGaps: [],
    nextActions: [],
    explanation: '',
    trace: { decision: '', ruleIds: [], factIds: [], evidenceRefs: [] },
    ...overrides,
  };
}

describe('toAuditEvaluationEnvelopeV1', () => {
  it('clasifica las diez reason codes sin cambiar los outcomes de PolicyEvaluation', () => {
    const evaluation = baselineEvaluation({
      suggestedOutcome: null,
      outcomeStatus: 'INDETERMINATE',
      decisionStatus: 'REVIEW_REQUIRED',
      reviewRequired: true,
      missingEvidence: ['evidence-1'],
      softwareCoverageGaps: ['Sección 5.10'],
      missingNormativeSources: ['source-1'],
    });

    const envelope = toAuditEvaluationEnvelopeV1(evaluation, {
      systemReasonCodes: ['MODEL_ERROR', 'PARSING_ERROR', 'SCHEMA_ERROR', 'PERSISTENCE_ERROR'],
      contradictoryEvidence: ['evidence-2'],
    });

    expect(envelope.decision).toEqual({
      suggestedOutcome: null,
      outcomeStatus: 'INDETERMINATE',
      decisionStatus: 'REVIEW_REQUIRED',
      reasonCodes: ['NO_POLICY_OUTCOME'],
    });
    expect(envelope.evidence.reasonCodes).toEqual(['CONTRADICTORY_EVIDENCE', 'MISSING_EVIDENCE']);
    expect(envelope.evidence.missingFacts).toEqual([]);
    expect(envelope.evidence.missingEvidence).toEqual(['evidence-1']);
    expect(envelope.evidence.contradictoryEvidence).toEqual(['evidence-2']);
    expect(envelope.policy.reasonCodes).toEqual(['MISSING_NORMATIVE_SOURCE', 'POLICY_COVERAGE_GAP']);
    expect(envelope.system.reasonCodes).toEqual(['MODEL_ERROR', 'PARSING_ERROR', 'SCHEMA_ERROR', 'PERSISTENCE_ERROR']);
    expect(envelope.review.reasonCodes).toEqual(['HUMAN_REVIEW_REQUIRED']);

    const classified = [
      ...envelope.decision.reasonCodes,
      ...envelope.evidence.reasonCodes,
      ...envelope.policy.reasonCodes,
      ...envelope.system.reasonCodes,
      ...envelope.review.reasonCodes,
    ];
    expect(new Set(classified)).toEqual(new Set(reasonCodes));
    expect(envelope.reasonCodes).toEqual([
      'MODEL_ERROR', 'PARSING_ERROR', 'SCHEMA_ERROR', 'PERSISTENCE_ERROR',
      'MISSING_NORMATIVE_SOURCE', 'POLICY_COVERAGE_GAP',
      'CONTRADICTORY_EVIDENCE', 'MISSING_EVIDENCE', 'HUMAN_REVIEW_REQUIRED',
      'NO_POLICY_OUTCOME',
    ]);
    expect(EVALUATION_REASON_CODES).toEqual(reasonCodes);
  });

  it('no convierte evaluation.conflicts en contradictoryEvidence', () => {
    const envelope = toAuditEvaluationEnvelopeV1(baselineEvaluation({
      conflicts: [{
        ruleIds: ['R1', 'R2'],
        outcomes: ['BAJA', 'RETENCION'],
        reason: 'Reglas incompatibles',
      }],
    }));

    expect(envelope.evidence.contradictoryEvidence).toEqual([]);
    expect(envelope.evidence.reasonCodes).toEqual([]);
  });

  it('mantiene missingFacts separado de missingEvidence y no activa MISSING_EVIDENCE', () => {
    const envelope = toAuditEvaluationEnvelopeV1(baselineEvaluation({
      missingFacts: ['fact-1'],
    }));

    expect(envelope.evidence.missingFacts).toEqual(['fact-1']);
    expect(envelope.evidence.missingEvidence).toEqual([]);
    expect(envelope.evidence.reasonCodes).toEqual([]);
    expect(envelope.reasonCodes).not.toContain('MISSING_EVIDENCE');
  });

  it('activa MISSING_EVIDENCE sólo desde evaluation.missingEvidence', () => {
    const envelope = toAuditEvaluationEnvelopeV1(baselineEvaluation({
      missingEvidence: ['evidence-1'],
    }));

    expect(envelope.evidence.missingEvidence).toEqual(['evidence-1']);
    expect(envelope.evidence.reasonCodes).toEqual(['MISSING_EVIDENCE']);
  });

  it('mantiene MODEL_ERROR en system y no lo reinterpreta como outcomeStatus', () => {
    const evaluation = baselineEvaluation({
      suggestedOutcome: 'CANCELACION_VENTA',
      outcomeStatus: 'DETERMINED_WITH_WARNINGS',
      decisionStatus: 'READY_TO_APPROVE',
    });

    const envelope = toAuditEvaluationEnvelopeV1(evaluation, {
      systemReasonCodes: ['MODEL_ERROR'],
    });

    expect(envelope.decision.outcomeStatus).toBe('DETERMINED_WITH_WARNINGS');
    expect(envelope.decision.suggestedOutcome).toBe('CANCELACION_VENTA');
    expect(envelope.system.reasonCodes).toEqual(['MODEL_ERROR']);
  });

  it('no agrega reason codes ausentes y conserva los fingerprints', () => {
    const envelope = toAuditEvaluationEnvelopeV1(baselineEvaluation());

    expect(envelope.decision.reasonCodes).toEqual([]);
    expect(envelope.evidence.reasonCodes).toEqual([]);
    expect(envelope.policy.reasonCodes).toEqual([]);
    expect(envelope.system.reasonCodes).toEqual([]);
    expect(envelope.review.reasonCodes).toEqual([]);
    expect(envelope.policy.rulesFingerprint).toBe('rules-fp');
    expect(envelope.evidence.factsFingerprint).toBe('facts-fp');
    expect(envelope.schemaVersion).toBe('audit-evaluation-envelope-v1');
  });
});
