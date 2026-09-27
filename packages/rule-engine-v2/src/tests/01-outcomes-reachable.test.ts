/**
 * Test 1/20 — Alcanzabilidad de desenlaces.
 *
 * Verifica que cada uno de los 6 desenlaces terminales puede ser producido por
 * el motor desde hechos que la norma sí reacha, y que ninguno es inalcanzable
 * por construcción.
 *
 * Un desenlace inalcanzable es un defecto de diseño: obligaría a escribir una
 * regla nueva para poder reportar un caso que la norma ya contempla.
 */

import { describe, expect, it } from 'vitest';
import { OUTCOMES, POLICY_VERSION, evaluateAudit } from '../index';
import type { Outcome } from '../index';
import { bool, contexto, val, evidencia } from '../testing/fixtures';
import type { Fact } from '../index';

interface Scenario {
  readonly outcome: Outcome;
  readonly facts: readonly Fact[];
}

const SCENARIOS: readonly Scenario[] = [
  {
    outcome: 'CANCELACION_VENTA',
    // `F2-es_nuevo_ingreso` es el ámbito que `decision-tree.md` §12 marca como
    // «predicado necesario» de la definición de CV.
    facts: [
      bool('F-calificaciones_bimestre_1', false),
      bool('F-ce_decision_no_continuar', true),
      bool('F2-es_nuevo_ingreso', true),
    ],
  },
  {
    outcome: 'BAJA',
    facts: [bool('F-calificaciones_bimestre_1', true)],
  },
  {
    outcome: 'CANCELACION_MATRICULA',
    facts: [val('F-canal_venta', 'MYSTERY_SHOPPER')],
  },
  {
    outcome: 'RETENCION',
    facts: [bool('F-retencion_realizada', true), val('F-tipo_ajuste', 'GM_EE')],
  },
  {
    outcome: 'CANCELACION_VENTA_OPERATIVA',
    facts: [bool('F-op_error_validacion_bo', true)],
  },
  {
    outcome: 'DICTAMINACION',
    facts: [bool('F-nueva_iniciativa', true)],
  },
];

describe('alcanzabilidad de desenlaces', () => {
  it('cubre los 6 desenlaces terminales sin duplicar ni omitir', () => {
    const covered = [...SCENARIOS.map((s) => s.outcome)].sort();
    expect(covered).toEqual([...OUTCOMES].sort());
    expect(new Set(covered).size).toBe(6);
  });

  it.each(SCENARIOS)('puede producir $outcome desde hechos de la norma', (scenario) => {
    const result = evaluateAudit({
      facts: scenario.facts,
      evidenceContext: contexto('LICENCIATURA', undefined, [evidencia('EV-1')]),
      policyVersion: POLICY_VERSION,
    });

    // El desenlace aparece como candidato supporting o como normativo.
    const asCandidate = result.candidateTrace.some((c) => c.outcome === scenario.outcome);
    const asNormative = result.normativeOutcome === scenario.outcome;

    expect(asCandidate || asNormative).toBe(true);
  });

  it('no inventa desenlaces fuera de la lista canónica', () => {
    const result = evaluateAudit({
      facts: SCENARIOS[0].facts,
      evidenceContext: contexto(),
      policyVersion: POLICY_VERSION,
    });
    for (const candidate of result.candidateTrace) {
      expect(OUTCOMES).toContain(candidate.outcome);
    }
  });
});
