import { describe, expect, it } from 'vitest';

import { buildCanonicalContextFromLegacyFacts } from './build-context';

describe('build canonical context from legacy facts', () => {
  it('produce EvaluateAuditInput canónico sólo con mappings exactos y conserva metadata temporal', () => {
    const input = buildCanonicalContextFromLegacyFacts({
      legacyFacts: [
        { factType: 'contact.effectiveContact', value: false, sourceRef: { evidenceId: 'ev-1', artifactId: 'art-1' }, confidence: 0.8 },
        { factType: 'classroom.hasActivities', value: false, sourceRef: { evidenceId: 'ev-1', artifactId: 'art-1' }, confidence: 0.8 },
      ],
      evidences: [{ evidenceId: 'ev-1', kind: 'TEXT', label: 'evidencia sintética' }],
      temporal: {
        cicloFechaInicio: '2026-01-05',
        fechaSolicitud: '2026-01-10',
        fechaIngreso: null,
        inicioPrimerCiclo: null,
        avanceCurricularPercent: null,
      },
      nivelAcademico: 'LICENCIATURA',
      campus: 'MEXICO',
    });

    expect(input.facts.map((fact) => fact.factId)).toEqual(['F-contacto_efectivo']);
    expect(input.evidenceContext.temporal.fechaSolicitud).toBe('2026-01-10');
  });
});
