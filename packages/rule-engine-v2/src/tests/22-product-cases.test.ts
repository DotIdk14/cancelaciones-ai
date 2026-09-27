/**
 * Test 22 — Los cuatro casos del producto, de extremo a extremo.
 *
 * ## El objetivo que estos tests protegen
 *
 * ```
 * PROVISIONAL_IS_NOT_NORMATIVE
 * HUMAN_REVIEW_DOES_NOT_ERASE_CLOSEST_OUTCOME
 * ```
 *
 * El riesgo real de un motor que distingue lo normativo de lo provisional es que
 * termine separándolos: un `REQUIRES_HUMAN_REVIEW` sin
 * `closestOutcome` es un `INDETERMINATE` con otro nombre, y el auditor vuelve a
 * la hoja en blanco. Estos tests verifican que la respuesta útil sobrevive a la
 * escalada.
 *
 * | Caso | Evidencia | Resultado esperado |
 * |---|---|---|
 * | A | cierra el primario | `DETERMINATE`, normativo = provisional |
 * | B | fuerte pero con ambigüedad abierta | review, `normativeOutcome: null`, `closestOutcome` poblado |
 * | C | dos desenlaces empatados | review, `closestOutcome: null`, candidatos listados |
 * | D | casi nada de evidencia | sin candidato, con una causa accionable |
 */

import { describe, expect, it } from 'vitest';
import { POLICY_VERSION, evaluateAudit } from '../index';
import type { AuditEvaluation, EvidenceContext, Fact } from '../index';
import { bool, evidencia, val } from '../testing/fixtures';

function contexto(over: Partial<EvidenceContext['temporal']> = {}): EvidenceContext {
  return {
    evidences: [evidencia('EV-1')],
    temporal: {
      cicloFechaInicio: '2026-01-05',
      fechaSolicitud: '2026-01-15',
      fechaIngreso: '2026-01-05',
      inicioPrimerCiclo: '2024-08-05',
      avanceCurricularPercent: 10,
      ...over,
    },
    nivelAcademico: 'LICENCIATURA',
    campus: 'MEXICO',
  };
}

function evaluar(facts: Fact[], over: Partial<EvidenceContext['temporal']> = {}): AuditEvaluation {
  return evaluateAudit({ facts, evidenceContext: contexto(over), policyVersion: POLICY_VERSION });
}

/** Un nuevo ingreso D53 que ya rebasó el 50 % de avance. */
const D53_MAS_50: Fact[] = [
  bool('F2-es_nuevo_ingreso', true),
  val('F2-tipo_ingreso', 'REGULAR'),
  bool('F2-d53_supera_50', true),
];

describe('caso A — resolución determinista', () => {
  it('el primario cierra el caso sin intervención humana', () => {
    const r = evaluar([bool('F-calificaciones_bimestre_1', true)]);
    expect(r.normativeStatus).toBe('DETERMINATE');
    expect(r.normativeOutcome).toBe('BAJA');
    expect(r.closestOutcome).toBe('BAJA');
  });

  it('un caso determinista no arrastra ambigüedades pendientes', () => {
    const r = evaluar([bool('F-calificaciones_bimestre_1', true)]);
    expect(r.provisionalOnly).toEqual([]);
  });

  it('normativo y provisional coinciden sin dejar de estar separados', () => {
    const r = evaluar([bool('F-calificaciones_bimestre_1', true)]);
    // Coinciden por casualidad normativa, no porque sean el mismo campo.
    expect(r.normativeOutcome).toBe(r.closestOutcome);
    expect(r.normativeStatus).toBe('DETERMINATE');
  });
});

describe('caso B — candidato fuerte con ambigüedad abierta', () => {
  const r = () =>
    evaluar(D53_MAS_50, { fechaSolicitud: '2026-03-06' });

  it('el estado escala a revisión humana', () => {
    expect(r().normativeStatus).toBe('REQUIRES_HUMAN_REVIEW');
  });

  it('el desenlace normativo queda vacío: la fuente auxiliar no decide', () => {
    expect(r().normativeOutcome).toBeNull();
  });

  it('la revisión NO borra la respuesta: closestOutcome sigue poblado', () => {
    // Éste es el corazón del test. Un review sin closest obligaría al auditor a
    // repetir la auditoría a mano.
    expect(r().closestOutcome).toBe('BAJA');
  });

  it('el motivo de la revisión es accionable, no genérico', () => {
    const pendiente = r().provisionalOnly.flatMap((rule) => rule.awaitsAmbiguityIds);
    expect(pendiente).toEqual(expect.arrayContaining(['AMB-TEM-07']));
  });

  it('nombra la regla provisional y su desenlace propuesto', () => {
    const reglas = r().provisionalOnly;
    expect(reglas.map((rule) => rule.ruleId)).toContain('R-D53-RELOJ-50');
    expect(reglas.find((rule) => rule.ruleId === 'R-D53-RELOJ-50')?.outcome).toBe('BAJA');
  });

  it('el soporte del candidato cuenta las reglas que lo sostienen', () => {
    const candidato = r().candidateTrace.find((c) => c.outcome === 'BAJA');
    expect(candidato?.supportScore).toBeGreaterThanOrEqual(1);
    expect(candidato?.supportingRuleIds).toContain('R-D53-RELOJ-50');
  });
});

describe('caso C — candidatos genuinamente empatados', () => {
  const r = () => evaluar(D53_MAS_50);

  it('el empate no produce ganador', () => {
    expect(r().closestOutcome).toBeNull();
  });

  it('el empate escala a revisión', () => {
    expect(r().normativeStatus).toBe('REQUIRES_HUMAN_REVIEW');
  });

  it('ambos candidatos quedan listados para el auditor', () => {
    expect([...r().alternativeOutcomes].sort()).toEqual(['BAJA', 'CANCELACION_VENTA']);
  });

  it('el empate tiene el mismo soporte a ambos lados', () => {
    const [a, b] = r().candidateTrace;
    expect(a.supportScore).toBe(b.supportScore);
  });

  it('no se fabrica un normativo para desempatar', () => {
    expect(r().normativeOutcome).toBeNull();
  });
});

describe('caso D — evidencia muy escasa', () => {
  const r = () => evaluar([]);

  it('no se inventa un desenlace', () => {
    expect(r().normativeOutcome).toBeNull();
    expect(r().closestOutcome).toBeNull();
  });

  it('el estado es evidencia insuficiente, no revisión por conflicto', () => {
    expect(r().normativeStatus).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('expone los hechos decisivos que faltan', () => {
    // La UI necesita una lista accionable, no un «se requiere más evidencia».
    expect(r().missingFacts.length).toBeGreaterThan(0);
    for (const requirement of r().missingFacts) {
      expect(requirement.factId.length).toBeGreaterThan(0);
      expect(requirement.whyItMatters.length).toBeGreaterThan(0);
    }
  });

  it('el motivo dice cuántos hechos faltan', () => {
    const paso = r().trace.entries.find((e) => e.kind === 'RESULT' && e.ref === 'normative');
    expect(paso?.detail.length ?? 0).toBeGreaterThan(0);
  });
});

describe('la separación normativa/provisional se mantiene en todos los casos', () => {
  const casos: [string, AuditEvaluation][] = [
    ['A determinista', evaluar([bool('F-calificaciones_bimestre_1', true)])],
    ['B candidato fuerte', evaluar(D53_MAS_50, { fechaSolicitud: '2026-03-06' })],
    ['C empate', evaluar(D53_MAS_50)],
    ['D sin evidencia', evaluar([])],
  ];

  it('nunca hay desenlace normativo sin estado DETERMINATE', () => {
    for (const [nombre, r] of casos) {
      if (r.normativeOutcome !== null) {
        expect(r.normativeStatus, nombre).toBe('DETERMINATE');
      }
    }
  });

  it('DETERMINATE sin outcome normativo es imposible', () => {
    for (const [nombre, r] of casos) {
      if (r.normativeStatus === 'DETERMINATE') {
        expect(r.normativeOutcome, nombre).not.toBeNull();
      }
    }
  });

  it('toda revisión expone su motivo en la traza', () => {
    for (const [nombre, r] of casos) {
      if (r.normativeStatus === 'REQUIRES_HUMAN_REVIEW') {
        const paso = r.trace.entries.find((e) => e.kind === 'STATUS');
        expect(paso?.detail.length ?? 0, nombre).toBeGreaterThan(0);
      }
    }
  });

  it('ningún caso de revisión pierde su candidato más fuerte', () => {
    // Regresión del fallo más caro: review sin respuesta utilizable.
    for (const [nombre, r] of casos) {
      if (r.normativeStatus === 'REQUIRES_HUMAN_REVIEW' && r.closestOutcome === null) {
        // Sólo se admite cuando de verdad hay empate o no hay nada que ordenar.
        const hayEmpate = r.candidateTrace.length > 1;
        const sinCandidatos = r.candidateTrace.length === 0;
        expect(hayEmpate || sinCandidatos, nombre).toBe(true);
      }
    }
  });
});
