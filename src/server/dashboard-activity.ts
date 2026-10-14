import type { ActivityMetrics, MonthlyActivity } from '../lib/dashboard-metrics-contracts.js';
import type { DashboardMetricRow } from './dashboard-contracts.js';
import { COST_PER_ROW } from './dashboard-costs.js';

/** Un registro por ejecución durable, nunca por expediente. Solo suma consumo conocido. */
export function aggregateActivity(rows: DashboardMetricRow[]): ActivityMetrics {
  const cases = new Set(rows.map(row => row.case_id));
  const costs = rows.map(COST_PER_ROW);
  const known = costs.filter((cost): cost is number => cost !== null && Number.isFinite(cost));
  const knownCostUsd = known.reduce((sum, cost) => sum + cost, 0);
  const unknown = rows.filter((row, index) => costs[index] === null || row.cost_incomplete === true).length;
  return {
    executions: rows.length,
    completed: rows.filter(row => row.audit_status === 'COMPLETED').length,
    failed: rows.filter(row => row.audit_status === 'ERROR').length,
    running: rows.filter(row => row.audit_status === 'RUNNING').length,
    uniqueCases: cases.size,
    uniqueStudents: new Set(rows.map(row => row.student_identifier).filter(Boolean)).size,
    uniqueCaveTickets: new Set(rows.map(row => row.external_case_id).filter(Boolean)).size,
    reaudits: rows.filter(row => row.is_reaudit === true).length,
    retried: rows.filter(row => row.attempts_count > 1 || (row.attempt_number ?? 1) > 1).length,
    fallback: rows.filter(row => (row.provider_models?.length ?? 0) > 1).length,
    providerCalls: rows.reduce((sum, row) => sum + (row.attempts_count ?? 0), 0),
    executionsWithoutCallTrace: rows.filter(row => !row.attempts_count).length,
    tokens: rows.reduce((sum, row) => sum + (row.usage_is_aggregate ? row.usage_total_tokens ?? 0 : row.attempts_total_tokens ?? row.usage_total_tokens ?? 0), 0),
    executionsWithoutTokenTrace: rows.filter(row => row.tokens_incomplete || (row.usage_is_aggregate ? row.usage_total_tokens : row.attempts_total_tokens ?? row.usage_total_tokens) == null).length,
    knownCostUsd,
    executionsWithUnknownCost: unknown,
    // Promedios completos solo si el universo tiene consumo conocido en todas sus ejecuciones.
    avgKnownCostPerExecutionUsd: !rows.length || unknown ? null : knownCostUsd / rows.length,
    avgKnownCostPerCaseUsd: !cases.size || unknown ? null : knownCostUsd / cases.size,
  };
}

export function aggregateMonthlyActivity(audits: DashboardMetricRow[], comparisons: DashboardMetricRow[], granularity: 'day' | 'week' | 'month' = 'day'): MonthlyActivity {
  const a = aggregateActivity(audits);
  const c = aggregateActivity(comparisons);
  return { timezone: 'UTC', audits: a, comparisons: c, knownTotalCostUsd: a.knownCostUsd + c.knownCostUsd,
    unknownCostExecutions: a.executionsWithUnknownCost + c.executionsWithUnknownCost, estimatedCostUsd: null,
    series: aggregateActivitySeries(audits, comparisons, granularity) };
}

/** Agrupa solo filas existentes. Un consumo parcial conserva su aviso; nunca se estima. */
export function aggregateActivitySeries(audits: DashboardMetricRow[], comparisons: DashboardMetricRow[], granularity: 'day' | 'week' | 'month') {
  const groups = new Map<string, { audits: DashboardMetricRow[]; comparisons: DashboardMetricRow[] }>();
  for (const [kind, rows] of [['audits', audits], ['comparisons', comparisons]] as const) {
    for (const row of rows) {
      const date = new Date(row.created_at);
      if (!Number.isFinite(date.getTime())) continue;
      if (granularity === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
      const bucket = date.toISOString().slice(0, granularity === 'month' ? 7 : 10);
      const group = groups.get(bucket) ?? { audits: [], comparisons: [] };
      group[kind].push(row); groups.set(bucket, group);
    }
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([bucket, rows]) => {
    const a = aggregateActivity(rows.audits), c = aggregateActivity(rows.comparisons);
    return { bucket, audits: a.executions, completed: a.completed, comparisons: c.executions,
      tokens: a.executionsWithoutTokenTrace + c.executionsWithoutTokenTrace ? null : a.tokens + c.tokens,
      knownCostUsd: [...rows.audits, ...rows.comparisons].some(row => COST_PER_ROW(row) !== null) ? a.knownCostUsd + c.knownCostUsd : null,
      unknownCostExecutions: a.executionsWithUnknownCost + c.executionsWithUnknownCost,
      avgCostPerAuditUsd: a.avgKnownCostPerExecutionUsd };
  });
}
