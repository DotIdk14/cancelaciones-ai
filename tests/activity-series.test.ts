import { describe, expect, it } from 'vitest';
import { aggregateActivitySeries } from '../src/server/dashboard-activity';
import type { DashboardMetricRow } from '../src/server/dashboard-contracts';

const row = (overrides: Partial<DashboardMetricRow> = {}): DashboardMetricRow => ({
  id: 'a', case_id: 'c', created_at: '2026-10-13T20:00:00Z', audit_status: 'COMPLETED',
  attempts_count: 1, attempts_cost_usd: 0.02, attempts_total_tokens: 100,
  ...overrides,
} as DashboardMetricRow);

describe('series reales de actividad', () => {
  it('separa ejecuciones de auditoría y comparación sin duplicar consumo agregado', () => {
    const points = aggregateActivitySeries([row({ usage_is_aggregate: true, usage_total_tokens: 200, usage_cost_usd: 0.02 })], [row({ id: 'comparison', attempts_cost_usd: 0.01 })], 'day');
    expect(points[0]).toMatchObject({ bucket: '2026-10-13', audits: 1, comparisons: 1, tokens: 300, knownCostUsd: 0.03, avgCostPerAuditUsd: 0.02 });
  });
  it('consumo incompleto no se convierte en tokens cero ni en promedio conocido', () => {
    expect(aggregateActivitySeries([row({ tokens_incomplete: true, cost_incomplete: true })], [], 'day')[0]).toMatchObject({ tokens: null, avgCostPerAuditUsd: null, unknownCostExecutions: 1 });
    expect(aggregateActivitySeries([row({ usage_is_aggregate: true, usage_total_tokens: null })], [], 'day')[0]?.tokens).toBeNull();
  });
  it('agrupa por lunes UTC y mes sin inventar filas', () => {
    expect(aggregateActivitySeries([row()], [], 'week')[0]?.bucket).toBe('2026-10-12');
    expect(aggregateActivitySeries([row()], [], 'month')[0]?.bucket).toBe('2026-10');
    expect(aggregateActivitySeries([], [], 'day')).toEqual([]);
  });
});
