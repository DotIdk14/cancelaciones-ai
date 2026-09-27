import { describe, expect, it } from 'vitest';

import { relevantMissingFactsForEvaluation, type AuditEvaluation } from '../index';

const baseEvaluation = {
  policyVersion: 'policy-v2.0.0',
  rulesFingerprint: 'fp',
  normativeStatus: 'INSUFFICIENT_EVIDENCE',
  normativeOutcome: null,
  closestOutcome: null,
  alternativeOutcomes: [],
  provisionalAssessment: null,
  missingFacts: [],
  policyConflicts: [],
  candidateTrace: [],
  provisionalOnly: [],
  trace: { entries: [], fingerprint: 'trace' },
  shortCircuit: null,
  sourceRefs: [],
} satisfies AuditEvaluation;

describe('28 — faltantes relevantes', () => {
  it('no muestra faltantes operacionales cuando el caso está resuelto', () => {
    const evaluation: AuditEvaluation = {
      ...baseEvaluation,
      normativeStatus: 'DETERMINATE',
      normativeOutcome: 'BAJA',
      closestOutcome: 'BAJA',
      missingFacts: [requirement('F-contacto_efectivo')],
    };

    expect(relevantMissingFactsForEvaluation(evaluation)).toEqual([]);
  });

  it('muestra sólo hechos que aparecen en candidatos o requisitos bloqueantes', () => {
    const evaluation: AuditEvaluation = {
      ...baseEvaluation,
      closestOutcome: 'BAJA',
      missingFacts: [requirement('F-contacto_efectivo'), requirement('F-expediente_d53')],
      candidateTrace: [
        {
          outcome: 'BAJA',
          rank: 1,
          supportScore: 2,
          supportingRuleIds: ['R-X'],
          supportingFactIds: [],
          blockingRuleIds: ['R-BLOCK'],
          contradictoryFactIds: [],
          unresolvedFactIds: ['F-expediente_d53'],
          conflictIds: [],
          rationale: 'Falta expediente.',
        },
      ],
    };

    expect(relevantMissingFactsForEvaluation(evaluation).map((f) => f.factId)).toEqual(['F-expediente_d53']);
  });
});

function requirement(factId: string) {
  return {
    requirementId: `REQ-${factId}`,
    factId,
    name: factId,
    description: factId,
    requiredForRuleIds: ['R-BLOCK'],
    satisfiableBy: ['PDF'],
    whyItMatters: 'Puede cambiar el resultado.',
    sourceRefs: [],
  } satisfies AuditEvaluation['missingFacts'][number];
}
