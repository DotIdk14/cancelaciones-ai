/**
 * Test 14/20 — La traza responde las preguntas del revisor.
 *
 * ## `TRACE_EVERY_DECISION`
 *
 * Una decisión que no se puede reconstruir no es auditable. La traza tiene que
 * poder contestar, para un caso dado:
 *
 * 1. ¿Qué evidencia entró y de dónde salió cada hecho?
 * 2. ¿Qué reglas se evaluaron, cuáles coincidieron y cuáles no?
 * 3. ¿Por qué una regla que no coincidió no cerró el caso?
 * 4. ¿Qué conflictos se materializaron y por qué?
 * 5. ¿Qué hechos faltarían y qué cambiarían?
 * 6. ¿Por qué el estado normativo es el que es?
 * 7. ¿Cuál es el resultado provisional y en qué se diferencia del normativo?
 * 8. Si hubo cortocircuito, ¿qué rama se cerró y por qué?
 *
 * Este test comprueba la presencia y la forma de cada respuesta. No comprueba que
 * la redacción sea bonita: comprueba que la información exista y sea recuperable
 * sin volver a ejecutar el motor.
 */

import { describe, expect, it } from 'vitest';
import { POLICY_VERSION, RULES, evaluateAudit } from '../index';
import type { EvidenceContext, Fact, TraceEntry } from '../index';
import { bool, contradicted, evidencia, unknown as unknownFact } from '../testing/fixtures';

function contexto(solicitud: string | null = '2026-01-15'): EvidenceContext {
  return {
    evidences: [evidencia('EV-1'), evidencia('EV-2', 'Segundo documento')],
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

const pasos = (facts: Fact[]) => evaluar(facts).trace.entries;
const de = (entries: readonly TraceEntry[], kind: TraceEntry['kind']) =>
  entries.filter((e) => e.kind === kind);

describe('completitud de la traza', () => {
  it('1. registra la evidencia y los hechos con su procedencia', () => {
    const entries = pasos([bool('F-retencion_realizada', true)]);
    expect(de(entries, 'EVIDENCE').length).toBeGreaterThan(0);
    for (const entry of de(entries, 'FACT')) {
      const value = entry.value as Record<string, unknown>;
      // Un hecho sin procedencia no se puede auditar.
      expect(value).toHaveProperty('state');
      expect(value).toHaveProperty('provenance');
      expect(value).toHaveProperty('evidenceRefs');
    }
  });

  it('2. registra todas las reglas evaluadas, coincidan o no', () => {
    const entries = pasos([bool('F-retencion_realizada', true)]);
    const rules = de(entries, 'RULE');
    expect(rules.length).toBe(RULES.length);
    for (const rule of rules) {
      expect(rule.ruleId).toBeDefined();
    }
  });

  it('3. cada paso de regla dice por qué coincidió o no', () => {
    const entries = pasos([bool('F-retencion_realizada', true)]);
    for (const rule of de(entries, 'RULE')) {
      const value = rule.value as Record<string, unknown>;
      expect(value).toHaveProperty('matched');
      expect(value).toHaveProperty('conditionValue');
      // Una coincidencia sin motivo no se puede revisar.
      expect(rule.detail.trim().length).toBeGreaterThan(0);
    }
  });

  it('4. las reglas que no coincidieron declaran qué hecho las bloqueó', () => {
    const entries = pasos([unknownFact('F-retencion_realizada')]);
    const bloqueadas = de(entries, 'RULE').filter(
      (e) => (e.value as Record<string, unknown>).matched === false,
    );
    expect(bloqueadas.length).toBeGreaterThan(0);
    for (const rule of bloqueadas) {
      const value = rule.value as Record<string, unknown>;
      expect(Array.isArray(value.blockingFactIds)).toBe(true);
    }
  });

  it('5. cada paso de regla cita su fuente normativa', () => {
    const entries = pasos([bool('F-retencion_realizada', true)]);
    for (const rule of de(entries, 'RULE')) {
      expect(rule.sourceRefs?.length ?? 0).toBeGreaterThan(0);
      for (const ref of rule.sourceRefs ?? []) {
        expect(ref.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it('6. el cortocircuito se registra aunque no ocurra', () => {
    // Siempre presente, en la misma posición relativa: dos trazas deben ser
    // comparables paso a paso.
    const entries = pasos([bool('F-retencion_realizada', true)]);
    expect(de(entries, 'SHORT_CIRCUIT')).toHaveLength(1);
  });

  it('7. el cortocircuito real nombra los nodos que no se recorrieron', () => {
    const r = evaluar([bool('F-calificaciones_bimestre_1', true)]);
    const paso = de(r.trace.entries, 'SHORT_CIRCUIT')[0];
    expect(paso?.ref).toBe('R-FILTRO-CALIFICACIONES');
    expect(r.shortCircuit?.skippedNodes.length).toBeGreaterThan(0);
  });

  it('8. los conflictos aparecen como pasos propios', () => {
    const r = evaluar([
      bool('F-ajuste_por_error_inscripcion', true),
      bool('F-ce_decision_no_continuar', true),
      bool('F2-es_nuevo_ingreso', true),
    ]);
    expect(de(r.trace.entries, 'CONFLICT').length).toBeGreaterThan(0);
  });

  it('9. los hechos faltantes aparecen como pasos propios', () => {
    const entries = pasos([]);
    expect(de(entries, 'MISSING_FACT').length).toBeGreaterThan(0);
  });

  it('10. los candidatos y el estado tienen paso propio', () => {
    const entries = pasos([bool('F-calificaciones_bimestre_1', true)]);
    expect(de(entries, 'CANDIDATE').length).toBeGreaterThan(0);
    expect(de(entries, 'STATUS')).toHaveLength(1);
    // Dos pasos de resultado, no uno: el normativo y el provisional se emiten
    // por separado para que la separación sea explícita en la traza.
    expect(de(entries, 'RESULT')).toHaveLength(2);
    expect(de(entries, 'RESULT').map((e) => e.ref)).toEqual(['normative', 'provisional']);
  });

  it('11. los pasos van numerados de forma correlativa y sin huecos', () => {
    const entries = pasos([bool('F-retencion_realizada', true)]);
    entries.forEach((entry, index) => {
      expect(entry.step).toBe(index + 1);
    });
  });

  it('12. la huella de la traza responde a su contenido', () => {
    const conHecho = evaluar([bool('F-retencion_realizada', true)]);
    const sinHecho = evaluar([]);
    expect(conHecho.trace.fingerprint).not.toBe(sinHecho.trace.fingerprint);
  });

  it('13. la huella es estable entre corridas', () => {
    const a = evaluar([bool('F-retencion_realizada', true)]);
    const b = evaluar([bool('F-retencion_realizada', true)]);
    expect(a.trace.fingerprint).toBe(b.trace.fingerprint);
  });

  it('14. un hecho contradictorio queda visible con su motivo', () => {
    const r = evaluar([contradicted('F-retencion_realizada')]);
    const paso = de(r.trace.entries, 'FACT').find((e) => e.ref === 'F-retencion_realizada');
    expect(paso?.detail).toContain('CONTRADICTED');
  });

  it('15. la traza no filtra datos personales de la evidencia', () => {
    const r = evaluar([bool('F-retencion_realizada', true)]);
    const volcado = JSON.stringify(r.trace);
    // La evidencia de test no trae PII; si algún día la traza la copiara entera,
    // este test lo detectaría.
    expect(volcado).not.toMatch(/[0-9]{13}/);
  });
});
