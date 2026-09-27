import { describe, expect, it } from 'vitest';

import { evaluateAudit, POLICY_VERSION } from '../index';
import { bool, evidencia, val } from '../testing/fixtures';

describe('29 — AMB-CON-01 sigue visible', () => {
  it('al alcanzar sus dos reglas afectadas, el conflicto queda en salida y traza', () => {
    const evaluation = evaluateAudit({
      facts: [
        bool('F-retencion_realizada', false),
        bool('F2-es_nuevo_ingreso', true),
        val('F2-tipo_ingreso', 'REGULAR'),
      ],
      evidenceContext: {
        evidences: [evidencia('EV-AMB-CON-01')],
        temporal: {
          cicloFechaInicio: '2026-01-05',
          fechaSolicitud: '2026-01-01',
          fechaIngreso: null,
          inicioPrimerCiclo: '2026-01-05',
          avanceCurricularPercent: 0,
        },
        nivelAcademico: 'LICENCIATURA',
        campus: 'MEXICO',
      },
      policyVersion: POLICY_VERSION,
    });

    expect(evaluation.policyConflicts.map((conflict) => conflict.conflictId)).toContain('AMB-CON-01');
    expect(evaluation.trace.entries.some((entry) => entry.kind === 'CONFLICT' && entry.ref === 'AMB-CON-01')).toBe(true);
    expect(evaluation.candidateTrace.flatMap((candidate) => candidate.conflictIds)).toContain('AMB-CON-01');
  });
});
