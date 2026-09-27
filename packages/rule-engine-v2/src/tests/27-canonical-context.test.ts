import { describe, expect, it } from 'vitest';

import {
  buildCanonicalEvaluateAuditInput,
  candidateToFact,
  POLICY_VERSION,
  type CanonicalFactCandidate,
} from '../index';

const candidate: CanonicalFactCandidate = {
  factId: 'F-contacto_efectivo',
  proposedState: 'KNOWN',
  value: true,
  evidenceId: 'ev-1',
  extractionMethod: 'DETERMINISTIC',
  extractorId: 'test',
  extractorVersion: '1.0.0',
};

describe('27 — canonical evaluation input', () => {
  it('construye EvaluateAuditInput serializable con fechas normativas explícitas', () => {
    const input = buildCanonicalEvaluateAuditInput({
      facts: [candidateToFact(candidate)],
      evidences: [{ evidenceId: 'ev-1', kind: 'TEXT', label: 'evidencia sintética' }],
      temporal: {
        cicloFechaInicio: '2026-09-01',
        fechaSolicitud: '2026-09-10',
        fechaIngreso: null,
        inicioPrimerCiclo: '2026-09-01',
        avanceCurricularPercent: 25,
      },
      nivelAcademico: 'LICENCIATURA',
      campus: 'MEXICO',
    });

    expect(input.policyVersion).toBe(POLICY_VERSION);
    expect(input.evidenceContext.temporal.fechaSolicitud).toBe('2026-09-10');
    expect(JSON.parse(JSON.stringify(input)).policyVersion).toBe(POLICY_VERSION);
  });

  it('rechaza fechas no ISO y avance fuera de 0..100 sin sustituir fecha actual', () => {
    expect(() => buildCanonicalEvaluateAuditInput({
      facts: [],
      evidences: [],
      temporal: {
        cicloFechaInicio: '10/09/2026',
        fechaSolicitud: null,
        fechaIngreso: null,
        inicioPrimerCiclo: null,
        avanceCurricularPercent: null,
      },
      nivelAcademico: null,
      campus: null,
    })).toThrow(/fecha ISO/);

    expect(() => buildCanonicalEvaluateAuditInput({
      facts: [],
      evidences: [],
      temporal: {
        cicloFechaInicio: null,
        fechaSolicitud: null,
        fechaIngreso: null,
        inicioPrimerCiclo: null,
        avanceCurricularPercent: 101,
      },
      nivelAcademico: null,
      campus: null,
    })).toThrow(/avance curricular/);
  });
});
