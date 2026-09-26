import { describe, expect, it } from 'vitest';
import type { DecisionTrace } from './decision-trace';

const baseAudit = { auditId: 'a-1', generatedAt: '2026-09-26T00:00:00.000Z' };
const basePolicy = {
  code: 'GDM_GAM_PRD_MLG_003',
  version: '5',
  rulesFingerprint: 'rf',
  factsFingerprint: 'ff',
};

describe('DecisionTrace', () => {
  it('permite normativo INDETERMINATE con resolución estimada presente', () => {
    const trace: DecisionTrace = {
      ...baseAudit,
      policy: basePolicy,
      normative: {
        status: 'INDETERMINATE',
        resolution: null,
        decisiveRules: ['R-11'],
        blockingRules: [{ ruleId: 'R-11', missingFacts: ['classroom.hasGrades'] }],
        conflicts: [],
        softwareCoverageGaps: [],
      },
      estimate: {
        resolution: 'CANCELACION_VENTA',
        alternatives: { CANCELACION_VENTA: 0.72, RETENCION: 0.28 },
        confidence: 0.72,
        confidenceLevel: 'MEDIA',
        basis: {
          ruleSupport: 0.8,
          graphConsistency: 1,
          sourceCoverage: 0.5,
          factConfidence: 0.71,
          evidenceCoverage: 0.6,
        },
        rationale: ['ruleSupport=0.80 (peso 0.35): reglas citadas satisfechas/validadas'],
        missingEvidence: ['evidencia de calificaciones en aula virtual'],
        humanReview: 'RECOMMENDED',
      },
      explanation: 'Falta evidencia de calificaciones.',
    };
    expect(trace.normative.status).toBe('INDETERMINATE');
    expect(trace.estimate?.resolution).toBe('CANCELACION_VENTA');
  });

  it('admite normativo DETERMINED con estimate null', () => {
    const trace: DecisionTrace = {
      ...baseAudit,
      policy: basePolicy,
      normative: {
        status: 'DETERMINED',
        resolution: 'CANCELACION_VENTA',
        decisiveRules: ['R-04'],
        blockingRules: [],
        conflicts: [],
        softwareCoverageGaps: [],
      },
      estimate: null,
      explanation: 'Cerrado.',
    };
    expect(trace.normative.resolution).toBe('CANCELACION_VENTA');
    expect(trace.estimate).toBeNull();
  });
});
