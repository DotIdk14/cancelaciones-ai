/**
 * Test 6/20 — Evidencia contradictoria y estados que no son booleanos.
 *
 * ## Por qué este test existe
 *
 * Reducir el mundo a `true`/`false` es el modo de fallo más caro de un motor de
 * política: un hecho en conflicto se leería como «no», y el motor cerraría el
 * caso con una negación que nadie evidenció. `UNKNOWN_IS_NOT_FALSE` exige
 * distinguir, como mínimo:
 *
 * | Estado            | Significado                        | ¿Cierra el caso? |
 * | ----------------- | ---------------------------------- | ---------------- |
 * | `KNOWN`           | Hay evidencia y tiene valor        | Sí               |
 * | `UNKNOWN`         | Nadie lo consultó                  | No               |
 * | `NOT_APPLICABLE`  | La regla no aplica a este caso     | No               |
 * | `CONTRADICTED`    | Dos evidencias oficiales se oponen | No               |
 *
 * Los cuatro se propagan y se reportan; ninguno se colapsa a `FALSE`.
 */

import { describe, expect, it } from 'vitest';
import { POLICY_VERSION, all, evaluateCondition, evaluateAudit, FactIndex, hasFact, not } from '../index';
import type { Fact, TraceEntry } from '../index';
import {
  TEMPORAL_DEFECTO,
  bool,
  contexto,
  contradicted,
  notApplicable,
  unknown as unknownFact,
} from '../testing/fixtures';

function evaluar(facts: Fact[]): ReturnType<typeof evaluateAudit> {
  return evaluateAudit({ facts, evidenceContext: contexto(), policyVersion: POLICY_VERSION });
}

describe('evidencia contradictoria y estados no booleanos', () => {
  it('un hecho CONTRADICTED no se evalúa como FALSE', () => {
    const index = new FactIndex([contradicted('F-retencion_realizada')]);
    // Si CONTRADICTED se tratara como FALSE, `not(retencion_realizada)` sería TRUE y el
    // filtro de retención cerraría BAJA sobre evidencia en conflicto.
    const resultado = evaluateCondition(
      not(hasFact('F-retencion_realizada')),
      index,
      TEMPORAL_DEFECTO,
    );
    expect(resultado.value).not.toBe('TRUE');
  });

  it('un hecho CONTRADICTED tampoco se lee como TRUE', () => {
    const index = new FactIndex([contradicted('F-calificaciones_bimestre_1')]);
    const resultado = evaluateCondition(
      hasFact('F-calificaciones_bimestre_1'),
      index,
      TEMPORAL_DEFECTO,
    );
    expect(resultado.value).toBe('CONTRADICTED');
  });

  it('un hecho NOT_APPLICABLE no dispara la regla que lo consulta', () => {
    const r = evaluar([notApplicable('F-calificaciones_bimestre_1')]);
    // El cortocircuito de N-64 no debe dispararse con un hecho no aplicable.
    expect(r.shortCircuit).toBeNull();
    expect(r.normativeOutcome).not.toBe('BAJA');
  });

  it('un hecho UNKNOWN no dispara el cortocircuito de N-64', () => {
    const r = evaluar([unknownFact('F-calificaciones_bimestre_1')]);
    expect(r.shortCircuit).toBeNull();
  });

  it('CONTRADICTED domina sobre UNKNOWN en una conjunción', () => {
    // La contradicción es más específica que la ausencia: si un hecho está en
    // conflicto, el motor debe decirlo aunque el otro sea desconocido.
    const index = new FactIndex([
      contradicted('F-op_incidencia_sistema'),
      unknownFact('F-intencion_expresa_darse_de_baja'),
    ]);
    const resultado = evaluateCondition(
      all(hasFact('F-op_incidencia_sistema'), hasFact('F-intencion_expresa_darse_de_baja')),
      index,
      TEMPORAL_DEFECTO,
    );
    expect(resultado.value).toBe('CONTRADICTED');
  });

  it('un hecho en conflicto no produce un desenlace normativo', () => {
    const r = evaluar([contradicted('F-calificaciones_bimestre_1')]);
    expect(r.normativeStatus).not.toBe('DETERMINATE');
    expect(r.normativeOutcome).toBeNull();
  });

  it('la contradicción queda visible en la traza, no se pierde en silencio', () => {
    const r = evaluar([contradicted('F-calificaciones_bimestre_1')]);
    const paso = r.trace.entries.find((e) => e.kind === 'FACT' && e.ref === 'F-calificaciones_bimestre_1');
    expect(paso).toBeDefined();
    expect(JSON.stringify(paso?.value)).toContain('CONTRADICTED');
    expect(paso?.detail).toContain('CONTRADICTED');
  });

  it('los tres estados no booleanos se reportan como faltantes, no como resueltos', () => {
    const r = evaluar([
      unknownFact('F-op_incidencia_sistema'),
      notApplicable('F-calificaciones_bimestre_1'),
      contradicted('F-canal_venta'),
    ]);
    // Ninguno de los tres puede sustituirse por un FALSE que cierre el caso.
    expect(r.normativeOutcome).toBeNull();
  });

  it('KNOWN con valor FALSE sí cierra la rama que consulta', () => {
    // Contraste con los casos anteriores: aquí la evidencia sí dice «no» y el
    // motor puede descartarlo. Es la diferencia entre «no» y «no se sabe».
    const r = evaluar([bool('F-calificaciones_bimestre_1', false)]);
    expect(valorDeRegla(r.trace.entries, 'R-FILTRO-CALIFICACIONES')?.matched).toBe(false);
  });
});

/** Lee el valor estructurado de un paso de regla sin castear a `any`. */
function valorDeRegla(
  entries: readonly TraceEntry[],
  ruleId: string,
): { matched?: boolean; conditionValue?: string } | undefined {
  const entry = entries.find((item) => item.ruleId === ruleId);
  const value = entry?.value;
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  return {
    matched: typeof record.matched === 'boolean' ? record.matched : undefined,
    conditionValue: typeof record.conditionValue === 'string' ? record.conditionValue : undefined,
  };
}
