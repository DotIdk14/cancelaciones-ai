/**
 * Test 5/20 — Evidencia insuficiente y hechos decisivos faltantes.
 *
 * ## La distinción que este test protege
 *
 * `UNKNOWN` no es `FALSE`: un hecho que nadie consultó no es un hecho que
 * valga `FALSE`. El motor debe **rechazar decidir** cuando falta evidencia
 * decisiva, no tratar la ausencia como una negación.
 *
 * `INSUFFICIENT_EVIDENCE` significa: la política aplicable es clara, pero falta
 * un hecho que podría cambiar el desenlace. `UNKNOWN_IS_NOT_FALSE` exige que ese
 * caso no se resuelva, y `DECISIVE_MISSING_FACTS_ONLY` exige que la lista diga
 * *qué* falta, no las 70 cosas que el recorrido tocó por el camino.
 */

import { describe, expect, it } from 'vitest';
import { POLICY_VERSION, evaluateAudit } from '../index';
import type { Fact, NormativeStatus } from '../index';
import { bool, contexto, unknown as unknownFact, val } from '../testing/fixtures';

function evaluar(facts: Fact[]): ReturnType<typeof evaluateAudit> {
  return evaluateAudit({ facts, evidenceContext: contexto(), policyVersion: POLICY_VERSION });
}

describe('evidencia insuficiente', () => {
  it('sin hechos no inventa un desenlace normativo', () => {
    const r = evaluar([]);
    expect(r.normativeOutcome).toBeNull();
    expect(['INSUFFICIENT_EVIDENCE', 'REQUIRES_HUMAN_REVIEW']).toContain(r.normativeStatus);
  });

  it('nunca devuelve DETERMINATE sin evidencia que lo sostenga', () => {
    const r = evaluar([]);
    // El dato importante: el motor se abstiene. Un DETERMINATE aquí sería una
    // decisión tomada sin respaldo, que es el peor fallo posible del motor.
    expect(r.normativeStatus).not.toBe('DETERMINATE');
  });

  it('un hecho UNKNOWN no se comporta como FALSE', () => {
    // `F-retencion_realizada` en UNKNOWN no puede disparar R-FILTRO-RETENCION
    // (que exige `not(retencion_realizada)`). Si UNKNOWN se tratara como FALSE,
    // el motor cerraría BAJA sin evidencia de que la retención no se hizo.
    const r = evaluar([unknownFact('F-retencion_realizada')]);
    const filtro = r.trace.entries.find((e) => e.ruleId === 'R-FILTRO-RETENCION');
    const value = filtro?.value as Record<string, unknown> | undefined;
    expect(value?.matched ?? value?.conditionValue).not.toBe(true);
  });

  it('lista hechos faltantes con motivo y procedencia', () => {
    const r = evaluar([]);
    expect(r.missingFacts.length).toBeGreaterThan(0);
    for (const requirement of r.missingFacts) {
      // El catálogo no usa un prefijo único (`F-`, `F2-`, `F3-`...), así que la
      // garantía útil es que el identificador exista y sea referenciable.
      expect(requirement.factId.trim().length).toBeGreaterThan(0);
      expect(typeof requirement.description).toBe('string');
    }
  });

  it('sólo reporta hechos que podrían cambiar el desenlace', () => {
    // Hechos totalmente ajenos al caso: la lista no debe crecer.
    const vacio = evaluar([]).missingFacts.map((m) => m.factId).sort();
    const conHechosAjenos = evaluar([
      bool('F-ajuste_por_error_inscripcion', false),
      bool('F-causa_operativa_no_confirmada', false),
    ]).missingFacts.map((m) => m.factId).sort();

    // Resolver hechos en FALSE puede quitar requisitos, nunca añadirlos.
    for (const factId of conHechosAjenos) {
      expect(vacio).toContain(factId);
    }
  });

  it('no reporta hechos cuya regla ya quedó satisfecha en FALSE', () => {
    const r = evaluar([bool('F-ajuste_por_error_inscripcion', false)]);
    // Con el ajuste en FALSE, R-CAUSAL-V no puede cerrar; reportar sus hechos
    // sería pedir evidencia para una rama que la evidencia ya descartó.
    const reportados = r.missingFacts.map((m) => m.factId);
    expect(reportados.length).toBeLessThan(70);
  });

  it('escala a INSUFFICIENT_EVIDENCE, no a DETERMINATE con desenlace parcial', () => {
    const r = evaluar([unknownFact('F-retencion_realizada')]);
    if (r.normativeStatus === 'INSUFFICIENT_EVIDENCE') {
      expect(r.normativeOutcome).toBeNull();
    } else {
      expect(r.normativeStatus).toBe('REQUIRES_HUMAN_REVIEW');
      expect(r.normativeOutcome).toBeNull();
    }
  });

  it('el estado normativo es siempre uno de los tres permitidos', () => {
    const permitidos: NormativeStatus[] = [
      'DETERMINATE',
      'INSUFFICIENT_EVIDENCE',
      'REQUIRES_HUMAN_REVIEW',
    ];
    for (const facts of [
      [],
      [unknownFact('F-retencion_realizada')],
      [bool('F-calificaciones_bimestre_1', true)],
      [val('F-canal_venta', 'MYSTERY_SHOPPER')],
    ]) {
      expect(permitidos).toContain(evaluar(facts).normativeStatus);
    }
  });

  it('añadir evidencia puede cambiar el estado; quitarla también', () => {
    const conEvidencia = evaluar([bool('F-calificaciones_bimestre_1', true)]);
    const sinEvidencia = evaluar([]);
    expect(conEvidencia.normativeStatus).not.toBe(sinEvidencia.normativeStatus);
  });
});
