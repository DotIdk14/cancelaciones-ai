/**
 * Test 9/20 — `AMB-CON-04`: dos lecturas de la fuente, conviven.
 *
 * ## La ambigüedad
 *
 * `N-74` (p.13) permite cancelar la venta a quien **no** exprese continuar
 * ("continuar" se lee como no querer desertar); `N-75` (p.13) mantiene la
 * venta de quien expresa no querer continuar, porque el retorno de una venta no
 * es una baja. Aplicadas al mismo caso se contradicen y **la fuente no declara
 * prevalencia entre ambas**.
 *
 * ## Lo que el motor debe hacer
 *
 * - `normativeStatus = REQUIRES_HUMAN_REVIEW`, nunca `DETERMINATE`.
 * - `normativeOutcome = null`: no se elige un ganador normativo.
 * - `closestOutcome` **puede** existir y es explícitamente provisional. No es
 *   una capitulación: es la lectura más cercana a la evidencia disponible.
 * - Si el soporte empata, `closestOutcome = null` y ambos desenlaces quedan
 *   visibles en `alternativeOutcomes`.
 *
 * `R-CAUSAL-V` y `R-CAUSAL-V-BAJA` se conservan como reglas distintas y
 * separadas. Fusionarlas sería resolver la ambigüedad por código, que es
 * exactamente lo que `AMB-CON-04` prohíbe.
 */

import { describe, expect, it } from 'vitest';
import { POLICY_VERSION, evaluateAudit, ruleById } from '../index';
import type { EvidenceContext, Fact } from '../index';
import { bool, evidencia } from '../testing/fixtures';

function contexto(): EvidenceContext {
  return {
    evidences: [evidencia('EV-1')],
    temporal: {
      cicloFechaInicio: '2026-01-05',
      fechaSolicitud: '2026-01-15',
      fechaIngreso: '2026-01-05',
      inicioPrimerCiclo: '2024-08-05',
      avanceCurricularPercent: 10,
    },
    nivelAcademico: 'LICENCIATURA',
    campus: 'MEXICO',
  };
}

const AMB_CON_04: Fact[] = [
  bool('F-ajuste_por_error_inscripcion', true),
  bool('F-ce_decision_no_continuar', true),
  // Ámbito de la definición de CV (`decision-tree.md` §12): sin este hecho la
  // lectura de CV no llega a proposerse y no hay conflicto que materializar.
  bool('F2-es_nuevo_ingreso', true),
];

function evaluar(facts: Fact[], fechas?: Partial<EvidenceContext['temporal']>) {
  const base = contexto();
  return evaluateAudit({
    facts,
    evidenceContext: { ...base, temporal: { ...base.temporal, ...fechas } },
    policyVersion: POLICY_VERSION,
  });
}

describe('AMB-CON-04: dos lecturas de la fuente', () => {
  it('las dos reglas en conflicto existen y siguen siendo separadas', () => {
    const v = ruleById('R-CAUSAL-V');
    const baja = ruleById('R-CAUSAL-V-BAJA');
    expect(v).toBeDefined();
    expect(baja).toBeDefined();
    if (v?.onMatch.kind === 'OUTCOME' && baja?.onMatch.kind === 'OUTCOME') {
      expect(v.onMatch.outcome).toBe('CANCELACION_VENTA');
      expect(baja.onMatch.outcome).toBe('BAJA');
    }
  });

  it('ninguna de las dos declara prevalencia sobre la otra', () => {
    const v = ruleById('R-CAUSAL-V');
    const baja = ruleById('R-CAUSAL-V-BAJA');
    expect(v?.declaredPrecedenceOver ?? []).not.toContain('R-CAUSAL-V-BAJA');
    expect(baja?.declaredPrecedenceOver ?? []).not.toContain('R-CAUSAL-V');
  });

  it('ambas declaran el conflicto AMB-CON-04', () => {
    expect(ruleById('R-CAUSAL-V')?.conflictIds).toContain('AMB-CON-04');
    expect(ruleById('R-CAUSAL-V-BAJA')?.conflictIds).toContain('AMB-CON-04');
  });

  it('el caso se escala a revisión humana y no se resuelve solo', () => {
    const r = evaluar(AMB_CON_04);
    expect(r.normativeStatus).toBe('REQUIRES_HUMAN_REVIEW');
    expect(r.normativeOutcome).toBeNull();
  });

  it('AMB-CON-04 aparece entre los conflictos materializados', () => {
    const r = evaluar(AMB_CON_04);
    expect(r.policyConflicts.map((c) => c.conflictId)).toContain('AMB-CON-04');
  });

  it('el resultado provisional existe y está separado del normativo', () => {
    const r = evaluar(AMB_CON_04);
    // `closestOutcome` es la lectura más cercana, no una decisión normativa.
    expect(r.closestOutcome).not.toBeNull();
    expect(r.normativeOutcome).toBeNull();
    expect(r.provisionalAssessment?.explanation).toContain('PROVISIONAL');
  });

  it('con soporte empatado no se manufacture un ganador', () => {
    // Sin ventana temporal, ninguna lectura gana por soporte. Un empate es
    // información: el motor no debe desempatar.
    const r = evaluar(AMB_CON_04, {
      cicloFechaInicio: null,
      fechaSolicitud: null,
      fechaIngreso: null,
    });
    expect(r.closestOutcome).toBeNull();
    expect(r.alternativeOutcomes).toEqual(
      expect.arrayContaining(['CANCELACION_VENTA', 'BAJA']),
    );
    expect(r.provisionalAssessment).toBeNull();
  });

  it('las dos lecturas siguen visibles como alternativas aunque una se acerque más', () => {
    const r = evaluar(AMB_CON_04);
    expect(r.alternativeOutcomes).toEqual(
      expect.arrayContaining(['CANCELACION_VENTA', 'BAJA']),
    );
  });

  it('el desempate provisional no borra el conflicto normativo', () => {
    const r = evaluar(AMB_CON_04);
    // Tener un `closestOutcome` no significa que la ambigüedad desapareció.
    expect(r.policyConflicts.length).toBeGreaterThan(0);
  });

  it('la traza cita el conflicto que causó la escalada', () => {
    const r = evaluar(AMB_CON_04);
    const paso = r.trace.entries.find((e) => e.ref === 'AMB-CON-04');
    expect(paso).toBeDefined();
  });

  it('AMB-CON-04 no se materializa si ninguna de sus reglas se alcanza', () => {
    // Conflicto local: sin los hechos que disparan las reglas, el conflicto no
    // escala. Un conflicto que se activara siempre sería ruido, no trazabilidad.
    const r = evaluar([bool('F-ajuste_por_error_inscripcion', false)]);
    expect(r.policyConflicts.map((c) => c.conflictId)).not.toContain('AMB-CON-04');
  });
});
