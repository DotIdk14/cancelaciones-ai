/**
 * Test 11/20 — Reglas causales que compiten sin prevalencia declarada.
 *
 * ## La regla del motor
 *
 * Cuando dos reglas que reaches proponen desenlaces distintos y **ninguna**
 * declara prevalencia, el motor no elige. Escala a `REQUIRES_HUMAN_REVIEW` con
 * las lecturas en disputa.
 *
 * Lo que este test NO hace es provocar un orden de preferencia. Que una regla
 * aparezca antes en el documento, o que su `supportScore` sea mayor, no es un
 * criterio de prevalencia: usarlos sería aplicar la preferencia operativa del
 * Owner como si fuera norma
 * (`OPERATIONAL_PRECEDENCE_IS_NOT_POLICY`).
 */

import { describe, expect, it } from 'vitest';
import { POLICY_VERSION, evaluateAudit, ruleById, rulesForNode } from '../index';
import type { EvidenceContext, Fact } from '../index';
import { bool, evidencia, unknown as unknownFact } from '../testing/fixtures';

function contexto(solicitud: string | null = '2026-01-15'): EvidenceContext {
  return {
    evidences: [evidencia('EV-1')],
    temporal: {
      cicloFechaInicio: solicitud === null ? null : '2026-01-05',
      fechaSolicitud: solicitud,
      fechaIngreso: solicitud === null ? null : '2026-01-05',
      inicioPrimerCiclo: '2024-08-05',
      avanceCurricularPercent: 10,
    },
    nivelAcademico: 'LICENCIATURA',
    campus: 'MEXICO',
  };
}

function evaluar(facts: Fact[], solicitud: string | null = '2026-01-15') {
  return evaluateAudit({ facts, evidenceContext: contexto(solicitud), policyVersion: POLICY_VERSION });
}

describe('lecturas que compiten sin prevalencia declarada', () => {
  it('el caso AMB-CON-04 escala y expone ambas lecturas', () => {
    const r = evaluar([
      bool('F-ajuste_por_error_inscripcion', true),
      bool('F-ce_decision_no_continuar', true),
      bool('F2-es_nuevo_ingreso', true),
    ]);
    expect(r.normativeStatus).toBe('REQUIRES_HUMAN_REVIEW');
    expect(r.normativeOutcome).toBeNull();
    expect(r.alternativeOutcomes).toEqual(
      expect.arrayContaining(['CANCELACION_VENTA', 'BAJA']),
    );
  });

  it('las lecturas en disputa quedan disponibles aunque no haya ganador', () => {
    const r = evaluar([
      bool('F-ajuste_por_error_inscripcion', true),
      bool('F-ce_decision_no_continuar', true),
      bool('F2-es_nuevo_ingreso', true),
    ]);
    // `REQUIRES_HUMAN_REVIEW` sin alternativas sería un callejón sin salida: el
    // revisor no sabría qué está en juego.
    expect(r.alternativeOutcomes.length).toBeGreaterThanOrEqual(2);
  });

  it('el soporte mayor no gana cuando no hay prevalencia declarada', () => {
    const r = evaluar([
      bool('F-ajuste_por_error_inscripcion', true),
      bool('F-ce_decision_no_continuar', true),
      bool('F2-es_nuevo_ingreso', true),
    ]);
    // Si una lectura tiene más reglas, `closestOutcome` la refleja, pero el
    // estado sigue siendo revisión y `normativeOutcome` sigue vacío.
    const [top] = r.candidateTrace;
    if (r.closestOutcome !== null) {
      expect(r.closestOutcome).toBe(top.outcome);
      expect(r.normativeOutcome).toBeNull();
    }
    expect(r.normativeStatus).toBe('REQUIRES_HUMAN_REVIEW');
  });

  it('nunca se declara prevalencia entre las dos lecturas de AMB-CON-04', () => {
    for (const id of ['R-CAUSAL-V', 'R-CAUSAL-V-BAJA']) {
      const rule = ruleById(id);
      expect(rule?.declaredPrecedenceOver ?? []).not.toContain(
        id === 'R-CAUSAL-V' ? 'R-CAUSAL-V-BAJA' : 'R-CAUSAL-V',
      );
    }
  });

  it('el conflicto materializado nombra a las dos reglas en disputa', () => {
    const r = evaluar([
      bool('F-ajuste_por_error_inscripcion', true),
      bool('F-ce_decision_no_continuar', true),
      bool('F2-es_nuevo_ingreso', true),
    ]);
    const conflicto = r.policyConflicts.find((c) => c.conflictId === 'AMB-CON-04');
    expect(conflicto).toBeDefined();
    expect(conflicto?.affectedRuleIds).toEqual(
      expect.arrayContaining(['R-CAUSAL-V', 'R-CAUSAL-V-BAJA']),
    );
  });

  it('el conflicto expone los desenlaces que podría tomar', () => {
    const r = evaluar([
      bool('F-ajuste_por_error_inscripcion', true),
      bool('F-ce_decision_no_continuar', true),
      bool('F2-es_nuevo_ingreso', true),
    ]);
    const conflicto = r.policyConflicts.find((c) => c.conflictId === 'AMB-CON-04');
    expect(conflicto?.candidateOutcomes).toEqual(
      expect.arrayContaining(['CANCELACION_VENTA', 'BAJA']),
    );
  });

  it('quitar la evidencia que dispara una lectura des-escala el conflicto', () => {
    const ambos = evaluar([
      bool('F-ajuste_por_error_inscripcion', true),
      bool('F-ce_decision_no_continuar', true),
      bool('F2-es_nuevo_ingreso', true),
    ]);
    const uno = evaluar([
      bool('F-ajuste_por_error_inscripcion', true),
      bool('F2-es_nuevo_ingreso', true),
    ]);
    expect(ambos.policyConflicts.map((c) => c.conflictId)).toContain('AMB-CON-04');
    expect(uno.policyConflicts.map((c) => c.conflictId)).not.toContain('AMB-CON-04');
  });

  it('un hecho en UNKNOWN no fuerza una lectura por defecto', () => {
    const r = evaluar([
      bool('F-ajuste_por_error_inscripcion', true),
      unknownFact('F-ce_decision_no_continuar'),
      bool('F2-es_nuevo_ingreso', true),
    ]);
    // `F-ce_decision_no_continuar` desconocido no puede contar como «no quiere
    // continuar», que es lo que dispararía la lectura de BAJA.
    expect(r.policyConflicts.map((c) => c.conflictId)).not.toContain('AMB-CON-04');
  });

  it('las reglas del nodo de CV se evalúan todas, no sólo la que gana', () => {
    const r = evaluar([
      bool('F-ajuste_por_error_inscripcion', true),
      bool('F-ce_decision_no_continuar', true),
      bool('F2-es_nuevo_ingreso', true),
    ]);
    // `nodeId` viaja dentro del valor estructurado del paso, no como campo.
    const evaluadas = new Set(
      r.trace.entries
        .filter((e) => (e.value as Record<string, unknown> | undefined)?.nodeId === 'NODE-CV-DEF')
        .map((e) => e.ref),
    );
    for (const rule of rulesForNode('NODE-CV-DEF')) {
      expect(evaluadas.has(rule.ruleId)).toBe(true);
    }
  });
});
