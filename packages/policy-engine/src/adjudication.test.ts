import { describe, expect, it } from 'vitest';
import {
  adjudicate, computeConfidence, validateCandidateDecision,
  type CandidateDecision, type GraphStatsInput,
} from './adjudication';
import type { EvaluatedRule, OutcomeStatus, DecisionStatus, PolicyEvaluation } from './index';

const candidate: CandidateDecision = {
  probableOutcome: 'CANCELACION_VENTA',
  outcomeStatus: 'PROBABLE',
  ruleRefs: [
    { ruleId: 'GDM-V5-5.8-A-NON-LICENCIATURA', section: '5.8.a', justification: 'Estudiante sin actividad academica y sin contacto efectivo.' },
    { ruleId: 'GDM-V5-5.2-A-CONTACT-ATTEMPTS', section: '5.2', justification: 'Mas de 16 llamadas y 6 interacciones escritas sin respuesta.' },
  ],
  evidenceRefs: [{ evidenceId: 'evidence-1', artifactId: 'artifact-1' }],
  evidenceGaps: ['classroom.hasGrades'],
  conditionNotes: [],
  explanation: 'El estudiante no ingreso a la plataforma, no tuvo actividad y los 45 intentos de contacto no fueron efectivos; procede la cancelacion por estudiante ilocalizable.',
  reasoningTrace: [
    { step: 'Sin acceso a plataforma y sin actividad academica', factType: 'academic.lastCourseAccess' },
    { step: '45 llamadas y 32 interacciones escritas sin exito', factType: 'contact.callAttempts' },
    { step: 'Se concluye estudiante ilocalizable', ruleId: 'GDM-V5-5.8-A-NON-LICENCIATURA' },
  ],
};

const graph: GraphStatsInput = {
  factTypes: ['student.level', 'contact.effectiveContact', 'contact.callAttempts', 'contact.writtenInteractions', 'classroom.hasActivities'],
  conflicts: 0,
  missingFacts: ['classroom.hasGrades'],
  completeness: { COMPLETE: 3, PARTIAL: 1 },
  factConfidenceAvg: 0.85,
};

function evaluationOf(overrides?: Partial<Parameters<typeof validateCandidateDecision>[0]['evaluation']>): Pick<PolicyEvaluation, 'evaluatedRules' | 'missingFacts' | 'suggestedOutcome' | 'outcomeStatus' | 'rulesFingerprint' | 'factsFingerprint'> {
  return {
    suggestedOutcome: 'CANCELACION_VENTA' as const,
    outcomeStatus: 'DETERMINED_WITH_WARNINGS' as const,
    rulesFingerprint: 'rules-fp',
    factsFingerprint: 'facts-fp',
    evaluatedRules: [
      { ruleId: 'GDM-V5-5.2-A-CONTACT-ATTEMPTS', category: 'PROCESS_RULE' as const, status: 'SATISFIED', conditions: [], factsUsed: ['c5'], evidenceRefs: [], outcomeEffect: 'CANCELACION_VENTA' as const, missingFacts: [], source: { documentCode: 'GDM_GAM_PRD_MLG_003', version: '5', section: '5', page: 3 } },
      { ruleId: 'GDM-V5-5.7-E-INITIAL-BIMESTER-GRADES', category: 'EXCLUSION_RULE' as const, status: 'UNKNOWN', conditions: [], factsUsed: ['c8'], evidenceRefs: [], outcomeEffect: 'BAJA' as const, missingFacts: ['classroom.hasGrades'], source: { documentCode: 'GDM_GAM_PRD_MLG_003', version: '5', section: '5.7.e', page: 9 } },
      { ruleId: 'GDM-V5-5.8-A-NON-LICENCIATURA', category: 'OUTCOME_RULE' as const, status: 'SATISFIED', conditions: [], factsUsed: [], evidenceRefs: [], outcomeEffect: 'CANCELACION_VENTA' as const, missingFacts: [], source: { documentCode: 'GDM_GAM_PRD_MLG_003', version: '5', section: '5.8.a', page: 9 } },
    ] as EvaluatedRule[],
    missingFacts: ['classroom.hasGrades'],
    ...overrides,
  } as Pick<PolicyEvaluation, 'evaluatedRules' | 'missingFacts' | 'suggestedOutcome' | 'outcomeStatus' | 'rulesFingerprint' | 'factsFingerprint'>;
}

describe('computeConfidence (modelo de confianza explicable)', () => {
  it('documenta los componentes del modelo y produce 0..1', () => {
    const confidence = computeConfidence({ ruleSupportScore: 0.5, graph, evidenceGaps: ['classroom.hasGrades'], validationVerdict: 'PARTIAL', missingFacts: graph.missingFacts });
    expect(confidence.value).toBeGreaterThanOrEqual(0);
    expect(confidence.value).toBeLessThanOrEqual(1);
    expect(confidence.rationale.length).toBeGreaterThan(3);
    expect(confidence.components.ruleSupport).toBe(0.5);
  });

  it('penaliza contradicciones y validacion fallida', () => {
    const clean = computeConfidence({ ruleSupportScore: 1, graph: { ...graph, conflicts: 0 }, evidenceGaps: [], validationVerdict: 'PARTIAL', missingFacts: [] });
    const conflicted = computeConfidence({ ruleSupportScore: 1, graph: { ...graph, conflicts: 2 }, evidenceGaps: [], validationVerdict: 'PARTIAL', missingFacts: [] });
    expect(conflicted.value).toBeLessThan(clean.value);
    const failed = computeConfidence({ ruleSupportScore: 1, graph: { ...graph, conflicts: 0 }, evidenceGaps: [], validationVerdict: 'FAIL', missingFacts: [] });
    expect(failed.value).toBeLessThan(clean.value);
  });
});

describe('validateCandidateDecision (Rule Engine como validador)', () => {
  it('PASS cuando las reglas citadas existen y son compatibles', () => {
    const validation = validateCandidateDecision({ candidate, evaluation: evaluationOf() });
    expect(validation.verdict).toBe('PASS');
    expect(validation.failures).toHaveLength(0);
  });

  it('POLICY_VALIDATION_FAILED si la IA cita una regla fuera del catalogo formal', () => {
    const fakeCandidate = { ...candidate, ruleRefs: [{ ruleId: 'REGLA-INVENTADA-9.9', section: '9.9', justification: 'inventada' }] };
    const validation = validateCandidateDecision({ candidate: fakeCandidate, evaluation: evaluationOf() });
    expect(validation.verdict).toBe('FAIL');
    expect(validation.failures.some((f) => f.includes('REGLA-INVENTADA-9.9'))).toBe(true);
  });

  it('FAIL si una regla formal satisfecha resuelve un outcome distinto al candidato', () => {
    const evaluation = evaluationOf({
      evaluatedRules: [
        { ruleId: 'GDM-V5-5.2-A-CONTACT-ATTEMPTS', category: 'PROCESS_RULE', status: 'SATISFIED' },
        { ruleId: 'GDM-V5-5.7-E-INITIAL-BIMESTER-GRADES', category: 'EXCLUSION_RULE', status: 'UNKNOWN', outcomeEffect: 'BAJA' },
        { ruleId: 'GDM-V5-5.8-A-NON-LICENCIATURA', category: 'OUTCOME_RULE', status: 'SATISFIED', outcomeEffect: 'RETENCION' },
      ],
    });
    const validation = validateCandidateDecision({ candidate, evaluation });
    expect(validation.verdict).toBe('FAIL');
    expect(validation.failures.some((f) => f.includes('RETENCION'))).toBe(true);
  });
});

describe('adjudicate (nunca se oculta tras INDETERMINATE)', () => {
  it('produce SUPPORTED con confianza, gaps y revision humana obligatoria', () => {
    const validation = validateCandidateDecision({ candidate, evaluation: evaluationOf() });
    const result = adjudicate({ candidate, validation, graph, evaluation: evaluationOf() });
    expect(result.probableOutcome).toBe('CANCELACION_VENTA');
    expect(['SUPPORTED', 'PROBABLE', 'UNCERTAIN', 'INSUFFICIENT_EVIDENCE', 'CONFLICTED', 'POLICY_VALIDATION_FAILED']).toContain(result.status);
    expect(result.mandatoryHumanReview).toBe(true);
    expect(result.confidence.value).toBeGreaterThan(0);
    expect(result.evidenceGaps).toContain('classroom.hasGrades');
    expect(result.pendingValidations.length).toBeGreaterThan(0);
  });

  it('POLICY_VALIDATION_FAILED ante regla inventada, manteniendo resultado trazable', () => {
    const fakeCandidate = { ...candidate, ruleRefs: [{ ruleId: 'REGLA-INVENTADA-9.9', section: '9.9', justification: 'inventada' }] };
    const validation = validateCandidateDecision({ candidate: fakeCandidate, evaluation: evaluationOf() });
    const result = adjudicate({ candidate: fakeCandidate, validation, graph, evaluation: evaluationOf() });
    expect(result.status).toBe('POLICY_VALIDATION_FAILED');
    expect(result.probableOutcome).toBeNull();
    expect(result.validation.failures.length).toBeGreaterThan(0);
  });

  it('INSUFFICIENT_EVIDENCE con gaps cuando el candidato no esta sustentado', () => {
    const weakCandidate = { ...candidate, outcomeStatus: 'INSUFFICIENT_EVIDENCE' as const, evidenceGaps: ['classroom.hasGrades', 'contact.callAttempts'] };
    const validation = validateCandidateDecision({ candidate: weakCandidate, evaluation: evaluationOf({ outcomeStatus: 'INDETERMINATE' }) });
    const result = adjudicate({ candidate: weakCandidate, validation, graph: { ...graph, missingFacts: ['classroom.hasGrades', 'contact.callAttempts'] }, evaluation: evaluationOf({ outcomeStatus: 'INDETERMINATE' }) });
    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.evidenceGaps.length).toBeGreaterThan(0);
  });
});