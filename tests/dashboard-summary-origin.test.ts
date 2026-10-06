import { describe, expect, it } from 'vitest';
import type { DashboardFilters } from '../src/lib/dashboard-shared';
import { aggregateSummary, type DashboardMetricRow } from '../src/server/dashboard';

const BASE: DashboardFilters = { from: '2026-09-01', to: '2026-09-30', result: null, status: null };

function metricRow(overrides: Partial<DashboardMetricRow> = {}): DashboardMetricRow {
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

/** Un caso por fila: `currentAuditsByCase` colapsa por `case_id`. */
function caseRow(index: number, overrides: Partial<DashboardMetricRow> = {}): DashboardMetricRow {
  return metricRow({ id: `audit-${index}`, case_id: `case-${index}`, ...overrides });
}

describe('aggregateSummary — distribución de origen', () => {
  it('cuenta por país, ordena por frecuencia y deja "Sin determinar" al final', () => {
    const rows = [
      caseRow(1, { country: 'MX' }),
      caseRow(2, { country: 'MX' }),
      caseRow(3, { country: 'MX' }),
      caseRow(4, { country: 'CO' }),
      caseRow(5, { country: null }),
    ];

    const { byCountry } = aggregateSummary(rows, BASE, rows.length);

    expect(byCountry.points).toEqual([
      { value: 'MX', label: 'México', count: 3 },
      { value: 'CO', label: 'Colombia', count: 1 },
      { value: 'Sin determinar', label: 'Sin determinar', count: 1 },
    ]);
  });

  it('totalWithOrigin cuenta solo los casos con valor determinado', () => {
    const rows = [
      caseRow(1, { country: 'MX' }),
      caseRow(2, { country: 'MX' }),
      caseRow(3, { country: 'CO' }),
      caseRow(4, { country: null }),
    ];

    const { byCountry } = aggregateSummary(rows, BASE, rows.length);

    expect(byCountry.totalWithOrigin).toBe(3);
  });

  it('sin ningún valor determinado devuelve un único punto "Sin determinar", no una lista vacía', () => {
    // Un `[]` haría que el gráfico se viera igual que "no hay datos", cuando en
    // realidad sí hay: el resultado es que el origen no es determinable.
    const rows = [caseRow(1, { channel: null }), caseRow(2, { channel: null })];

    const { byChannel } = aggregateSummary(rows, BASE, rows.length);

    expect(byChannel.points).toEqual([
      { value: 'Sin determinar', label: 'Sin determinar', count: 2 },
    ]);
    expect(byChannel.totalWithOrigin).toBe(0);
  });

  it('un caso en curso no cuenta en la distribución, pero sí aparece en recientes', () => {
    const rows = [
      caseRow(1, { country: 'MX' }),
      caseRow(2, { country: 'CO', audit_status: 'RUNNING', result: null, confidence: null }),
    ];

    const summary = aggregateSummary(rows, BASE, rows.length);

    expect(summary.byCountry.points).toEqual([{ value: 'MX', label: 'México', count: 1 }]);
    expect(summary.recentCases.map((row) => row.caseId).sort()).toEqual(['case-1', 'case-2']);
  });

  it('recentCases propaga el país y el canal crudos, y su etiqueta resuelve el null', () => {
    const rows = [caseRow(1, { country: 'MX', channel: 'WHATSAPP' }), caseRow(2, { country: null, channel: 'CRM' })];

    const summary = aggregateSummary(rows, BASE, rows.length);
    const byCase = new Map(summary.recentCases.map((row) => [row.caseId, row]));

    expect(byCase.get('case-1')?.country).toBe('MX');
    expect(byCase.get('case-1')?.channel).toBe('WHATSAPP');
    expect(byCase.get('case-2')?.country).toBeNull();
    expect(byCase.get('case-2')?.channel).toBe('CRM');
  });

  it('un canal fuera del catálogo se muestra con su valor crudo', () => {
    const rows = [caseRow(1, { channel: 'SMS' })];

    const { byChannel } = aggregateSummary(rows, BASE, rows.length);

    expect(byChannel.points).toEqual([{ value: 'SMS', label: 'SMS', count: 1 }]);
  });
});