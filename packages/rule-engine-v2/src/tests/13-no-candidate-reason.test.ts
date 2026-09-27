/**
 * Test 13/20 — Ausencia de candidato y por qué importa cada evidencia faltante.
 *
 * ## El contrato que este test fija
 *
 * Cuando el motor no puede acercarse a ningún desenlace, no devuelve un
 * «posible» vacío: devuelve `closestOutcome: null` **y** la lista de hechos que
 * desbloquearían el caso, cada uno con la razón por la que su ausencia cambia el
 * resultado.
 *
 * Sin `whyItMatters`, la lista sería un formulario de faltantes: el revisor sabría
 * qué pedir, pero no por qué. Con ella, puede juzgar si vale la pena pedirlo.
 */

import { describe, expect, it } from 'vitest';
import { POLICY_VERSION, evaluateAudit } from '../index';
import type { EvidenceContext, Fact } from '../index';
import { bool, evidencia, unknown as unknownFact } from '../testing/fixtures';

function contexto(solicitud: string | null = null): EvidenceContext {
  return {
    evidences: [evidencia('EV-1')],
    temporal: {
      cicloFechaInicio: solicitud === null ? null : '2026-01-05',
      fechaSolicitud: solicitud,
      fechaIngreso: solicitud === null ? null : '2026-01-05',
      inicioPrimerCiclo: '2024-08-05',
      avanceCurricularPercent: null,
    },
    nivelAcademico: 'LICENCIATURA',
    campus: 'MEXICO',
  };
}

function evaluar(facts: Fact[]) {
  return evaluateAudit({ facts, evidenceContext: contexto(), policyVersion: POLICY_VERSION });
}

describe('ausencia de candidato y evidencia faltante', () => {
  it('sin evidencia no hay candidato ni ganador', () => {
    const r = evaluar([]);
    expect(r.candidateTrace).toHaveLength(0);
    expect(r.closestOutcome).toBeNull();
    expect(r.normativeOutcome).toBeNull();
  });

  it('la ausencia de candidato no es un error de ejecución', () => {
    const r = evaluar([]);
    // El motor responde con un resultado completo, no con una excepción: «no
    // puedo decidir» es una respuesta válida y accionable.
    expect(['INSUFFICIENT_EVIDENCE', 'REQUIRES_HUMAN_REVIEW']).toContain(r.normativeStatus);
    expect(r.trace.entries.length).toBeGreaterThan(0);
  });

  it('cada hecho faltante explica por qué su ausencia cambia el resultado', () => {
    const r = evaluar([]);
    expect(r.missingFacts.length).toBeGreaterThan(0);
    for (const requirement of r.missingFacts) {
      expect(requirement.whyItMatters.trim().length).toBeGreaterThan(0);
    }
  });

  it('cada hecho faltante declara para qué reglas se necesita', () => {
    const r = evaluar([]);
    for (const requirement of r.missingFacts) {
      expect(requirement.requiredForRuleIds.length).toBeGreaterThan(0);
    }
  });

  it('cada hecho faltante declara con qué evidencia se acreditaría', () => {
    const r = evaluar([]);
    for (const requirement of r.missingFacts) {
      // Vacío sólo si es un invariante normativo (D53-08, p.3): no hay documento
      // que acredite una invariante, y fingir uno sería pedir evidencia imposible.
      if (requirement.satisfiableBy.length === 0) {
        expect(requirement.normativeInvariant).toBe(true);
      } else {
        expect(requirement.satisfiableBy.length).toBeGreaterThan(0);
      }
    }
  });

  it('el invariante de D53-08 está marcado como tal, no como dato faltante', () => {
    const r = evaluar([]);
    const invariante = r.missingFacts.find((m) => m.factId === 'F2-d53_decision_mantiene');
    expect(invariante).toBeDefined();
    expect(invariante?.normativeInvariant).toBe(true);
    expect(invariante?.satisfiableBy).toHaveLength(0);
  });

  it('cada hecho faltante cita la fuente de la que proviene', () => {
    const r = evaluar([]);
    for (const requirement of r.missingFacts) {
      expect(requirement.sourceRefs.length).toBeGreaterThan(0);
      for (const ref of requirement.sourceRefs) {
        expect(ref.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it('los identificadores de requisito son únicos', () => {
    const r = evaluar([]);
    const ids = r.missingFacts.map((m) => m.requirementId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no se pide un hecho que la evidencia ya respondió en FALSE', () => {
    const r = evaluar([bool('F-ajuste_por_error_inscripcion', false)]);
    const ids = r.missingFacts.map((m) => m.factId);
    // La rama ya quedó descartada: pedir su evidencia sería ruido.
    expect(ids).not.toContain('F-ajuste_por_error_inscripcion');
  });

  it('acreditar un hecho pendiente lo quita de la lista', () => {
    const antes = evaluar([unknownFact('F-retencion_realizada')]);
    const despues = evaluar([bool('F-retencion_realizada', true)]);
    const antesIds = antes.missingFacts.map((m) => m.factId);
    const despuesIds = despues.missingFacts.map((m) => m.factId);
    expect(antesIds).toContain('F-retencion_realizada');
    expect(despuesIds).not.toContain('F-retencion_realizada');
  });

  it('la lista de faltantes es determinista', () => {
    const a = evaluar([]).missingFacts.map((m) => m.requirementId);
    const b = evaluar([]).missingFacts.map((m) => m.requirementId);
    expect(a).toEqual(b);
  });

  it('con el mismo orden de entrada la lista no cambia', () => {
    const a = evaluar([
      bool('F-calificaciones_bimestre_1', false),
      bool('F-retencion_realizada', true),
    ]).missingFacts.map((m) => m.requirementId);
    const b = evaluar([
      bool('F-retencion_realizada', true),
      bool('F-calificaciones_bimestre_1', false),
    ]).missingFacts.map((m) => m.requirementId);
    expect(a).toEqual(b);
  });

  it('no se exige más evidencia de la que la fuente condiciona', () => {
    // Una lista que pidiera todo el catálogo convertiría la auditoría en un
    // cuestionario infinito. Se acota a los hechos decisivos.
    const r = evaluar([]);
    expect(r.missingFacts.length).toBeLessThan(50);
  });
});
