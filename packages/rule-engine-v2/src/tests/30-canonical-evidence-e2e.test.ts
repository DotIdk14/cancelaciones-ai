import { describe, expect, it } from 'vitest';

import {
  buildCanonicalEvaluateAuditInput,
  candidateToFact,
  evaluateAudit,
  mergeCanonicalFacts,
  relevantMissingFactsForEvaluation,
  type CanonicalFactCandidate,
} from '../index';

function evidenceCandidate(factId: string, value: unknown): CanonicalFactCandidate {
  return {
    factId,
    proposedState: 'KNOWN',
    value,
    evidenceId: 'ev-d53-sintetico',
    artifactId: 'artifact-d53-text',
    artifactHash: 'b'.repeat(64),
    extractionMethod: 'DETERMINISTIC',
    extractionConfidence: 1,
    extractorId: 'canonical-e2e-fixture',
    extractorVersion: '1.0.0',
    sourceText: `${factId}=${String(value)}`,
  };
}

describe('30 — E2E canónico determinista', () => {
  it('convierte evidencia sintética en hechos canónicos y obtiene resolución provisional útil', () => {
    const facts = mergeCanonicalFacts([
      candidateToFact(evidenceCandidate('F2-es_nuevo_ingreso', true)),
      candidateToFact(evidenceCandidate('F2-tipo_ingreso', 'REGULAR')),
      candidateToFact(evidenceCandidate('F2-d53_supera_50', true)),
    ]);

    const input = buildCanonicalEvaluateAuditInput({
      facts,
      evidences: [{ evidenceId: 'ev-d53-sintetico', kind: 'TEXT', label: 'fixture sintético D53' }],
      temporal: {
        cicloFechaInicio: '2026-01-05',
        fechaSolicitud: '2026-03-06',
        fechaIngreso: '2026-01-05',
        inicioPrimerCiclo: '2024-08-05',
        avanceCurricularPercent: 10,
      },
      nivelAcademico: 'LICENCIATURA',
      campus: 'MEXICO',
    });

    const evaluation = evaluateAudit(input);

    expect(evaluation.normativeStatus).toBe('REQUIRES_HUMAN_REVIEW');
    expect(evaluation.normativeOutcome).toBeNull();
    expect(evaluation.closestOutcome).toBe('BAJA');
    expect(evaluation.provisionalOnly.map((rule) => rule.ruleId)).toContain('R-D53-RELOJ-50');
    expect(evaluation.provisionalOnly.flatMap((rule) => rule.awaitsAmbiguityIds)).toContain('AMB-TEM-07');
    expect(evaluation.trace.entries.some((entry) => entry.kind === 'PROVISIONAL_ONLY')).toBe(true);
    expect(relevantMissingFactsForEvaluation(evaluation).length).toBeLessThan(94);
  });
});
