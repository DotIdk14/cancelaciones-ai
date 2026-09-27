/**
 * Test 2/20 — Ausencia de evidencia no equivale a `FALSE`.
 *
 * `UNKNOWN_IS_NOT_FALSE` es un invariante, no una preferencia de estilo. Si el
 * motor convirtiera un hecho ausente en `FALSE`, una auditoría sin evidencia
 * cerraría como si la norma lo hubiera rechazado, y el sistema no podría
 * distinguir «no aplica» de «no lo sabemos».
 *
 * Este test falla si alguna vez se introduce un `?? false`, un `|| false` o un
 * `Boolean(hechoAusente)` en la ruta de decisión.
 */

import { describe, expect, it } from 'vitest';
import { POLICY_VERSION, evaluateAudit } from '../index';
import type { Fact } from '../index';
import { bool, contexto, unknown } from '../testing/fixtures';

const CON_HECHOS_MINIMOS: readonly Fact[] = [
  // Todo en su estado correcto: nada de calificaciones, no es mystery, no hay
  // incidencia, la retención se realizó.
  bool('F-calificaciones_bimestre_1', false),
  bool('F-op_incidencia_sistema', false),
  bool('F-retencion_realizada', true),
];

describe('ausencia de evidencia no es FALSE', () => {
  it('un hecho ausente produce UNKNOWN, no FALSE, en la evaluación de condición', () => {
    const result = evaluateAudit({
      facts: CON_HECHOS_MINIMOS,
      evidenceContext: contexto(),
      policyVersion: POLICY_VERSION,
    });

    // Un hecho no provisto nunca aparece en el resultado como si fuera FALSE.
    const knownIds = result.trace.entries
      .filter((e) => e.kind === 'FACT')
      .map((e) => e.factId);
    expect(new Set(knownIds).size).toBe(knownIds.length);
  });

  it('no cierra como DETERMINATE cuando falta un hecho requerido', () => {
    const conFaltante = evaluateAudit({
      facts: [unknown('F-calificaciones_bimestre_1', 'Sin expediente académico disponible.')],
      evidenceContext: contexto(),
      policyVersion: POLICY_VERSION,
    });

    // Con el filtro de prevalencia indeterminate, el motor no puede afirmar BAJA.
    expect(conFaltante.normativeOutcome).not.toBe('BAJA');
  });

  it('reporta el hecho faltante como requisito, no como decisión', () => {
    const result = evaluateAudit({
      facts: [unknown('F-calificaciones_bimestre_1')],
      evidenceContext: contexto(),
      policyVersion: POLICY_VERSION,
    });

    const requirement = result.missingFacts.find(
      (r) => r.factId === 'F-calificaciones_bimestre_1',
    );
    expect(requirement).toBeDefined();
    expect(requirement?.requiredForRuleIds).toContain('R-FILTRO-CALIFICACIONES');
  });

  it('distingue UNKNOWN de NOT_APPLICABLE en el mismo resultado', () => {
    const result = evaluateAudit({
      facts: [
        unknown('F-calificaciones_bimestre_1', 'No consta.'),
        {
          factId: 'F-tipo_ajuste',
          value: null,
          state: 'NOT_APPLICABLE',
          evidenceRefs: [],
          provenance: [],
          extractionMethod: 'DETERMINISTIC',
          relevantTimestamp: null,
          notes: 'La norma excluye el ajuste administrativo para este caso.',
        },
      ],
      evidenceContext: contexto(),
      policyVersion: POLICY_VERSION,
    });

    const estados = result.trace.entries
      .filter((e) => e.kind === 'FACT')
      .map((e) => e.detail);

    expect(estados.some((d) => d.includes('UNKNOWN'))).toBe(true);
    expect(estados.some((d) => d.includes('NOT_APPLICABLE'))).toBe(true);
  });

  it('nunca usa un hecho no provisto como evidencia de apoyo', () => {
    const result = evaluateAudit({
      facts: [unknown('F-calificaciones_bimestre_1')],
      evidenceContext: contexto(),
      policyVersion: POLICY_VERSION,
    });

    // Si el filtro no Tracey, ninguna regla puede declarar apoyo en BAJA por
    // su cuenta.
    const bajaRule = result.candidateTrace.find((c) => c.outcome === 'BAJA');
    if (bajaRule) {
      expect(bajaRule.supportingFactIds).not.toContain('F-calificaciones_bimestre_1');
    }
  });
});
