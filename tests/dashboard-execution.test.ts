// =============================================================================
// Clasificación técnica de la ejecución, coincidencia IA/humano y coste.
// =============================================================================
// Lo que se comprueba aquí, sobre todo, es que estas cifras NO confundan cosas
// distintas: que "éxito" no signifique "concedida", que un `0 %` de coincidencia
// solo aparezca cuando hay muestra, y que "no hay coste" no se pinte como
// "costó cero".

import { describe, expect, it } from 'vitest';
import { AUDIT_RESULTS } from '../src/skills/audit/types';
import { EXECUTION_OUTCOMES } from '../src/lib/dashboard';
import {
  aggregateExecution,
  aggregateHumanAgreement,
  aggregateSummaryCost,
  classifyExecution,
  type DashboardMetricRow,
} from '../src/server/dashboard';

function row(overrides: Partial<DashboardMetricRow> = {}): DashboardMetricRow {
  return {
    id: 'audit-1',
    case_id: 'case-00000000-1111',
    case_status: 'COMPLETED',
    student_identifier: null,
    audit_status: 'COMPLETED',
    model: 'google/gemini-2.5-flash',
    provider: 'openrouter',
    latency_ms: 4200,
    error_category: null,
    attempt_number: 1,
    created_at: '2026-09-10T12:00:00.000Z',
    result: 'CANCELACION_VENTA',
    confidence: 0.91,
    missing_evidence_count: 0,
    usage_cost_usd: 0.012,
    usage_total_tokens: 4000,
    usage_prompt_tokens: 3000,
    usage_completion_tokens: 1000,
    provider_models: ['google/gemini-2.5-flash'],
    attempts_cost_usd: 0.012,
    attempts_total_tokens: 4000,
    attempts_prompt_tokens: 3000,
    attempts_completion_tokens: 1000,
    attempts_count: 1,
    country: null,
    campus: null,
    modality: null,
    project: null,
    responsible: null,
    guideline: null,
    human_result: null,
    ...overrides,
  };
}

describe('classifyExecution — "éxito" es técnico, NO "concedida"', () => {
  it('COMPLETED con un intento es éxito al primer intento', () => {
    expect(classifyExecution(row())).toBe('SUCCESS_FIRST_ATTEMPT');
  });

  it('COMPLETED con varios intentos del MISMO modelo es éxito tras reintento', () => {
    expect(
      classifyExecution(
        row({ attempt_number: 2, attempts_count: 2, provider_models: ['google/gemini-2.5-flash'] }),
      ),
    ).toBe('SUCCESS_AFTER_RETRY');
  });

  it('COMPLETED con varios MODELOS es éxito con fallback, aunque también reintente', () => {
    // El fallback tiene prioridad: si se probaron dos modelos, lo destacable es
    // eso, no que hubiera reintentado.
    expect(
      classifyExecution(
        row({
          attempt_number: 3,
          attempts_count: 3,
          provider_models: ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite'],
        }),
      ),
    ).toBe('SUCCESS_WITH_FALLBACK');
  });

  it('ERROR es fallo aunque la llamada haya funcionado a medias', () => {
    expect(classifyExecution(row({ audit_status: 'ERROR', result: null, error_category: 'PROVIDER_UNAVAILABLE' }))).toBe(
      'FAILED',
    );
  });

  it('NO mira el resultado del dictamen: conceder NO es tener éxito', () => {
    // Un dictamen "evidencia insuficiente" es una auditoría técnicamente exitosa.
    // Esto es exactamente lo que el equipo pidió separar.
    expect(classifyExecution(row({ result: 'EVIDENCIA_INSUFICIENTE' }))).toBe(
      'SUCCESS_FIRST_ATTEMPT',
    );
    expect(classifyExecution(row({ result: 'CANCELACION_VENTA' }))).toBe('SUCCESS_FIRST_ATTEMPT');
  });

  it('sin modelos registrados no inventa un fallback', () => {
    // Un array vacío no es "probó varios": es que no se registró. Afirmar fallback
    // con ese dato sería inventarlo.
    expect(classifyExecution(row({ attempts_count: 2, provider_models: [] }))).toBe(
      'SUCCESS_AFTER_RETRY',
    );
  });
});

describe('aggregateExecution — el reparto cuadra', () => {
  it('las cuatro categorías suman el total de ejecuciones', () => {
    const report = aggregateExecution([
      row({ id: 'a1', case_id: 'c1' }),
      row({ id: 'a2', case_id: 'c2', attempt_number: 2, attempts_count: 2 }),
      row({
        id: 'a3',
        case_id: 'c3',
        provider_models: ['a', 'b'],
      }),
      row({ id: 'a4', case_id: 'c4', audit_status: 'ERROR', result: null }),
    ]);

    const suma = report.byOutcome.reduce((acc, point) => acc + point.count, 0);
    expect(suma).toBe(report.total);
    expect(report.succeeded + report.failed).toBe(report.total);
  });

  it('devuelve SIEMPRE las cuatro categorías, aunque valgan 0', () => {
    const report = aggregateExecution([]);
    expect(report.byOutcome.map((p) => p.outcome)).toEqual([...EXECUTION_OUTCOMES]);
    expect(report.byOutcome.every((p) => p.count === 0)).toBe(true);
  });

  it('cuenta los fallidos aparte de los exitosos', () => {
    const report = aggregateExecution([
      row({ id: 'a1', case_id: 'c1' }),
      row({ id: 'a2', case_id: 'c2', audit_status: 'ERROR', result: null }),
    ]);
    expect(report.succeeded).toBe(1);
    expect(report.failed).toBe(1);
  });

  it('`withFallback` coincide con la categoría SUCCESS_WITH_FALLBACK', () => {
    const report = aggregateExecution([
      row({ id: 'a1', case_id: 'c1', provider_models: ['x', 'y'] }),
      row({ id: 'a2', case_id: 'c2', provider_models: ['x'] }),
    ]);
    expect(report.withFallback).toBe(
      report.byOutcome.find((p) => p.outcome === 'SUCCESS_WITH_FALLBACK')?.count,
    );
  });
});

describe('aggregateHumanAgreement — sin muestra NO hay porcentaje', () => {
  it('sin revisiones NO muestra 0 %, sino que dice que no hay muestra', () => {
    const report = aggregateHumanAgreement([row(), row()]);
    // `0` aquí afirmaría "la IA nunca coincide con una persona", que es falso.
    expect(report.available).toBe(false);
    expect(report.agreementPct).toBeNull();
    expect(report.totalHumanReviewed).toBe(0);
    expect(report.reason).toBe('NO_HUMAN_REVIEWS');
  });

  it('con revisiones, el porcentaje es matched / totalHumanReviewed * 100', () => {
    const report = aggregateHumanAgreement([
      row({ id: 'a1', case_id: 'c1', result: 'CANCELACION_VENTA', human_result: 'CANCELACION_VENTA' }),
      row({ id: 'a2', case_id: 'c2', result: 'CANCELACION_VENTA', human_result: 'CANCELACION_VENTA' }),
      row({ id: 'a3', case_id: 'c3', result: 'BAJA', human_result: 'CANCELACION_VENTA' }),
    ]);

    expect(report.available).toBe(true);
    expect(report.totalHumanReviewed).toBe(3);
    expect(report.matched).toBe(2);
    expect(report.mismatched).toBe(1);
    // 2/3, NO 2/3 de los casos auditados: el denominador son las revisiones.
    expect(report.agreementPct).toBeCloseTo((2 / 3) * 100, 5);
  });

  it('los casos SIN revisión no entran en el denominador', () => {
    const report = aggregateHumanAgreement([
      row({ id: 'a1', case_id: 'c1', result: 'BAJA', human_result: 'BAJA' }),
      row({ id: 'a2', case_id: 'c2', result: 'BAJA' }),
      row({ id: 'a3', case_id: 'c3', result: 'BAJA' }),
    ]);
    // Un caso sin revisión no está en desacuerdo con nadie: está sin medir.
    expect(report.totalHumanReviewed).toBe(1);
    expect(report.agreementPct).toBe(100);
  });

  it('un dictamen humano fuera del vocabulario NO cuenta como coincidencia', () => {
    const report = aggregateHumanAgreement([
      row({ id: 'a1', case_id: 'c1', result: 'CANCELACION_VENTA', human_result: 'IMPROCEDENTE' }),
    ]);
    // "Improcedente" no es un resultado del Skill. No es una discrepancia: es un
    // dato que no pertenece al dominio, y se cuenta como no comparable.
    expect(report.totalHumanReviewed).toBe(1);
    expect(report.matched).toBe(0);
    expect(report.mismatches[0]?.humanResult).toBe('IMPROCEDENTE');
  });

  it('empareja por audit_id, no por caso', () => {
    // Dos auditorías del mismo caso: solo cuenta la que tiene revisión.
    const report = aggregateHumanAgreement([
      row({ id: 'a1', case_id: 'c1', result: 'BAJA', human_result: 'BAJA' }),
      row({ id: 'a2', case_id: 'c1', result: 'CANCELACION_VENTA' }),
    ]);
    expect(report.totalHumanReviewed).toBe(1);
    expect(report.matched).toBe(1);
  });

  it('reconoce todos los resultados del vocabulario como coincidencia válida', () => {
    for (const result of AUDIT_RESULTS) {
      const report = aggregateHumanAgreement([row({ result, human_result: result })]);
      expect(report.matched, `${result} debería contar como coincidencia`).toBe(1);
    }
  });
});

describe('aggregateSummaryCost — "no hay coste" NO es "costó cero"', () => {
  it('sin datos de coste devuelve available: false y promedio null', () => {
    const report = aggregateSummaryCost([row({ usage_cost_usd: null, attempts_cost_usd: null })]);
    expect(report.costAvailable).toBe(false);
    expect(report.avgCostPerCaseUsd).toBeNull();
  });

  it('con coste, el promedio es sobre los CASOS, no sobre las auditorías', () => {
    // Dos auditorías del mismo caso: el caso cuenta una vez.
    const report = aggregateSummaryCost([
      row({ id: 'a1', case_id: 'c1', usage_cost_usd: 0.1 }),
      row({ id: 'a2', case_id: 'c1', usage_cost_usd: 0.1 }),
    ]);
    expect(report.totalCostUsd).toBeCloseTo(0.2, 6);
    expect(report.casesWithCost).toBe(1);
    expect(report.avgCostPerCaseUsd).toBeCloseTo(0.2, 6);
  });

  it('suma el coste de las ejecuciones FALLIDAS: también se pagó', () => {
    const report = aggregateSummaryCost([
      row({ id: 'a1', case_id: 'c1', usage_cost_usd: 0.1 }),
      row({ id: 'a2', case_id: 'c2', audit_status: 'ERROR', result: null, usage_cost_usd: 0.05 }),
    ]);
    expect(report.totalCostUsd).toBeCloseTo(0.15, 6);
  });
});
