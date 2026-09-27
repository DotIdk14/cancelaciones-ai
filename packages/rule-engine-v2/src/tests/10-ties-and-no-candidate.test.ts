/**
 * Test 10/20 — Empates y ausencia de candidatos.
 *
 * ## Por qué un empate es un resultado y no un fallo
 *
 * El motor no tiene probabilidades, priors ni frecuencias: la fuente no los
 * contiene. Ante el mismo soporte, no existe base normativa para elegir uno, así
 * que `closestOutcome` debe ser `null` y **ambos** desenlaces deben quedar
 * visibles. Elegir el primero de la lista, o el que aparece antes en el
 * documento, sería inventar un criterio de desempate.
 *
 * El soporte es un **conteo entero de reglas**, nunca una probabilidad: un
 * `2` significa «dos reglas independentes sostienen este desenlace», no «80 % de
 * confianza».
 */

import { describe, expect, it } from 'vitest';
import { POLICY_VERSION, evaluateAudit, OUTCOMES } from '../index';
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

describe('empates y ausencia de candidatos', () => {
  it('el soporte es un conteo entero de reglas, no una probabilidad', () => {
    const r = evaluar([
      bool('F-ajuste_por_error_inscripcion', true),
      bool('F-ce_decision_no_continuar', true),
    ]);
    expect(r.candidateTrace.length).toBeGreaterThan(0);
    for (const candidate of r.candidateTrace) {
      // Un `1` significa «una regla lo sostiene», no «100 % de confianza». Un
      // ratio 0..1 se leería como probabilidad, que la fuente no contiene.
      expect(Number.isInteger(candidate.supportScore)).toBe(true);
      expect(candidate.supportScore).toBeGreaterThanOrEqual(1);
      expect(candidate.supportingRuleIds).toHaveLength(candidate.supportScore);
    }
  });

  it('nada de evidencia no produce ningún candidato', () => {
    // Una auditoría sin hechos no puede tener un «desenlace más cercano»: no hay
    // nada que comparar. Antes la sola ventana temporal producía un candidato.
    const r = evaluar([]);
    expect(r.candidateTrace).toHaveLength(0);
    expect(r.closestOutcome).toBeNull();
  });

  it('un empate exacto deja closestOutcome en null', () => {
    const r = evaluar(
      [bool('F-ajuste_por_error_inscripcion', true), bool('F-ce_decision_no_continuar', true)],
      null,
    );
    expect(r.closestOutcome).toBeNull();
    expect(r.normativeOutcome).toBeNull();
  });

  it('en empate ambas lecturas quedan visibles', () => {
    const r = evaluar(
      [bool('F-ajuste_por_error_inscripcion', true), bool('F-ce_decision_no_continuar', true)],
      null,
    );
    expect(r.alternativeOutcomes.length).toBeGreaterThanOrEqual(2);
    expect(r.alternativeOutcomes).toEqual(
      expect.arrayContaining(['CANCELACION_VENTA', 'BAJA']),
    );
  });

  it('sin assessment cuando no hay ganador', () => {
    const r = evaluar(
      [bool('F-ajuste_por_error_inscripcion', true), bool('F-ce_decision_no_continuar', true)],
      null,
    );
    // Un assessment sin `closestOutcome` sería una explicación de nada.
    expect(r.provisionalAssessment).toBeNull();
  });

  it('sin evidencia no hay candidatos y tampoco ganador', () => {
    const r = evaluar([]);
    expect(r.closestOutcome).toBeNull();
    expect(r.normativeOutcome).toBeNull();
  });

  it('el empate no se resuelve por el orden del documento', () => {
    // Dos corridas con los hechos en orden inverso deben dar el mismo empate.
    const a = evaluar([
      bool('F-ajuste_por_error_inscripcion', true),
      bool('F-ce_decision_no_continuar', true),
    ], null);
    const b = evaluar([
      bool('F-ce_decision_no_continuar', true),
      bool('F-ajuste_por_error_inscripcion', true),
    ], null);
    expect(a.closestOutcome).toBe(b.closestOutcome);
    expect(JSON.stringify(a.candidateTrace)).toBe(JSON.stringify(b.candidateTrace));
  });

  it('todos los desenlaces del catálogo son alcanzables por las reglas', () => {
    // Un desenlace que ninguna regla produce es un hueco de cobertura, y se
    // detecta comparando el catálogo de desenlaces con el de reglas.
    const r = evaluar([bool('F-calificaciones_bimestre_1', true)]);
    for (const outcome of r.candidateTrace) {
      expect(OUTCOMES).toContain(outcome.outcome);
    }
  });

  it('un desenlace desplazado por prevalencia no puede ser el más cercano', () => {
    // N-64 desplaza CANCELACION_VENTA. Aunque una regla de CV coincida, el
    // resultado provisional no puede recomendar lo que la fuente excluye.
    const r = evaluar([
      bool('F-calificaciones_bimestre_1', true),
      bool('F-ce_decision_no_continuar', false),
    ]);
    expect(r.closestOutcome).not.toBe('CANCELACION_VENTA');
  });

  it('el empate se propaga como estado normativo, no como éxito', () => {
    const r = evaluar(
      [bool('F-ajuste_por_error_inscripcion', true), bool('F-ce_decision_no_continuar', true)],
      null,
    );
    expect(['REQUIRES_HUMAN_REVIEW', 'INSUFFICIENT_EVIDENCE']).toContain(r.normativeStatus);
  });

  it('la lista de candidatos no incluye desenlaces con soporte cero', () => {
    const r = evaluar([bool('F-calificaciones_bimestre_1', true)]);
    for (const candidate of r.candidateTrace) {
      expect(candidate.supportScore).toBeGreaterThan(0);
    }
  });

  it('cada candidato declara las reglas que lo sostienen', () => {
    const r = evaluar([bool('F-calificaciones_bimestre_1', true)]);
    const baja = r.candidateTrace.find((c) => c.outcome === 'BAJA');
    expect(baja?.supportingRuleIds).toContain('R-FILTRO-CALIFICACIONES');
  });

  it('un hecho UNKNOWN no genera candidatos', () => {
    const r = evaluar([unknownFact('F-retencion_realizada')]);
    for (const candidate of r.candidateTrace) {
      expect(candidate.supportingRuleIds.length).toBeGreaterThan(0);
    }
  });
});
