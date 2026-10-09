import { describe, expect, it } from 'vitest';
import { AUDIT_RESULTS, type AuditResultType } from '../src/skills/audit/types';
import { RESOLUTION_GROUPS } from '../src/lib/labels';
import type { DashboardFilters } from '../src/lib/dashboard';
import {
  COST_PER_ROW,
  DASHBOARD_PAGE_SIZE,
  aggregateAiCosts,
  aggregateHumanReview,
  aggregateQuality,
  aggregateSummary,
  confidenceBand,
  type ComparisonMetricRow,
  type CostGranularity,
  type DashboardMetricRow,
  type HumanReviewInput,
} from '../src/server/dashboard';

const FILTERS: DashboardFilters = { from: '2026-09-01', to: '2026-09-30', result: null, status: null };

/** Fila de la vista con valores por defecto válidos. */
function row(overrides: Partial<DashboardMetricRow> = {}): DashboardMetricRow {
  return {
    id: 'audit-1',
    case_id: 'case-00000000-1111',
    case_status: 'COMPLETED',
    student_identifier: null,
    audit_status: 'COMPLETED',
    model: 'google/gemini-2.5-flash-lite',
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
    provider_models: ['google/gemini-2.5-flash-lite'],
    attempts_cost_usd: 0.012,
    attempts_total_tokens: 4000,
    attempts_prompt_tokens: 3000,
    attempts_completion_tokens: 1000,
    attempts_count: 1,
    ...overrides,
  };
}

function summarize(rows: DashboardMetricRow[], totalAvailable = rows.length) {
  return aggregateSummary(rows, FILTERS, totalAvailable);
}

describe('aggregateSummary — auditoría vigente por caso', () => {
  it('gana la última auditoría del caso, no la primera', () => {
    const rows = [
      row({ id: 'a1', case_id: 'c1', result: 'BAJA', created_at: '2026-09-10T10:00:00.000Z' }),
      row({ id: 'a2', case_id: 'c1', result: 'DICTAMINACION', created_at: '2026-09-10T18:00:00.000Z' }),
    ];
    const summary = summarize(rows);

    expect(summary.kpi.auditedCases).toBe(1);
    expect(summary.kpi.needsRuling).toBe(1);
    expect(summary.kpi.granted).toBe(0);
  });

  it('en empate de timestamp gana la última que aparece en el array', () => {
    const tie = '2026-09-10T12:00:00.000Z';
    const rows = [
      row({ id: 'a1', case_id: 'c1', result: 'BAJA', created_at: tie }),
      row({ id: 'a2', case_id: 'c1', result: 'DICTAMINACION', created_at: tie }),
    ];
    expect(summarize(rows).kpi.needsRuling).toBe(1);

    // Invertido: ahora la última del array es la BAJA y debe ganar ella.
    const reversed = [rows[1] as DashboardMetricRow, rows[0] as DashboardMetricRow];
    const summary = summarize(reversed);
    expect(summary.kpi.granted).toBe(1);
    expect(summary.kpi.needsRuling).toBe(0);
  });

  it('los 4 grupos más los errores cuadran con auditedCases', () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => row({ id: `g${i}`, case_id: `concedida-${i}`, result: 'CANCELACION_VENTA' })),
      ...Array.from({ length: 2 }, (_, i) => row({ id: `d${i}`, case_id: `dictamen-${i}`, result: 'DICTAMINACION' })),
      row({ id: 'i0', case_id: 'insuficiente-0', result: 'EVIDENCIA_INSUFICIENTE' }),
      row({ id: 'e0', case_id: 'error-0', audit_status: 'ERROR', case_status: 'ERROR', error_category: 'AI_PROVIDER_ERROR', result: null }),
      row({ id: 'r0', case_id: 'en-curso-0', audit_status: 'RUNNING', case_status: 'AUDITING', result: null }),
    ];
    const { kpi } = summarize(rows);

    // 9 casos, pero el que está `RUNNING` todavía no está auditado: no entra ni
    // en el denominador ni en ningún grupo.
    expect(kpi.auditedCases).toBe(8);
    expect(kpi.granted).toBe(4);
    expect(kpi.needsRuling).toBe(2);
    expect(kpi.insufficient).toBe(1);
    expect(kpi.errors).toBe(1); // solo el ERROR explícito, no el caso en curso
    expect(kpi.granted + kpi.needsRuling + kpi.insufficient + kpi.errors).toBe(kpi.auditedCases);
    expect(kpi.grantedPct).toBeCloseTo(50, 1);
    expect(kpi.errorsPct).toBeCloseTo(12.5, 1);
    expect(kpi.grantedPct + kpi.needsRulingPct + kpi.insufficientPct + kpi.errorsPct).toBeCloseTo(100, 1);
  });

  it('una auditoría COMPLETED sin resultado entra en auditedCases pero en ningún grupo', () => {
    const rows = [
      row({ id: 'n0', case_id: 'sin-resultado-0', result: null }),
      row({ id: 'g0', case_id: 'concedida-0', result: 'CANCELACION_VENTA' }),
    ];
    const { kpi } = summarize(rows);

    expect(kpi.auditedCases).toBe(2);
    expect(kpi.granted).toBe(1);
    // El denominador sigue siendo el total de casos auditados: el 50 % concedido
    // es real, y el caso sin dictamen no se disfraza de error.
    expect(kpi.grantedPct).toBe(50);
    expect(kpi.errors).toBe(0);
  });

  it('sin filas no hay NaN ni divisiones por cero', () => {
    const summary = summarize([]);

    expect(summary.kpi).toEqual({
      auditedCases: 0,
      granted: 0,
      grantedPct: 0,
      needsRuling: 0,
      needsRulingPct: 0,
      rejected: 0,
      rejectedPct: 0,
      insufficient: 0,
      insufficientPct: 0,
      errors: 0,
      errorsPct: 0,
      casesWithMissingEvidence: 0,
      casesWithMissingEvidencePct: 0,
    });
    for (const value of Object.values(summary.kpi)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('un resultado desconocido o nulo no cuenta ni como grupo ni como error', () => {
    const rows = [
      row({ id: 'x1', case_id: 'desconocido', result: 'RESULTADO_INVENTADO' as AuditResultType }),
      row({ id: 'x2', case_id: 'nulo', result: null }),
    ];
    const summary = summarize(rows);

    expect(summary.kpi.auditedCases).toBe(2);
    expect(summary.kpi.granted + summary.kpi.needsRuling + summary.kpi.insufficient).toBe(0);
    expect(summary.kpi.errors).toBe(0);
    expect(summary.split.every((point) => point.count === 0)).toBe(true);
    expect(summary.byResult.every((point) => point.count === 0)).toBe(true);
  });
});

describe('aggregateSummary — timeline', () => {
  it('agrupa por día UTC y ordena ascendente', () => {
    const rows = [
      row({ id: 't3', case_id: 'c3', result: 'BAJA', created_at: '2026-09-20T08:00:00.000Z' }),
      row({ id: 't1', case_id: 'c1', result: 'CANCELACION_VENTA', created_at: '2026-09-10T08:00:00.000Z' }),
      row({ id: 't2', case_id: 'c2', result: 'DICTAMINACION', created_at: '2026-09-15T08:00:00.000Z' }),
    ];
    const summary = summarize(rows);

    expect(summary.timeline).toEqual([
      { bucket: '2026-09-10', granted: 1, needsRuling: 0, rejected: 0, insufficient: 0 },
      { bucket: '2026-09-15', granted: 0, needsRuling: 1, rejected: 0, insufficient: 0 },
      { bucket: '2026-09-20', granted: 1, needsRuling: 0, rejected: 0, insufficient: 0 },
    ]);
  });

  it('el bucket es el día UTC: 23:30 y 00:30 son días distintos', () => {
    const rows = [
      row({ id: 'u1', case_id: 'c1', result: 'BAJA', created_at: '2026-09-10T23:30:00.000Z' }),
      row({ id: 'u2', case_id: 'c2', result: 'BAJA', created_at: '2026-09-11T00:30:00.000Z' }),
    ];
    expect(summarize(rows).timeline.map((point) => point.bucket)).toEqual(['2026-09-10', '2026-09-11']);
  });

  it('un caso reauditado el mismo día suma una vez por cada dictamen emitido', () => {
    const rows = [
      row({ id: 'v1', case_id: 'c1', result: 'BAJA', created_at: '2026-09-10T08:00:00.000Z' }),
      row({ id: 'v2', case_id: 'c1', result: 'DICTAMINACION', created_at: '2026-09-10T20:00:00.000Z' }),
    ];
    const summary = summarize(rows);

    // La timeline cuenta volumen de dictámenes emitidos, no casos.
    expect(summary.timeline).toEqual([
      { bucket: '2026-09-10', granted: 1, needsRuling: 1, rejected: 0, insufficient: 0 },
    ]);
    // Los KPIs, en cambio, cuentan el caso una sola vez, por su estado vigente.
    expect(summary.kpi.granted).toBe(0);
    expect(summary.kpi.needsRuling).toBe(1);
  });

  it('un ERROR posterior no borra los dictámenes ya emitidos ese día', () => {
    // Defecto real: el 28 tenía 2 auditorías COMPLETED con
    // EVIDENCIA_INSUFICIENTE y su ÚLTIMO audit del día fue un ERROR, así que el
    // día entero caía a 0/0/0 y el gráfico quedaba plano.
    const rows = [
      row({ id: 'd1', case_id: 'c1', result: 'EVIDENCIA_INSUFICIENTE', created_at: '2026-09-28T09:00:00.000Z' }),
      row({ id: 'd2', case_id: 'c2', result: 'EVIDENCIA_INSUFICIENTE', created_at: '2026-09-28T11:00:00.000Z' }),
      row({ id: 'd3', case_id: 'c3', result: 'CANCELACION_VENTA', created_at: '2026-09-28T13:00:00.000Z' }),
      row({ id: 'e1', case_id: 'c4', audit_status: 'ERROR', case_status: 'ERROR', error_category: 'AI_PROVIDER_ERROR', result: null, created_at: '2026-09-28T23:00:00.000Z' }),
    ];
    const summary = summarize(rows);

    expect(summary.timeline).toEqual([
      { bucket: '2026-09-28', granted: 1, needsRuling: 0, rejected: 0, insufficient: 2 },
    ]);
    // El ERROR sí aparece en su propio KPI, que es donde se mide.
    expect(summary.kpi.errors).toBe(1);
  });

  it('un día sin dictámenes no emite punto: ni ERROR ni RUNNING aportan', () => {
    const rows = [
      row({ id: 'w1', case_id: 'c1', audit_status: 'ERROR', case_status: 'ERROR', error_category: 'AI_PROVIDER_ERROR', result: null, created_at: '2026-09-10T08:00:00.000Z' }),
      row({ id: 'w2', case_id: 'c2', audit_status: 'RUNNING', case_status: 'AUDITING', result: null, created_at: '2026-09-11T08:00:00.000Z' }),
    ];
    const summary = summarize(rows);

    expect(summary.timeline).toEqual([]);
    // El ERROR cuenta como error en los KPIs; el caso en curso no cuenta.
    expect(summary.kpi.errors).toBe(1);
    expect(summary.kpi.auditedCases).toBe(1);
  });

  it('un ERROR no aporta a la timeline aunque su fila traiga un resultado', () => {
    const rows = [
      row({ id: 'y1', case_id: 'c1', audit_status: 'ERROR', case_status: 'ERROR', error_category: 'AI_PROVIDER_ERROR', created_at: '2026-09-10T08:00:00.000Z' }),
      row({ id: 'y2', case_id: 'c2', result: 'EVIDENCIA_INSUFICIENTE', created_at: '2026-09-11T08:00:00.000Z' }),
    ];
    const summary = summarize(rows);

    // `y1` trae `CANCELACION_VENTA` por defecto, pero su `audit_status` es
    // ERROR: no emitió dictamen, así que no inventa una barra.
    expect(summary.timeline).toEqual([
      { bucket: '2026-09-11', granted: 0, needsRuling: 0, rejected: 0, insufficient: 1 },
    ]);
  });

  it('la suma de la timeline es exactamente la suma del reparto', () => {
    // Réplica del caso real de 8 dictámenes (3 CANCELACION_VENTA + 1 BAJA +
    // 1 CANCELACION_VENTA_OPERATIVA + 3 EVIDENCIA_INSUFICIENTE) repartidos en
    // dos días. Con un dictamen por caso, ambos totales coinciden: 8.
    const rows = [
      row({ id: 'd1', case_id: 'c1', result: 'EVIDENCIA_INSUFICIENTE', created_at: '2026-09-28T09:00:00.000Z' }),
      row({ id: 'd2', case_id: 'c2', result: 'EVIDENCIA_INSUFICIENTE', created_at: '2026-09-28T11:00:00.000Z' }),
      row({ id: 'd3', case_id: 'c3', result: 'CANCELACION_VENTA', created_at: '2026-09-28T13:00:00.000Z' }),
      row({ id: 'd4', case_id: 'c4', result: 'BAJA', created_at: '2026-09-28T15:00:00.000Z' }),
      row({ id: 'd5', case_id: 'c5', result: 'EVIDENCIA_INSUFICIENTE', created_at: '2026-09-28T17:00:00.000Z' }),
      row({ id: 'd6', case_id: 'c6', result: 'CANCELACION_VENTA_OPERATIVA', created_at: '2026-09-29T09:00:00.000Z' }),
      row({ id: 'd7', case_id: 'c7', result: 'CANCELACION_VENTA', created_at: '2026-09-29T11:00:00.000Z' }),
      row({ id: 'd8', case_id: 'c8', result: 'CANCELACION_VENTA', created_at: '2026-09-29T13:00:00.000Z' }),
    ];
    const summary = summarize(rows);

    const timelineTotal = summary.timeline.reduce(
      (acc, point) => acc + point.granted + point.needsRuling + point.insufficient,
      0,
    );
    const splitTotal = summary.split.reduce((acc, point) => acc + point.count, 0);

    expect(summary.timeline).toEqual([
      { bucket: '2026-09-28', granted: 2, needsRuling: 0, rejected: 0, insufficient: 3 },
      { bucket: '2026-09-29', granted: 3, needsRuling: 0, rejected: 0, insufficient: 0 },
    ]);
    expect(timelineTotal).toBe(8);
    expect(splitTotal).toBe(8);
    expect(timelineTotal).toBe(splitTotal);
  });
});

describe('aggregateSummary — RUNNING no es un error', () => {
  it('un caso en curso queda fuera de auditedCases y de los grupos, pero sigue en recentCases', () => {
    const rows = [
      row({ id: 'g0', case_id: 'concedida-0', result: 'CANCELACION_VENTA' }),
      row({
        id: 'r0',
        case_id: 'en-curso-0',
        audit_status: 'RUNNING',
        case_status: 'AUDITING',
        result: null,
        confidence: null,
        created_at: '2026-09-12T12:00:00.000Z',
      }),
    ];
    const summary = summarize(rows);

    expect(summary.kpi.auditedCases).toBe(1);
    expect(summary.kpi.granted).toBe(1);
    expect(summary.kpi.errors).toBe(0);
    expect(summary.kpi.grantedPct).toBe(100);
    expect(summary.kpi.granted + summary.kpi.needsRuling + summary.kpi.insufficient + summary.kpi.errors)
      .toBe(summary.kpi.auditedCases);

    // Pero en la tabla de recientes sí sale: esa lista refleja lo que hay en
    // pantalla, no el veredicto.
    expect(summary.recentCases.map((item) => item.caseId)).toEqual(['en-curso-0', 'concedida-0']);
    expect(summary.recentCases[0]).toMatchObject({
      caseId: 'en-curso-0',
      result: null,
      confidence: null,
      caseStatus: 'AUDITING',
    });
  });

  it('un RUNNING antiguo seguido de un COMPLETED sí cuenta: manda el vigente', () => {
    const rows = [
      row({ id: 'r1', case_id: 'c1', audit_status: 'RUNNING', case_status: 'AUDITING', result: null, created_at: '2026-09-10T08:00:00.000Z' }),
      row({ id: 'r2', case_id: 'c1', result: 'CANCELACION_VENTA', created_at: '2026-09-10T18:00:00.000Z' }),
    ];
    const summary = summarize(rows);

    expect(summary.kpi.auditedCases).toBe(1);
    expect(summary.kpi.granted).toBe(1);
    expect(summary.kpi.errors).toBe(0);
  });

  it('un COMPLETED más reciente deja de contar el ERROR anterior del mismo caso', () => {
    const rows = [
      row({ id: 'e1', case_id: 'c1', audit_status: 'ERROR', case_status: 'ERROR', error_category: 'AI_PROVIDER_ERROR', result: null, created_at: '2026-09-10T08:00:00.000Z' }),
      row({ id: 'c2', case_id: 'c1', result: 'DICTAMINACION', created_at: '2026-09-10T18:00:00.000Z' }),
    ];
    const summary = summarize(rows);

    expect(summary.kpi.auditedCases).toBe(1);
    expect(summary.kpi.errors).toBe(0);
    expect(summary.kpi.needsRuling).toBe(1);
  });
});

describe('aggregateSummary — series fijas y tabla de recientes', () => {
  it('split trae siempre las 4 categorías en orden fijo', () => {
    const summary = summarize([]);
    expect(summary.split).toEqual([
      { group: 'CONCEDIDAS', count: 0 },
      { group: 'REQUIERE_DICTAMINACION', count: 0 },
      { group: 'RECHAZADOS', count: 0 },
      { group: 'EVIDENCIA_INSUFICIENTE', count: 0 },
    ]);
    expect(summary.split.map((point) => point.group)).toEqual([...RESOLUTION_GROUPS]);
  });

  it('un TICKET_RECHAZADO cuenta en su propio grupo, no entre los insuficientes', () => {
    const summary = summarize([
      row({ id: 'r1', case_id: 'c1', result: 'TICKET_RECHAZADO', created_at: '2026-09-10T08:00:00.000Z' }),
      row({ id: 'r2', case_id: 'c2', result: 'EVIDENCIA_INSUFICIENTE', created_at: '2026-09-10T09:00:00.000Z' }),
    ]);

    expect(summary.kpi.insufficient).toBe(1);
    expect(summary.kpi.rejected).toBe(1);
    expect(summary.split.find((p) => p.group === 'RECHAZADOS')?.count).toBe(1);
    expect(summary.split.find((p) => p.group === 'EVIDENCIA_INSUFICIENTE')?.count).toBe(1);
    expect(summary.byResult.find((p) => p.result === 'TICKET_RECHAZADO')?.count).toBe(1);
    expect(summary.timeline).toEqual([
      { bucket: '2026-09-10', granted: 0, needsRuling: 0, rejected: 1, insufficient: 1 },
    ]);
  });

  it('byResult trae siempre los 8 resultados en el orden de AUDIT_RESULTS', () => {
    const summary = summarize([row({ result: 'BAJA' })]);
    expect(summary.byResult.map((point) => point.result)).toEqual([...AUDIT_RESULTS]);
    expect(summary.byResult.every((point) => point.count >= 0)).toBe(true);
    expect(summary.byResult.find((point) => point.result === 'BAJA')?.count).toBe(1);
  });

  it('recentCases devuelve como máximo 5, de más reciente a más antigua', () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      row({ id: `a${i}`, case_id: `case-0000000${i}`, created_at: `2026-09-${String(i + 1).padStart(2, '0')}T10:00:00.000Z` }),
    );
    const summary = summarize(rows.reverse());

    expect(summary.recentCases).toHaveLength(5);
    expect(summary.recentCases.map((item) => item.date)).toEqual([
      '2026-09-08T10:00:00.000Z',
      '2026-09-07T10:00:00.000Z',
      '2026-09-06T10:00:00.000Z',
      '2026-09-05T10:00:00.000Z',
      '2026-09-04T10:00:00.000Z',
    ]);
    expect(summary.recentCases[0]?.shortId).toBe('case-000');
    expect(summary.recentCases[0]?.shortId).toHaveLength(8);
  });

  it('missingEvidenceCount ausente se normaliza a 0 y conserva estado y fecha', () => {
    const summary = summarize([
      row({ case_id: 'case-abcdef01-2222', missing_evidence_count: null, case_status: 'ERROR', audit_status: 'ERROR', result: null, error_category: 'DATABASE_ERROR' }),
    ]);
    expect(summary.recentCases[0]).toMatchObject({
      caseId: 'case-abcdef01-2222',
      shortId: 'case-abc',
      missingEvidenceCount: 0,
      caseStatus: 'ERROR',
      date: '2026-09-10T12:00:00.000Z',
    });
  });
});

describe('aggregateSummary — completitud y metadatos', () => {
  it('no marca truncado cuando las filas ya fueron agregadas sin recorte', () => {
    const rows = [row()];
    expect(summarize(rows, DASHBOARD_PAGE_SIZE).truncated).toBe(false);
    expect(summarize(rows, DASHBOARD_PAGE_SIZE + 1).truncated).toBe(false);
  });

  it('devuelve los filtros aplicados y un generatedAt ISO', () => {
    const summary = summarize([]);
    expect(summary.filters).toEqual(FILTERS);
    expect(new Date(summary.generatedAt).toISOString()).toBe(summary.generatedAt);
  });
});

describe('confidenceBand', () => {
  it('usa los umbrales de labels.ts y devuelve null sin dato', () => {
    expect(confidenceBand(null)).toBeNull();
    expect(confidenceBand(0.99)).toBe('ALTA');
    expect(confidenceBand(0.85)).toBe('ALTA');
    expect(confidenceBand(0.84)).toBe('MEDIA');
    expect(confidenceBand(0.6)).toBe('MEDIA');
    expect(confidenceBand(0.59)).toBe('BAJA');
    expect(confidenceBand(0)).toBe('BAJA');
  });
});

// -----------------------------------------------------------------------------
// IA & Costos
// -----------------------------------------------------------------------------

function costs(rows: DashboardMetricRow[], granularity: CostGranularity = 'day', totalAvailable = rows.length) {
  return aggregateAiCosts(rows, FILTERS, granularity, totalAvailable);
}

/** Fila COMPLETED con coste de `usage`, que es el caso normal. */
function completada(overrides: Partial<DashboardMetricRow> = {}): DashboardMetricRow {
  return row({ audit_status: 'COMPLETED', case_status: 'COMPLETED', ...overrides });
}

/** Fila ERROR: sin `result`, y con la latencia que tuvo el fallo. */
function fallida(overrides: Partial<DashboardMetricRow> = {}): DashboardMetricRow {
  return row({
    audit_status: 'ERROR',
    case_status: 'ERROR',
    error_category: 'AI_PROVIDER_ERROR',
    result: null,
    ...overrides,
  });
}

describe('aggregateAiCosts — regla de coste', () => {
  it('usa usage_cost_usd y solo cae a attempts_cost_usd cuando no hay usage', () => {
    // `usage` es el gasto REAL de la llamada; `attempts` es la suma estimada de
    // todos los intentos. Mandan los dos en la fila y gana `usage`.
    const conUsage = completada({ id: 'a', case_id: 'c1', usage_cost_usd: 0.03, attempts_cost_usd: 0.09 });
    // Una auditoría en ERROR casi nunca llega a `usage`: aquí el único dato es
    // `attempts`, y ese gasto también cuenta.
    const soloAttempts = fallida({
      id: 'b',
      case_id: 'c2',
      usage_cost_usd: null,
      attempts_cost_usd: 0.04,
      usage_total_tokens: null,
      usage_prompt_tokens: null,
      usage_completion_tokens: null,
      attempts_total_tokens: 1200,
      attempts_prompt_tokens: 1000,
      attempts_completion_tokens: 200,
    });
    // Sin ninguno de los dos: el dato NO EXISTE. No se inventa un 0.
    const sinDato = completada({
      id: 'c',
      case_id: 'c3',
      usage_cost_usd: null,
      attempts_cost_usd: null,
      usage_total_tokens: null,
      usage_prompt_tokens: null,
      usage_completion_tokens: null,
      attempts_total_tokens: null,
      attempts_prompt_tokens: null,
      attempts_completion_tokens: null,
    });

    expect(COST_PER_ROW(conUsage)).toBe(0.03);
    expect(COST_PER_ROW(soloAttempts)).toBe(0.04);
    expect(COST_PER_ROW(sinDato)).toBeNull();

    const report = costs([conUsage, soloAttempts, sinDato]);
    expect(report.kpi.totalCostUsd).toBeCloseTo(0.07, 10);
    expect(report.kpi.costAvailable).toBe(true);
    // Los tokens de cada magnitud siguen su propio COALESCE: la fila `c` no
    // aporta a ninguna de las tres.
    expect(report.kpi.totalTokens).toBe(5200);
    expect(report.kpi.promptTokens).toBe(4000);
    expect(report.kpi.completionTokens).toBe(1200);
    expect(report.kpi.tokensAvailable).toBe(true);
    expect(report.kpi.auditsCounted).toBe(3);
  });

  it('sin ningún coste conocido: total 0 pero costAvailable false', () => {
    const sinTokens = { usage_total_tokens: null, attempts_total_tokens: null };
    const report = costs([
      completada({ id: 'a', case_id: 'c1', usage_cost_usd: null, attempts_cost_usd: null, ...sinTokens }),
      fallida({ id: 'b', case_id: 'c2', usage_cost_usd: null, attempts_cost_usd: null, ...sinTokens }),
    ]);

    expect(report.kpi.costAvailable).toBe(false);
    expect(report.kpi.totalCostUsd).toBe(0);
    expect(report.kpi.casesCounted).toBe(0);
    expect(report.kpi.avgCostPerCaseUsd).toBe(0);
    expect(report.kpi.tokensAvailable).toBe(false);
    expect(report.costSeries).toEqual([]);
    // Un modelo sin coste se sigue listando: existe una llamada, aunque no sepamos
    // cuánto costó. `totalCostUsd` sigue siendo 0 (la suma de una lista vacía SÍ
    // vale 0), pero `avgCostUsd` es `null` y `costKnownCalls` es 0: el promedio
    // de un conjunto vacío no es 0, y el 0 del total no significa "gasto cero".
    expect(report.byModel).toEqual([
      { model: 'google/gemini-2.5-flash-lite', calls: 2, totalCostUsd: 0, avgCostUsd: null, costKnownCalls: 0 },
    ]);
  });
});

// -----------------------------------------------------------------------------
// `COST_PER_ROW`: la tripleta real, y por qué el `(null, 0)` sigue existiendo
//
// `COST_PER_ROW` se escribe como `usage_cost_usd ?? attempts_cost_usd`, así que
// su contrato tiene TRES casos, no dos. Fijarlos aquí es lo que impide que
// alguien "simplifique" la expresión y, sin darse cuenta, vuelva a inventar un
// gasto.
//
//   (null, null) -> null   el dato NO EXISTE. Es el caso de una auditoría en
//                          ERROR que el proveedor no facturó de ninguna forma.
//   (0.02, null) -> 0.02  `usage` manda: es el gasto real de la llamada que
//                          terminó, y el resto de la fila es irrelevante.
//   (null, 0)    -> 0      SOLO si la fila trae un 0 LITERAL.
//
// El tercero es el importante, y por eso este test existe. La vista
// `public.audit_dashboard_metrics` antes producía `attempts_cost_usd = 0` (y no
// NULL) cuando ningún intento reportaba `cost`, de modo que `??` devolvía ese
// 0 y la UI pintaba `$0` para 6 auditorías fallidas cuyo coste se desconocía: un
// 0 que AFIRMA que el proveedor cobró exactamente nada. La vista ya no lo emite
// (el CTE `att` devuelve NULL cuando ningún intento trajo el valor, sección 1
// bis de la migración), pero `(null, 0) -> 0` sigue siendo el comportamiento
// CORRECTO de la función por dos razones:
//
//   1. `COST_PER_ROW` no sabe de dónde viene cada columna: no valida la vista ni
//      su versión, y no debe hacerlo. Su trabajo es ser una regla de agregación
//      estable, no un detective de datos de origen.
//   2. Si un 0 llegara alguna vez (otra vista, otra versión del adaptador, un
//      `COALESCE` en el consumidor), tratar un 0 explícito como 0 es honesto:
//      es un dato afirmado, no una ausencia. Lo que era falso no era este caso,
//      era que la vista FABRICABA el 0 que después llegaba aquí.
//
// El que estaba mal, entonces, no es este `??`: es el de la vista de origen, que
// ya no fabrica ese 0.
// -----------------------------------------------------------------------------
describe('COST_PER_ROW — contrato de la tripleta real', () => {
  it('(null, null) -> null, (0.02, null) -> 0.02, (null, 0) -> 0', () => {
    const sinNada = completada({ usage_cost_usd: null, attempts_cost_usd: null });
    const conUsage = completada({ usage_cost_usd: 0.02, attempts_cost_usd: null });
    const conCeroLiteral = completada({ usage_cost_usd: null, attempts_cost_usd: 0 });

    // (1) Los dos ausentes: el coste de esa auditoría es DESCONOCIDO. No se
    //     devuelve 0 y nunca se recalcula un precio a partir de los tokens.
    expect(COST_PER_ROW(sinNada)).toBeNull();

    // (2) `usage_cost_usd` manda siempre que exista: es el gasto REAL de la
    //     llamada que terminó, no una suma de estimaciones por intento.
    expect(COST_PER_ROW(conUsage)).toBe(0.02);

    // (3) Un 0 LITERAL se respeta como 0. Esta es la parte asimétrica del
    //     contrato: la función distingue "vale cero" de "no lo sé", y no es su
    //     trabajo suponer cuál de los dos es el caso cuando la fila dice 0. Que
    //     ese 0 llegue hasta aquí es responsabilidad de quien lo afirmó; lo que
    //     no puede hacer el agregador es descartar un dato explícito.
    expect(COST_PER_ROW(conCeroLiteral)).toBe(0);
  });

  it('(null, 0) SÍ suma al total y cuenta como llamada de coste conocido', () => {
    // Documenta el efecto observable del caso (3) para que nadie lo lea como un
    // resto del defecto anterior: si la vista volviera a emitir 0, el agregador
    // lo trataría como gasto real. Es exactamente por eso por lo que el arreglo
    // es de ORIGEN (la vista) y no de aquí: arreglarlo aquí curaría el síntoma y
    // dejaría la vista mintiendo en la base.
    const report = costs([
      completada({ id: 'a', case_id: 'c1', model: 'm', usage_cost_usd: null, attempts_cost_usd: 0 }),
      completada({ id: 'b', case_id: 'c2', model: 'm', usage_cost_usd: 0.1, attempts_cost_usd: 0.1 }),
    ]);

    expect(report.kpi.totalCostUsd).toBeCloseTo(0.1, 10);
    expect(report.byModel[0]).toMatchObject({ model: 'm', calls: 2, costKnownCalls: 2 });
  });
});

describe('aggregateAiCosts — coste medio por caso', () => {
  it('el denominador son los casos CON coste conocido, contados una sola vez', () => {
    const report = costs([
      completada({ id: 'a', case_id: 'c1', usage_cost_usd: 0.02, attempts_cost_usd: 0.02 }),
      completada({ id: 'b', case_id: 'c2', usage_cost_usd: 0.04, attempts_cost_usd: 0.04 }),
      // Mismo caso `c2` otra vez: el caso cuenta UNA vez, la fila cuenta su coste.
      completada({ id: 'c', case_id: 'c2', usage_cost_usd: 0.5, attempts_cost_usd: 0.5, created_at: '2026-09-11T12:00:00.000Z' }),
      // `c3` no tiene coste conocido: no puede estar en el denominador.
      completada({ id: 'd', case_id: 'c3', usage_cost_usd: null, attempts_cost_usd: null }),
    ]);

    expect(report.kpi.totalCostUsd).toBeCloseTo(0.56, 10);
    // c1 y c2. No c3, y c2 no cuenta dos veces por tener dos auditorías.
    expect(report.kpi.casesCounted).toBe(2);
    expect(report.kpi.avgCostPerCaseUsd).toBeCloseTo(0.28, 10);
  });

  it('un solo caso con coste da el mismo total que el medio', () => {
    const report = costs([completada({ id: 'a', case_id: 'c1', usage_cost_usd: 0.2, attempts_cost_usd: 0.2 })]);
    expect(report.kpi.casesCounted).toBe(1);
    expect(report.kpi.avgCostPerCaseUsd).toBeCloseTo(0.2, 10);
  });
});

describe('aggregateAiCosts — latencia', () => {
  it('solo mide COMPLETED: excluye ERROR y RUNNING', () => {
    // En un ERROR, `latency_ms` es el tiempo hasta el fallo; en un RUNNING
    // curado es la EDAD del run. Ninguno de los dos es latencia de cómputo.
    const report = costs([
      completada({ id: 'a', case_id: 'c1', latency_ms: 1000 }),
      fallida({ id: 'b', case_id: 'c2', latency_ms: 99_000 }),
      row({ id: 'c', case_id: 'c3', audit_status: 'RUNNING', case_status: 'AUDITING', result: null, latency_ms: 500_000 }),
    ]);

    expect(report.kpi.avgLatencyMs).toBe(1000);
    expect(report.kpi.p50LatencyMs).toBe(1000);
    expect(report.kpi.p95LatencyMs).toBe(1000);
    expect(report.kpi.latencyAvailable).toBe(true);
    // Los tres estados cuentan como auditoría, aunque solo uno aporte latencia.
    expect(report.kpi.auditsCounted).toBe(3);
  });

  it('un COMPLETED sin latencia tampoco cuenta para la media', () => {
    const report = costs([
      completada({ id: 'a', case_id: 'c1', latency_ms: 1000 }),
      completada({ id: 'b', case_id: 'c2', latency_ms: null }),
    ]);
    expect(report.kpi.avgLatencyMs).toBe(1000);
    expect(report.kpi.latencyAvailable).toBe(true);
  });

  it('percentil nearest-rank con n impar', () => {
    // n = 5. p50 -> ceil(2.5) = 3 -> índice 2 -> 300. p95 -> ceil(4.75) = 5 -> 500.
    const report = costs(
      [500, 100, 400, 200, 300].map((latency_ms, i) =>
        completada({ id: `a${i}`, case_id: `c${i}`, latency_ms }),
      ),
    );
    expect(report.kpi.avgLatencyMs).toBe(300);
    expect(report.kpi.p50LatencyMs).toBe(300);
    expect(report.kpi.p95LatencyMs).toBe(500);
  });

  it('percentil nearest-rank con n par: p50 cae en la mitad inferior', () => {
    // n = 4. p50 -> ceil(2) = 2 -> índice 1 -> 200 (NO 250, no interpola).
    // p95 -> ceil(3.8) = 4 -> índice 3 -> 400.
    const report = costs(
      [400, 100, 300, 200].map((latency_ms, i) => completada({ id: `a${i}`, case_id: `c${i}`, latency_ms })),
    );
    expect(report.kpi.avgLatencyMs).toBe(250);
    expect(report.kpi.p50LatencyMs).toBe(200);
    expect(report.kpi.p95LatencyMs).toBe(400);
  });

  it('sin COMPLETED con latencia, los tres son null y no hay datos', () => {
    const report = costs([
      fallida({ id: 'a', case_id: 'c1', latency_ms: 30_000 }),
      row({ id: 'b', case_id: 'c2', audit_status: 'RUNNING', case_status: 'AUDITING', result: null, latency_ms: 900_000 }),
    ]);

    expect(report.kpi.avgLatencyMs).toBeNull();
    expect(report.kpi.p50LatencyMs).toBeNull();
    expect(report.kpi.p95LatencyMs).toBeNull();
    expect(report.kpi.latencyAvailable).toBe(false);
  });

  it('sin filas no hay NaN ni divisiones por cero', () => {
    const report = costs([]);
    expect(report.kpi.avgLatencyMs).toBeNull();
    expect(report.kpi.totalCostUsd).toBe(0);
    expect(report.kpi.avgCostPerCaseUsd).toBe(0);
    expect(report.costSeries).toEqual([]);
    expect(report.byModel).toEqual([]);
    expect(report.reliability).toEqual({
      successful: 0,
      retried: 0,
      fallback: 0,
      failed: 0,
      executionOutcomes: {
        available: false,
        successfulFirstAttempt: 0,
        successfulAfterRetry: 0,
        fallback: null,
        failed: 0,
        inProgress: 0,
      },
    });
    for (const value of [report.kpi.totalCostUsd, report.kpi.avgCostPerCaseUsd, report.kpi.totalTokens]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe('aggregateAiCosts — serie de coste por periodo', () => {
  it('día: agrupa por día UTC y ordena ascendente, omitiendo días sin coste', () => {
    const report = costs(
      [
        completada({ id: 'a', case_id: 'c1', usage_cost_usd: 0.02, attempts_cost_usd: 0.02, created_at: '2026-09-20T08:00:00.000Z' }),
        completada({ id: 'b', case_id: 'c2', usage_cost_usd: 0.03, attempts_cost_usd: 0.03, created_at: '2026-09-10T08:00:00.000Z' }),
        completada({ id: 'c', case_id: 'c3', usage_cost_usd: 0.01, attempts_cost_usd: 0.01, created_at: '2026-09-10T20:00:00.000Z' }),
        // Sin coste: no inventa un punto en cero para ese día.
        completada({ id: 'd', case_id: 'c4', usage_cost_usd: null, attempts_cost_usd: null, created_at: '2026-09-15T08:00:00.000Z' }),
      ],
      'day',
    );

    expect(report.costSeries.map((point) => point.bucket)).toEqual(['2026-09-10', '2026-09-20']);
    expect(report.costSeries[0]?.costUsd).toBeCloseTo(0.04, 10);
    expect(report.costSeries[1]?.costUsd).toBeCloseTo(0.02, 10);
  });

  it('el bucket de día es UTC: 23:30 y 00:30 son días distintos', () => {
    const report = costs([
      completada({ id: 'a', case_id: 'c1', usage_cost_usd: 0.01, attempts_cost_usd: 0.01, created_at: '2026-09-10T23:30:00.000Z' }),
      completada({ id: 'b', case_id: 'c2', usage_cost_usd: 0.01, attempts_cost_usd: 0.01, created_at: '2026-09-11T00:30:00.000Z' }),
    ]);
    expect(report.costSeries.map((point) => point.bucket)).toEqual(['2026-09-10', '2026-09-11']);
  });

  it('mes: agrupa por YYYY-MM', () => {
    const report = costs(
      [
        completada({ id: 'a', case_id: 'c1', usage_cost_usd: 0.01, attempts_cost_usd: 0.01, created_at: '2026-08-31T23:59:59.999Z' }),
        completada({ id: 'b', case_id: 'c2', usage_cost_usd: 0.02, attempts_cost_usd: 0.02, created_at: '2026-09-01T00:00:00.000Z' }),
        completada({ id: 'c', case_id: 'c3', usage_cost_usd: 0.03, attempts_cost_usd: 0.03, created_at: '2026-09-30T12:00:00.000Z' }),
      ],
      'month',
    );

    expect(report.costSeries).toEqual([
      { bucket: '2026-08', costUsd: expect.closeTo(0.01, 10) },
      { bucket: '2026-09', costUsd: expect.closeTo(0.05, 10) },
    ]);
  });

  it('semana: el cruce de año ISO parte donde toca, no donde marca el calendario', () => {
    // 2023-12-31 es DOMINGO: es el último día de 2023-W52.
    // 2024-01-01 es LUNES: arranca 2024-W01.
    // Días consecutivos, semanas distintas, y cada clave lleva SU año ISO.
    const report = costs(
      [
        completada({ id: 'a', case_id: 'c1', usage_cost_usd: 0.01, attempts_cost_usd: 0.01, created_at: '2023-12-31T12:00:00.000Z' }),
        completada({ id: 'b', case_id: 'c2', usage_cost_usd: 0.02, attempts_cost_usd: 0.02, created_at: '2024-01-01T12:00:00.000Z' }),
      ],
      'week',
    );

    expect(report.costSeries.map((point) => point.bucket)).toEqual(['2023-W52', '2024-W01']);
  });

  it('semana: 31 dic y 1 ene caen en la MISMA semana ISO, ya con el año nuevo', () => {
    // El otro borde: 2025-12-31 (miércoles) y 2026-01-01 (jueves) son la misma
    // semana ISO, la semana 1 de 2026. Si se usara el año calendario, el 31 de
    // diciembre se iría solo a `2025-W53` y la serie mostraría un corte que no
    // ocurrió.
    const report = costs(
      [
        completada({ id: 'a', case_id: 'c1', usage_cost_usd: 0.01, attempts_cost_usd: 0.01, created_at: '2025-12-31T23:00:00.000Z' }),
        completada({ id: 'b', case_id: 'c2', usage_cost_usd: 0.02, attempts_cost_usd: 0.02, created_at: '2026-01-01T01:00:00.000Z' }),
      ],
      'week',
    );

    expect(report.costSeries).toEqual([{ bucket: '2026-W01', costUsd: expect.closeTo(0.03, 10) }]);
  });

  it('semana: el 1 de enero puede caer en la semana 53 del año ISO anterior', () => {
    const report = costs(
      [
        completada({ id: 'a', case_id: 'c1', usage_cost_usd: 0.01, attempts_cost_usd: 0.01, created_at: '2021-01-01T12:00:00.000Z' }),
        // 2020 tiene 53 semanas ISO: la última es 2020-W53 (28 dic 2020 – 3 ene 2021).
        completada({ id: 'b', case_id: 'c2', usage_cost_usd: 0.02, attempts_cost_usd: 0.02, created_at: '2020-12-28T12:00:00.000Z' }),
      ],
      'week',
    );

    expect(report.costSeries.map((point) => point.bucket)).toEqual(['2020-W53']);
  });

  it('semana: toda la semana (lunes a domingo) suma en la misma clave', () => {
    const report = costs(
      [
        completada({ id: 'a', case_id: 'c1', usage_cost_usd: 0.01, attempts_cost_usd: 0.01, created_at: '2026-09-14T00:00:00.000Z' }),
        completada({ id: 'b', case_id: 'c2', usage_cost_usd: 0.02, attempts_cost_usd: 0.02, created_at: '2026-09-20T23:59:59.999Z' }),
        // El lunes siguiente ya es otra semana.
        completada({ id: 'c', case_id: 'c3', usage_cost_usd: 0.04, attempts_cost_usd: 0.04, created_at: '2026-09-21T00:00:00.000Z' }),
      ],
      'week',
    );

    expect(report.costSeries).toEqual([
      { bucket: '2026-W38', costUsd: expect.closeTo(0.03, 10) },
      { bucket: '2026-W39', costUsd: expect.closeTo(0.04, 10) },
    ]);
  });
});

describe('aggregateAiCosts — por modelo', () => {
  it('agrupa por modelo y ordena por coste descendente', () => {
    const report = costs([
      completada({ id: 'a', case_id: 'c1', model: 'barato', usage_cost_usd: 0.01, attempts_cost_usd: 0.01 }),
      completada({ id: 'b', case_id: 'c2', model: 'caro', usage_cost_usd: 0.10, attempts_cost_usd: 0.10 }),
      completada({ id: 'c', case_id: 'c3', model: 'caro', usage_cost_usd: 0.05, attempts_cost_usd: 0.05 }),
    ]);

    expect(report.byModel).toEqual([
      { model: 'caro', calls: 2, totalCostUsd: expect.closeTo(0.15, 10), avgCostUsd: expect.closeTo(0.075, 10), costKnownCalls: 2 },
      { model: 'barato', calls: 1, totalCostUsd: expect.closeTo(0.01, 10), avgCostUsd: expect.closeTo(0.01, 10), costKnownCalls: 1 },
    ]);
  });

  it('el orden es determinista: coste, luego llamadas, luego nombre ascendente', () => {
    const report = costs([
      // `b` y `c`: mismo coste, distinto número de llamadas -> gana `b`.
      completada({ id: 'a', case_id: 'c1', model: 'b', usage_cost_usd: 0.05, attempts_cost_usd: 0.05 }),
      completada({ id: 'b', case_id: 'c2', model: 'b', usage_cost_usd: 0.05, attempts_cost_usd: 0.05 }),
      completada({ id: 'c', case_id: 'c3', model: 'a', usage_cost_usd: 0.05, attempts_cost_usd: 0.05 }),
    ]);

    expect(report.byModel.map((item) => item.model)).toEqual(['b', 'a']);
    expect(report.byModel[0]?.calls).toBe(2);
    expect(report.byModel[1]?.calls).toBe(1);
  });

  it('el medio del modelo promedia solo sobre las llamadas con coste conocido', () => {
    const report = costs([
      completada({ id: 'a', case_id: 'c1', model: 'm', usage_cost_usd: 0.10, attempts_cost_usd: 0.10 }),
      // `calls` cuenta la llamada, pero su coste no se conoce: si el medio
      // dividiera entre 2 saldría la mitad de lo que se gastó de verdad.
      completada({ id: 'b', case_id: 'c2', model: 'm', usage_cost_usd: null, attempts_cost_usd: null }),
    ]);

    expect(report.byModel).toEqual([
      { model: 'm', calls: 2, totalCostUsd: expect.closeTo(0.10, 10), avgCostUsd: expect.closeTo(0.10, 10), costKnownCalls: 1 },
    ]);
  });
});

describe('aggregateAiCosts — coste conocido frente a coste desconocido', () => {
  it('cuenta cuántas llamadas tienen coste y el total solo suma esas', () => {
    // Defecto real: un modelo con 5 llamadas de las que solo 3 traen coste. La
    // tabla tiene que poder decir "de 5 llamadas, 3 tienen coste conocido", y el
    // total y el promedio se calculan SOLO sobre esas 3.
    const report = costs([
      completada({ id: 'a', case_id: 'c1', model: 'm', usage_cost_usd: 0.10, attempts_cost_usd: 0.10 }),
      completada({ id: 'b', case_id: 'c2', model: 'm', usage_cost_usd: 0.20, attempts_cost_usd: 0.20 }),
      completada({ id: 'c', case_id: 'c3', model: 'm', usage_cost_usd: 0.30, attempts_cost_usd: 0.30 }),
      completada({ id: 'd', case_id: 'c4', model: 'm', usage_cost_usd: null, attempts_cost_usd: null }),
      completada({ id: 'e', case_id: 'c5', model: 'm', usage_cost_usd: null, attempts_cost_usd: null }),
    ]);

    expect(report.byModel).toEqual([
      {
        model: 'm',
        calls: 5,
        costKnownCalls: 3,
        totalCostUsd: expect.closeTo(0.60, 10),
        // 0.60 / 3, NO 0.60 / 5.
        avgCostUsd: expect.closeTo(0.20, 10),
      },
    ]);
  });

  it('un modelo con todas sus llamadas sin coste: total 0 pero promedio null', () => {
    // Defecto real: auditorías en ERROR, que no traen `usage` ni coste por
    // intento. El 0 del total es la suma de una lista vacía; el promedio no
    // existe, así que es `null` y no un número que la UI pueda imprimir.
    const report = costs([
      fallida({ id: 'a', case_id: 'c1', model: 'm', usage_cost_usd: null, attempts_cost_usd: null }),
      fallida({ id: 'b', case_id: 'c2', model: 'm', usage_cost_usd: null, attempts_cost_usd: null }),
      // Un tercer modelo con coste: el orden por total sigue funcionando aunque
      // el otro tenga `avgCostUsd: null` (comparar null daría NaN).
      completada({ id: 'c', case_id: 'c3', model: 'otro', usage_cost_usd: 0.05, attempts_cost_usd: 0.05 }),
    ]);

    expect(report.byModel).toEqual([
      { model: 'otro', calls: 1, costKnownCalls: 1, totalCostUsd: expect.closeTo(0.05, 10), avgCostUsd: expect.closeTo(0.05, 10) },
      { model: 'm', calls: 2, costKnownCalls: 0, totalCostUsd: 0, avgCostUsd: null },
    ]);
  });

  it('el modelo se agrupa por la clave YA recortada que entrega la vista', () => {
    // Defecto real: `audits.model` guardaba `"google/gemini-2.5-flash "` con un
    // espacio final, y sin el `TRIM(a.model)` de la vista el mismo modelo salía
    // partido en dos filas de "Costo por modelo": una con 10 llamadas y gasto, y
    // otra con 2 llamadas y "coste no reportado".
    //
    // Aquí se fija el CONTRATO del lado TS: el agregador agrupa por la clave que
    // le entrega la vista, y esa clave ya viene recortada. El `.trim()` del test
    // hace de `TRIM(a.model)` para no depender de la base; lo que se comprueba
    // es que las dos filas crudas, una vez normalizadas como las normaliza la
    // vista, caen en la MISMA fila de `byModel` y no en dos.
    const CRUDA_CON_ESPACIO = 'google/gemini-2.5-flash ';
    const CRUDA_SIN_ESPACIO = 'google/gemini-2.5-flash';
    expect(CRUDA_CON_ESPACIO).not.toBe(CRUDA_SIN_ESPACIO);

    const report = costs([
      completada({ id: 'a', case_id: 'c1', model: CRUDA_CON_ESPACIO.trim(), usage_cost_usd: 0.10, attempts_cost_usd: 0.10 }),
      completada({ id: 'b', case_id: 'c2', model: CRUDA_SIN_ESPACIO.trim(), usage_cost_usd: 0.05, attempts_cost_usd: 0.05 }),
      // Sin coste conocido, pero del mismo modelo: suma en `calls` y en
      // `costKnownCalls` NO, que es justo lo que separa los dos papeles.
      completada({ id: 'c', case_id: 'c3', model: CRUDA_CON_ESPACIO.trim(), usage_cost_usd: null, attempts_cost_usd: null }),
    ]);

    expect(report.byModel).toHaveLength(1);
    expect(report.byModel[0]).toMatchObject({
      model: 'google/gemini-2.5-flash',
      calls: 3,
      costKnownCalls: 2,
      totalCostUsd: expect.closeTo(0.15, 10),
      avgCostUsd: expect.closeTo(0.075, 10),
    });
  });
});

describe('aggregateAiCosts — fiabilidad', () => {
  it('cuenta COMPLETED, ERROR, reintentos y fallbacks sobre TODAS las filas', () => {
    const report = costs([
      completada({ id: 'a', case_id: 'c1', attempts_count: 1 }),
      // Completada, reintentada (3 elementos en openrouterAttempts) y con dos
      // modelos distintos: cuenta en los TRES bloques. No son categorías
      // excluyentes, y por eso no deben sumarse.
      completada({
        id: 'b',
        case_id: 'c2',
        attempts_count: 3,
        provider_models: ['google/gemini-2.5-flash-lite', 'google/gemini-2.5-flash'],
      }),
      fallida({ id: 'c', case_id: 'c3', attempts_count: 2, provider_models: ['google/gemini-2.5-flash-lite'] }),
      fallida({ id: 'd', case_id: 'c4', attempts_count: 1, provider_models: ['google/gemini-2.5-flash-lite'] }),
      row({ id: 'e', case_id: 'c5', audit_status: 'RUNNING', case_status: 'AUDITING', result: null, attempts_count: 1 }),
    ]);

    expect(report.reliability).toEqual({
      successful: 2,
      retried: 2,
      fallback: 1,
      failed: 2,
      executionOutcomes: {
        available: true,
        successfulFirstAttempt: 1,
        successfulAfterRetry: 0,
        fallback: 1,
        failed: 2,
        inProgress: 1,
      },
    });
    expect(report.kpi.auditsCounted).toBe(5);
  });

  it('un único intento y un solo modelo no cuentan como reintento ni fallback', () => {
    const report = costs([
      completada({ id: 'a', case_id: 'c1', attempts_count: 1, provider_models: ['solo'] }),
      // `attempts_count` 0 (sin metadata de intentos) tampoco es un reintento.
      completada({ id: 'b', case_id: 'c2', attempts_count: 0, provider_models: null }),
    ]);

    expect(report.reliability).toEqual({
      successful: 2,
      retried: 0,
      fallback: 0,
      failed: 0,
      executionOutcomes: {
        available: true,
        successfulFirstAttempt: 1,
        successfulAfterRetry: 0,
        fallback: 0,
        failed: 0,
        inProgress: 0,
      },
    });
  });
});

describe('aggregateAiCosts — completitud y metadatos', () => {
  it('no marca truncado cuando las filas ya fueron agregadas sin recorte', () => {
    const rows = [completada({ usage_cost_usd: 0.01, attempts_cost_usd: 0.01 })];
    expect(costs(rows, 'day', DASHBOARD_PAGE_SIZE).truncated).toBe(false);
    expect(costs(rows, 'day', DASHBOARD_PAGE_SIZE + 1).truncated).toBe(false);
  });

  it('devuelve los filtros, la granularidad y un generatedAt ISO', () => {
    const report = costs([], 'month');
    expect(report.filters).toEqual(FILTERS);
    expect(report.granularity).toBe('month');
    expect(new Date(report.generatedAt).toISOString()).toBe(report.generatedAt);
  });
});

// -----------------------------------------------------------------------------
// Calidad
// -----------------------------------------------------------------------------

function quality(
  rows: DashboardMetricRow[],
  totalAvailable = rows.length,
  humanReview: HumanReviewInput = sinRevisionHumana(),
) {
  return aggregateQuality(rows, FILTERS, totalAvailable, humanReview);
}

/**
 * Entrada humana por defecto del agregador: ni una revisión registrada ni una
 * comparación. Es el estado de una instalación que todavía no ha revisado nada.
 */
function sinRevisionHumana(): HumanReviewInput {
  return { reviewedCases: 0, comparisons: [], comparisonsAvailable: 0 };
}

/** Fila de `case_comparisons_dashboard_metrics` con valores por defecto válidos. */
function comparacion(overrides: Partial<ComparisonMetricRow> = {}): ComparisonMetricRow {
  return {
    id: 'comparison-1',
    case_review_id: 'review-1',
    case_id: 'case-1',
    case_status: 'COMPLETED',
    audit_result: 'CANCELACION_VENTA',
    status: 'COMPLETED',
    created_at: '2026-09-15T12:00:00.000Z',
    agrees: true,
    confidence: 0.8,
    ...overrides,
  };
}

/**
 * Comparación EN CURSO: la fila existe y tiene deadline, pero todavía no hay
 * veredicto. `agrees` y `confidence` son `null` porque así los escribe
 * `insertComparison`, no porque el modelo haya dicho "no coinciden".
 */
function comparacionEnCurso(overrides: Partial<ComparisonMetricRow> = {}): ComparisonMetricRow {
  return comparacion({ status: 'RUNNING', agrees: null, confidence: null, ...overrides });
}

/** Comparación FALLIDA: `updateComparisonError` limpia `result_json` y no deja veredicto. */
function comparacionFallida(overrides: Partial<ComparisonMetricRow> = {}): ComparisonMetricRow {
  return comparacion({ status: 'ERROR', agrees: null, confidence: null, ...overrides });
}

/** Entrada humana de una instalación que YA tiene revisiones registradas. */
function conRevisiones(reviewedCases: number, comparisons: ComparisonMetricRow[]): HumanReviewInput {
  return { reviewedCases, comparisons, comparisonsAvailable: comparisons.length };
}

/** Dictamen completado con la confianza y la evidencia que se le pasan. */
function conConfianza(confidence: number, missing_evidence_count = 0, overrides: Partial<DashboardMetricRow> = {}) {
  return completada({ confidence, missing_evidence_count, ...overrides });
}

describe('aggregateQuality — bandas de confianza', () => {
  it('trae SIEMPRE las 3 bandas, en orden fijo, aunque valgan 0', () => {
    const sinNada = quality([]);

    expect(sinNada.confidence.bands.map((entry) => entry.band)).toEqual(['ALTA', 'MEDIA', 'BAJA']);
    expect(sinNada.confidence.bands.every((entry) => entry.count === 0)).toBe(true);
    // Sin denominador el porcentaje es 0, no NaN. Una banda en 0 aquí quiere
    // decir "no hay dictámenes", no "confianza cero".
    expect(sinNada.confidence.bands.every((entry) => entry.pct === 0)).toBe(true);
    for (const entry of sinNada.confidence.bands) {
      expect(Number.isFinite(entry.pct)).toBe(true);
    }
  });

  it('un valor por cada banda cae en la suya, con los bordes 0.85 y 0.60', () => {
    const report = quality([
      conConfianza(0.98, 0, { id: 'a', case_id: 'ca' }),
      conConfianza(0.85, 0, { id: 'b', case_id: 'cb' }), // borde exacto de ALTA
      conConfianza(0.84, 0, { id: 'c', case_id: 'cc' }),
      conConfianza(0.6, 0, { id: 'd', case_id: 'cd' }), // borde exacto de MEDIA
      conConfianza(0.59, 0, { id: 'e', case_id: 'ce' }),
    ]);

    // Los bordes usan `>=`, igual que `confidenceBand`: 0.85 es ALTA y 0.60 es
    // MEDIA. Si el umbral se moviera a `>`, estas dos filas saltarían de banda.
    expect(report.confidence.bands).toEqual([
      { band: 'ALTA', label: 'Alta', count: 2, pct: 40 },
      { band: 'MEDIA', label: 'Media', count: 2, pct: 40 },
      { band: 'BAJA', label: 'Baja', count: 1, pct: 20 },
    ]);
  });

  it('el reparto coincide con confidenceBand fila por fila', () => {
    const valores = [0.9, 0.85, 0.7, 0.6, 0.59, 0.2];
    const report = quality(
      valores.map((confidence, i) => conConfianza(confidence, 0, { id: `a${i}`, case_id: `c${i}` })),
    );

    for (const entry of report.confidence.bands) {
      const esperados = valores.filter((value) => confidenceBand(value) === entry.band).length;
      expect(entry.count).toBe(esperados);
    }
  });

  it('los porcentajes suman 100 y `auditedCases` es el denominador', () => {
    // 5 / 3 / 2 reparte exacto, para que la suma sea 100 y el test no dependa
    // del redondeo a 1 decimal (3/3/3 daría 99.9 y fallaría sin motivo real).
    const report = quality([
      ...Array.from({ length: 5 }, (_, i) => conConfianza(0.95, 0, { id: `h${i}`, case_id: `h${i}` })),
      ...Array.from({ length: 3 }, (_, i) => conConfianza(0.7, 0, { id: `m${i}`, case_id: `m${i}` })),
      ...Array.from({ length: 2 }, (_, i) => conConfianza(0.3, 0, { id: `l${i}`, case_id: `l${i}` })),
    ]);

    expect(report.confidence.auditedCases).toBe(10);
    expect(report.confidence.bands.map((entry) => entry.count).reduce((a, b) => a + b, 0)).toBe(10);
    expect(report.confidence.bands.map((entry) => entry.pct).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('aggregateQuality — confianza media', () => {
  it('promedia a 3 decimales', () => {
    // (0.91 + 0.72 + 0.31) / 3 = 0.64666… -> 0.647
    const report = quality([
      conConfianza(0.91, 0, { id: 'a', case_id: 'ca' }),
      conConfianza(0.72, 0, { id: 'b', case_id: 'cb' }),
      conConfianza(0.31, 0, { id: 'c', case_id: 'cc' }),
    ]);

    expect(report.confidence.avgConfidence).toBe(0.647);
  });

  it('sin dictámenes con confianza la media es null, no 0', () => {
    // La media de una lista vacía no es cero: no hay nada que promediar, así que
    // el dato NO EXISTE. Un 0 aquí publicaría "confianza cero" en un periodo que
    // en realidad no tiene dictámenes.
    const report = quality([]);

    expect(report.confidence.avgConfidence).toBeNull();
    expect(report.confidence.auditedCases).toBe(0);
  });
});

describe('aggregateQuality — solo cuenta dictámenes reales', () => {
  it('auditedCases cuenta solo COMPLETED con confianza, no ERROR ni RUNNING', () => {
    const report = quality([
      conConfianza(0.9, 0, { id: 'a', case_id: 'ca' }),
      conConfianza(0.8, 0, { id: 'b', case_id: 'cb' }),
      // ERROR: `confidence` trae el valor por defecto de la fila, pero no emitió
      // dictamen. Contarla bajaría la media con una confianza que no existe.
      fallida({ id: 'c', case_id: 'cc', confidence: 0.1 }),
      // RUNNING: todavía no hay dictamen.
      row({ id: 'd', case_id: 'cd', audit_status: 'RUNNING', case_status: 'AUDITING', result: null, confidence: 0.1 }),
      // COMPLETED sin confianza declarada: el dato no existe.
      completada({ id: 'e', case_id: 'ce', confidence: null }),
    ]);

    expect(report.confidence.auditedCases).toBe(2);
    expect(report.confidence.avgConfidence).toBe(0.85);
    // Nada de lo anterior aparece en ninguna banda: 0.9 es ALTA y 0.8 es MEDIA
    // (por debajo del umbral 0.85), y ni la fila en ERROR ni la en RUNNING suman.
    expect(report.confidence.bands.map((entry) => entry.count)).toEqual([1, 1, 0]);
  });

  it('una confianza ausente NO se cuela como banda baja', () => {
    // `confidenceBand(null)` es `null`: la ausencia de confianza no es baja
    // confianza. Si se contara como BAJA, la gráfica diría "el modelo no se
    // siente confident" cuando lo que pasó es que no dijo nada.
    expect(confidenceBand(null)).toBeNull();
    const report = quality([completada({ id: 'a', case_id: 'ca', confidence: null })]);

    expect(report.confidence.auditedCases).toBe(0);
    expect(report.confidence.bands.map((entry) => entry.count)).toEqual([0, 0, 0]);
  });
});

describe('aggregateQuality — confianza según evidencia faltante', () => {
  it('trae los 3 buckets cuando hay filas en los 3, en orden fijo', () => {
    const report = quality([
      conConfianza(0.95, 0, { id: 'a', case_id: 'a' }),
      conConfianza(0.90, 0, { id: 'b', case_id: 'b' }),
      conConfianza(0.70, 1, { id: 'c', case_id: 'c' }),
      conConfianza(0.40, 2, { id: 'd', case_id: 'd' }),
      // 3 y 7 también caen en "2 o más": el bucket agrupa la cola.
      conConfianza(0.30, 3, { id: 'e', case_id: 'e' }),
      conConfianza(0.20, 7, { id: 'f', case_id: 'f' }),
    ]);

    expect(report.confidence.confidenceByMissingEvidence).toEqual([
      { bucket: '0', label: 'Expediente completo', count: 2, avgConfidence: 0.925 },
      { bucket: '1', label: 'Falta 1 evidencia', count: 1, avgConfidence: 0.7 },
      { bucket: '2+', label: 'Faltan 2 o más', count: 3, avgConfidence: 0.3 },
    ]);
    // Los 6 dictámenes con confianza salen por los tres buckets: nada se pierde.
    const total = report.confidence.confidenceByMissingEvidence.reduce((acc, bucket) => acc + bucket.count, 0);
    expect(total).toBe(report.confidence.auditedCases);
  });

  it('solo incluye los buckets CON filas: un bucket vacío no es un 0', () => {
    // En este periodo no hay ningún expediente completo. Ponerlo con
    // `avgConfidence: 0` afirmaría "con expediente completo la confianza media es
    // 0 %", que es falso: es que no hay ninguno.
    const report = quality([
      conConfianza(0.7, 1, { id: 'a', case_id: 'a' }),
      conConfianza(0.5, 1, { id: 'b', case_id: 'b' }),
      conConfianza(0.3, 4, { id: 'c', case_id: 'c' }),
    ]);

    expect(report.confidence.confidenceByMissingEvidence.map((bucket) => bucket.bucket)).toEqual(['1', '2+']);
    expect(report.confidence.confidenceByMissingEvidence[0]).toEqual({
      bucket: '1',
      label: 'Falta 1 evidencia',
      count: 2,
      avgConfidence: 0.6,
    });
  });

  it('missing_evidence_count ausente se trata como expediente completo', () => {
    // Igual que `recentCases` normaliza a 0: si no, la fila desaparecería del
    // reparto y su confianza dejaría de contar en la media.
    const report = quality([completada({ id: 'a', case_id: 'ca', confidence: 0.88, missing_evidence_count: null })]);

    expect(report.confidence.confidenceByMissingEvidence).toEqual([
      { bucket: '0', label: 'Expediente completo', count: 1, avgConfidence: 0.88 },
    ]);
  });

  it('sin dictámenes no hay buckets, y no hay NaN en ninguna parte', () => {
    const report = quality([]);

    expect(report.confidence.confidenceByMissingEvidence).toEqual([]);
    for (const bucket of report.confidence.confidenceByMissingEvidence) {
      expect(bucket.avgConfidence === null || Number.isFinite(bucket.avgConfidence)).toBe(true);
    }
  });
});

// -----------------------------------------------------------------------------
// Parte humana: la coincidencia IA/humano, y POR QUÉ `null` no es `0`
//
// La regla de este bloque entero: una magnitud que no se ha MEDIDO no se
// rellena con 0. Un `agreementRate: 0` afirmaría "hubo cero coincidencias", y
// eso es falso cuando lo que pasa es que nadie comparó. El mismo motivo por el
// que la vista `audit_dashboard_metrics` distingue NULL de 0 en las columnas de
// coste, y por el que hay un test que fija esa tripleta más arriba en este
// archivo.
// -----------------------------------------------------------------------------

describe('aggregateHumanReview — sin nada que comparar', () => {
  it('sin revisiones: available false y los dos promedios en null, NUNCA en 0', () => {
    const report = aggregateHumanReview(sinRevisionHumana());

    expect(report.available).toBe(false);
    expect(report.reviewedCases).toBe(0);
    expect(report.completedComparisons).toBe(0);
    expect(report.pendingComparisons).toBe(0);
    expect(report.failedComparisons).toBe(0);
    expect(report.agreements).toBe(0);
    expect(report.disagreements).toBe(0);
    // LA REGLA: sin comparaciones completadas, el promedio NO EXISTE.
    expect(report.agreementRate).toBeNull();
    expect(report.avgComparisonConfidence).toBeNull();
  });

  it('el null sobrevive a la serialización: un 0 aquí publicaría una tasa inventada', () => {
    // El `null` sólo sirve de algo si llega como `null` al navegador. Si algún
    // serializador lo convirtiera en 0, la tarjeta pintaría "0 % de coincidencia"
    // sin que nadie lo afirmara: aquí se comprueba el viaje entero.
    const wire = JSON.parse(JSON.stringify(aggregateHumanReview(sinRevisionHumana()))) as {
      agreementRate: unknown;
      avgComparisonConfidence: unknown;
    };

    expect(wire.agreementRate).toBeNull();
    expect(wire.avgComparisonConfidence).toBeNull();
  });

  it('muchos dictámenes tampoco crean revisión humana: son dos fuentes distintas', () => {
    // 40 dictámenes con confianza 0.9 no producen ni una comparación: la
    // confianza la declara el modelo al auditar, la revisión la registra una
    // persona. Que la primera tarjeta exista no significa que la segunda sepa
    // algo.
    const rows = Array.from({ length: 40 }, (_, i) => conConfianza(0.9, 0, { id: `a${i}`, case_id: `c${i}` }));
    const report = quality(rows);

    expect(report.confidence.auditedCases).toBe(40);
    expect(report.humanReview.available).toBe(false);
    expect(report.humanReview.agreementRate).toBeNull();
  });
});

describe('aggregateHumanReview — sólo las comparaciones COMPLETED cuentan', () => {
  it('una comparación RUNNING es pendiente, no un desacuerdo', () => {
    const report = aggregateHumanReview(conRevisiones(1, [comparacionEnCurso()]));

    expect(report.available).toBe(true);
    expect(report.pendingComparisons).toBe(1);
    expect(report.completedComparisons).toBe(0);
    // Ni acuerdo ni desacuerdo: la comparación aún no existe como veredicto.
    expect(report.agreements).toBe(0);
    expect(report.disagreements).toBe(0);
    // Y por eso la tasa NO existe: un 0 affirmaría que la IA discrepó siempre.
    expect(report.agreementRate).toBeNull();
    expect(report.avgComparisonConfidence).toBeNull();
  });

  it('una comparación ERROR es fallida, y tampoco cuenta en la tasa', () => {
    const report = aggregateHumanReview(conRevisiones(1, [comparacionFallida()]));

    expect(report.failedComparisons).toBe(1);
    expect(report.completedComparisons).toBe(0);
    expect(report.pendingComparisons).toBe(0);
    expect(report.disagreements).toBe(0);
    expect(report.agreementRate).toBeNull();
    expect(report.avgComparisonConfidence).toBeNull();
  });

  it('3 completadas con 2 coincidencias: tasa y confianza media sobre esas 3', () => {
    const report = aggregateHumanReview(
      conRevisiones(3, [
        comparacion({ id: 'a', case_review_id: 'r-a', agrees: true, confidence: 0.9 }),
        comparacion({ id: 'b', case_review_id: 'r-b', agrees: true, confidence: 0.7 }),
        comparacion({ id: 'c', case_review_id: 'r-c', agrees: false, confidence: 0.5 }),
      ]),
    );

    expect(report.completedComparisons).toBe(3);
    expect(report.agreements).toBe(2);
    expect(report.disagreements).toBe(1);
    // 2/3 redondeado a 3 decimales, como las medias de confianza del informe.
    expect(report.agreementRate).toBe(0.667);
    // (0.9 + 0.7 + 0.5) / 3 = 0.7
    expect(report.avgComparisonConfidence).toBe(0.7);
  });

  it('las RUNNING y ERROR no se cuelan en la media de confianza', () => {
    // `confidence` en 0.99 de una fila en curso o fallida es ruido: la fila no
    // trae veredicto (así la escribe `reviews.ts`), y promediarlo bajaría la
    // confianza media de la comparación con un dato que no existe.
    const report = aggregateHumanReview(
      conRevisiones(3, [
        comparacion({ id: 'a', agrees: true, confidence: 0.6 }),
        comparacionEnCurso({ id: 'b', agrees: true, confidence: 0.99 }),
        comparacionFallida({ id: 'c', agrees: false, confidence: 0.99 }),
      ]),
    );

    expect(report.completedComparisons).toBe(1);
    expect(report.avgComparisonConfidence).toBe(0.6);
    expect(report.agreementRate).toBe(1);
  });

  it('una COMPLETED con `agrees` ausente cuenta como completada y NO como desacuerdo', () => {
    // La fila AFIRMA que terminó, así que cuenta como completada: es lo que dice
    // su `status`. No aportar ni acuerdo ni desacuerdo es lo único honesto,
    // porque `disagreements: 1` publicaría una discrepancia que nadie registró.
    // Y la tasa sale 0 porque, entre las comparaciones completadas, ninguna
    // afirmo coincidencia. Es una forma defensiva: `updateComparisonResult`
    // sólo escribe un `result_json` que ya pasó `ComparisonResultSchema`, así
    // que `agrees` siempre está.
    const report = aggregateHumanReview(conRevisiones(1, [comparacion({ agrees: null, confidence: null })]));

    expect(report.completedComparisons).toBe(1);
    expect(report.agreements).toBe(0);
    expect(report.disagreements).toBe(0);
    expect(report.agreementRate).toBe(0);
    // La confianza ausente SÍ es un dato ausente: esa media no existe.
    expect(report.avgComparisonConfidence).toBeNull();
  });

  it('acuerdo más desacuerdo cuadra con las completadas cuando todas traen veredicto', () => {
    const report = aggregateHumanReview(
      conRevisiones(5, [
        ...Array.from({ length: 3 }, (_, i) => comparacion({ id: `y${i}`, agrees: true })),
        ...Array.from({ length: 2 }, (_, i) => comparacion({ id: `n${i}`, agrees: false })),
        comparacionEnCurso({ id: 'p0' }),
        comparacionFallida({ id: 'f0' }),
      ]),
    );

    expect(report.agreements + report.disagreements).toBe(report.completedComparisons);
    expect(report.agreementRate).toBe(0.6);
  });
});

describe('aggregateHumanReview — el mensaje describe el estado real', () => {
  it('el texto exacto del estado "todavía no hay revisión"', () => {
    // Se fija COMPLETO a propósito: la UI lo pinta tal cual y este es el texto
    // que explica por qué las tarjetas salen con "—". Si cambia, cambia a
    // propósito, no por accidente.
    expect(aggregateHumanReview(sinRevisionHumana()).message).toBe(
      'Todavía no hay ninguna revisión humana registrada en el periodo, así que no hay nada que comparar: ' +
        'la coincidencia entre el dictamen de la IA y la decisión de una persona no se puede calcular. ' +
        'Se muestra únicamente lo que sí existe: la confianza declarada por el modelo en cada dictamen.',
    );
  });

  it('cambia entre "sin revisiones" y "revisiones sin comparación completada"', () => {
    const sinNada = aggregateHumanReview(sinRevisionHumana());
    const pendientes = aggregateHumanReview(
      conRevisiones(2, [comparacionEnCurso({ id: 'a' }), comparacionEnCurso({ id: 'b', case_review_id: 'review-2' })]),
    );

    expect(pendientes.message).not.toBe(sinNada.message);
    expect(sinNada.message).toContain('revisión humana');
    // Y el texto nuevo nombra números que el servidor acaba de calcular: un
    // mensaje que no puede respaldar no debe publicarse.
    expect(pendientes.message).toContain('2 revisiones humanas');
    expect(pendientes.message).toContain('2 comparaciones en curso');
    expect(pendientes.message).toContain('no se puede calcular');
  });

  it('distingue "en curso" de "falló": no son el mismo estado', () => {
    const enCurso = aggregateHumanReview(conRevisiones(1, [comparacionEnCurso()]));
    const fallidas = aggregateHumanReview(conRevisiones(1, [comparacionFallida()]));

    expect(enCurso.message).toContain('en curso');
    expect(enCurso.message).not.toContain('fallaron');
    expect(fallidas.message).toContain('fallaron');
    expect(fallidas.message).not.toContain('en curso');
  });

  it('con revisiones pero sin ninguna comparación, lo dice', () => {
    // Una revisión sin fila de comparación es un tercer estado, distinto de "en
    // curso" y de "falló": no hay nada en curso porque no se empezó nada.
    const report = aggregateHumanReview(conRevisiones(3, []));

    expect(report.available).toBe(true);
    expect(report.message).toContain('3 revisiones humanas');
    expect(report.message).toContain('ninguna tiene comparación');
  });

  it('con comparaciones completadas, el mensaje dice sobre cuáles se midió', () => {
    const report = aggregateHumanReview(
      conRevisiones(4, [
        comparacion({ id: 'a', case_review_id: 'r-a', agrees: true }),
        comparacion({ id: 'b', case_review_id: 'r-b', agrees: true }),
        comparacionEnCurso({ id: 'p0', case_review_id: 'r-c' }),
        comparacionFallida({ id: 'f0', case_review_id: 'r-d' }),
      ]),
    );

    expect(report.message).toContain('2 comparaciones completadas');
    expect(report.message).toContain('1 comparación en curso');
    expect(report.message).toContain('1 fallida');
    expect(report.message).toContain('no cuentan ni como acuerdo ni como desacuerdo');
  });

  it('sin pendientes ni fallidas, el mensaje no inventa categorías vacías', () => {
    const report = aggregateHumanReview(conRevisiones(1, [comparacion()]));

    expect(report.message).toContain('1 comparación completada');
    expect(report.message).not.toContain('en curso');
    expect(report.message).not.toContain('fallida');
  });

  it('con completadas y sólo en curso, tampoco nombra las fallidas', () => {
    // El caso que faltaba y que un enumerado ingenuo rompía: al construir la
    // lista de estados, la rama "hay completadas y alguna más" empujaba SIEMPRE
    // el recuento de fallidas, así que un periodo con 1 completada y 1 en curso
    // publicaba "y 0 fallidas". Es la misma mentira del 0 en su forma más
    // pequeña: nombrar un estado que no ocurrió hace que quien lea busque un
    // fallo que no existe, y por eso la categoría sólo aparece si hay filas.
    const soloEnCurso = aggregateHumanReview(
      conRevisiones(2, [comparacion({ id: 'a' }), comparacionEnCurso({ id: 'b' })]),
    );

    expect(soloEnCurso.completedComparisons).toBe(1);
    expect(soloEnCurso.pendingComparisons).toBe(1);
    expect(soloEnCurso.failedComparisons).toBe(0);
    expect(soloEnCurso.message).toContain('1 comparación completada');
    expect(soloEnCurso.message).toContain('1 comparación en curso');
    expect(soloEnCurso.message).not.toContain('fallida');
    // Ningún "0 " en el texto: un recuento de cero escrito en prosa es un 0
    // disfrazado, y aquí significaría un estado que no ocurrió.
    expect(soloEnCurso.message).not.toContain('0 ');
  });

  it('con completadas y sólo fallidas, tampoco nombra las que están en curso', () => {
    const soloFallidas = aggregateHumanReview(
      conRevisiones(2, [comparacion({ id: 'a' }), comparacionFallida({ id: 'b' })]),
    );

    expect(soloFallidas.message).toContain('1 comparación completada');
    expect(soloFallidas.message).toContain('1 fallida');
    expect(soloFallidas.message).not.toContain('en curso');
    expect(soloFallidas.message).not.toContain('0 ');
  });

  it('es español legible, largo y sin NaN ni undefined en ningún estado', () => {
    const informes = [
      aggregateHumanReview(sinRevisionHumana()),
      aggregateHumanReview(conRevisiones(1, [comparacionEnCurso()])),
      aggregateHumanReview(conRevisiones(1, [comparacionFallida()])),
      aggregateHumanReview(conRevisiones(1, [])),
      aggregateHumanReview(conRevisiones(1, [comparacion()])),
    ];

    for (const report of informes) {
      expect(report.message.length).toBeGreaterThan(100);
      expect(report.message).not.toMatch(/NaN|undefined|null/);
      expect(report.message).toMatch(/[.]$/);
    }
  });
});

describe('aggregateQuality — la parte humana viaja dentro del informe', () => {
  it('el bloque humano NO depende de las filas de auditoría', () => {
    // Cero filas y mil filas dan el MISMO bloque humano: lo que hay que leer es
    // `humanReview`, no `rows`. Si algún día se mezclaran, mover el periodo de
    // la barra de filtros cambiaría la coincidencia por un efecto secundario.
    expect(quality([]).humanReview).toEqual(
      quality(Array.from({ length: 1000 }, (_, i) => conConfianza(0.9, 0, { id: `a${i}`, case_id: `c${i}` })))
        .humanReview,
    );
  });

  it('las comparaciones del periodo conviven con la confianza sin mezclarse', () => {
    const report = quality([conConfianza(0.8, 0, { id: 'a', case_id: 'ca' })], 1, conRevisiones(1, [comparacion()]));

    expect(report.confidence.auditedCases).toBe(1);
    expect(report.confidence.avgConfidence).toBe(0.8);
    expect(report.humanReview.completedComparisons).toBe(1);
    expect(report.humanReview.agreementRate).toBe(1);
    // La confianza de la COMPARACIÓN y la del DICTAMEN son dos magnitudes
    // distintas: una la declara el modelo al comparar, la otra al auditar.
    expect(report.humanReview.avgComparisonConfidence).toBe(0.8);
  });
});

describe('aggregateQuality — completitud y metadatos', () => {
  it('no marca truncado para auditorías o comparaciones cargadas completas', () => {
    const rows = [conConfianza(0.9, 0)];

    expect(quality(rows, DASHBOARD_PAGE_SIZE).truncated).toBe(false);
    expect(quality(rows, DASHBOARD_PAGE_SIZE + 1).truncated).toBe(false);
    // La parte humana tiene su propio tope: si se recortó ÉSTA, la tarjeta
    // tiene que decirlo, porque su tasa se calculó sobre menos comparaciones.
    const truncada: HumanReviewInput = {
      reviewedCases: 3,
      comparisons: [comparacion()],
      comparisonsAvailable: DASHBOARD_PAGE_SIZE + 1,
    };
    expect(quality(rows, 1, truncada).truncated).toBe(false);
  });

  it('devuelve los filtros aplicados y un generatedAt ISO', () => {
    const report = quality([]);
    expect(report.filters).toEqual(FILTERS);
    expect(new Date(report.generatedAt).toISOString()).toBe(report.generatedAt);
  });
});
