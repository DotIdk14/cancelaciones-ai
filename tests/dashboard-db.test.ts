// =============================================================================
// Capa de datos del dashboard: qué consulta se construye y cómo se traducen
// los errores del proveedor.
//
// `tests/dashboard.test.ts` prueba la AGREGACIÓN pura. Aquí se prueba lo que
// ocurre antes: que se lea la vista `audit_dashboard_metrics` (y no las tablas
// crudas), que el rango use límites de día UTC, que cada filtro opcional se
// aplique solo cuando corresponde, y —el punto que más se puede romper en
// silencio— que `getAiCosts` NUNCA filtre por `result`.
//
// El cliente falso registra la cadena de la consulta, así que estos tests
// fallan si alguien cambia el SQL o el orden de los filtros.
// =============================================================================

import { describe, expect, it } from 'vitest';
import type { DashboardFilters } from '../src/lib/dashboard';
import type { InsForgeClient } from '../src/server/insforge';
import type { InsForgeClient as SdkClient } from '../src/server/insforge';
import {
  DASHBOARD_MAX_ROWS,
  getAiCosts,
  getAiQuality,
  getDashboardSummary,
  type DashboardMetricRow,
} from '../src/server/dashboard';

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
    ...overrides,
  };
}

interface RecordedQuery {
  table: string;
  select: string | null;
  eqs: Array<[string, unknown]>;
  gte: Array<[string, unknown]>;
  lte: Array<[string, unknown]>;
  order: Array<[string, unknown]>;
  limit: number | null;
}

interface FakeOptions {
  rows?: DashboardMetricRow[];
  count?: number;
  error?: { message?: string; code?: string } | null;
}

/**
 * Cliente InsForge mínimo que registra la cadena de consulta construida.
 * `select` y los métodos de encadenado devuelven `this`; al hacer `await` se
 * resuelve con `{ data, error, count }`, igual que el SDK real.
 */
function fakeClient(options: FakeOptions = {}): {
  client: SdkClient;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];

  const build = (): RecordedQuery => {
    const record: RecordedQuery = {
      table: '',
      select: null,
      eqs: [],
      gte: [],
      lte: [],
      order: [],
      limit: null,
    };
    queries.push(record);
    return record;
  };

  const chain = {
    from(table: string) {
      build().table = table;
      return chain;
    },
    select(columns: string, _opts?: unknown) {
      queries[queries.length - 1].select = columns;
      return chain;
    },
    gte(column: string, value: unknown) {
      queries[queries.length - 1].gte.push([column, value]);
      return chain;
    },
    lte(column: string, value: unknown) {
      queries[queries.length - 1].lte.push([column, value]);
      return chain;
    },
    eq(column: string, value: unknown) {
      queries[queries.length - 1].eqs.push([column, value]);
      return chain;
    },
    order(column: string, opts?: unknown) {
      queries[queries.length - 1].order.push([column, opts]);
      return chain;
    },
    limit(n: number) {
      queries[queries.length - 1].limit = n;
      return chain;
    },
    then(resolve: (v: unknown) => unknown) {
      return Promise.resolve({
        data: options.rows ?? [],
        error: options.error ?? null,
        count: options.count ?? options.rows?.length ?? 0,
      }).then(resolve);
    },
  };

  return { client: { database: chain } as unknown as SdkClient, queries };
}

describe('capa de datos del dashboard — consulta construida', () => {
  it('los tres endpoints leen la vista audit_dashboard_metrics, no las tablas crudas', async () => {
    const a = fakeClient({ rows: [metricRow()] });
    const b = fakeClient({ rows: [metricRow()] });
    const c = fakeClient({ rows: [metricRow()] });

    await getDashboardSummary(a.client, BASE);
    await getAiCosts(b.client, BASE, 'day');
    await getAiQuality(c.client, BASE);

    for (const queries of [a.queries, b.queries]) {
      expect(queries).toHaveLength(1);
      expect(queries[0].table).toBe('audit_dashboard_metrics');
    }
    // `getAiQuality` lee la vista principal y, además, las fuentes de revisión humana.
    expect(c.queries[0].table).toBe('audit_dashboard_metrics');
    expect(c.queries.slice(1).every((q) => ['case_comparisons_dashboard_metrics', 'case_reviews'].includes(q.table))).toBe(true);
  });

  it('acota el rango con los límites del día en UTC (no con la fecha cruda)', async () => {
    const { client, queries } = fakeClient({ rows: [metricRow()] });
    await getDashboardSummary(client, BASE);

    expect(queries[0].gte).toEqual([['created_at', '2026-09-01T00:00:00.000Z']]);
    expect(queries[0].lte).toEqual([['created_at', '2026-09-30T23:59:59.999Z']]);
  });

  it('aplica result y status solo cuando vienen informedados', async () => {
    const sinFiltros = fakeClient({ rows: [metricRow()] });
    await getDashboardSummary(sinFiltros.client, BASE);
    expect(sinFiltros.queries[0].eqs).toEqual([]);

    const conFiltros = fakeClient({ rows: [metricRow()] });
    await getDashboardSummary(conFiltros.client, {
      ...BASE,
      result: 'CANCELACION_VENTA',
      status: 'COMPLETED',
    });
    expect(conFiltros.queries[0].eqs).toEqual([
      ['result', 'CANCELACION_VENTA'],
      ['case_status', 'COMPLETED'],
    ]);
  });

  it('limita el número de filas trayendo el tope del dashboard', async () => {
    const { client, queries } = fakeClient({ rows: [] });
    await getDashboardSummary(client, BASE);
    expect(queries[0].limit).toBe(DASHBOARD_MAX_ROWS);
  });

  it('marca `truncated` cuando el rango tiene más filas de las que se trayeron', async () => {
    // Se trae el tope completo pero la base dice que hay más: los KPIs
    // describen lo que se trajo, y `truncated` avisa de que la vista está
    // incompleta en lugar de presentar un total falso.
    const { client } = fakeClient({ rows: [metricRow()], count: DASHBOARD_MAX_ROWS + 1 });
    const summary = await getDashboardSummary(client, BASE);

    expect(summary.truncated).toBe(true);
    expect(summary.kpi.auditedCases).toBe(1);
  });

  it('no marca `truncated` cuando todo cabe en el tope', async () => {
    const { client } = fakeClient({ rows: [metricRow()], count: 1 });
    const summary = await getDashboardSummary(client, BASE);
    expect(summary.truncated).toBe(false);
  });

  it('ordena por created_at DESCENDENTE para que "Casos recientes" sean los recientes', async () => {
    // Con `ascending: true` + `limit`, al superar `DASHBOARD_MAX_ROWS` la ventana
    // traía las filas MÁS ANTIGUAS y la tabla "Casos recientes" mentía.
    const { client, queries } = fakeClient({ rows: [metricRow()] });
    await getDashboardSummary(client, BASE);
    expect(queries[0].order).toEqual([['created_at', { ascending: false }]]);
  });
});

describe('minimización de datos — no pedir columnas que no se usan', () => {
  it('la vista de costes NO pide student_identifier', async () => {
    const { client, queries } = fakeClient({ rows: [] });
    await getAiCosts(client, BASE, 'day');
    // El coste de una auditoría no depende de quién es el alumno: pedir la
    // columna sería hacer viajar PII sin devolvernla (GDPR Art. 5(1)(c)).
    expect(queries[0].select).toBeDefined();
    expect(String(queries[0].select)).not.toContain('student_identifier');
  });

  it('la vista de calidad NO pide student_identifier', async () => {
    const { client, queries } = fakeClient({ rows: [] });
    await getAiQuality(client, BASE);
    expect(queries[0].select).toBeDefined();
    expect(String(queries[0].select)).not.toContain('student_identifier');
  });

  it('la vista de costes NO pide jsonb crudo ni el resultado del dictamen', async () => {
    const { client, queries } = fakeClient({ rows: [] });
    await getAiCosts(client, BASE, 'day');
    const columnas = String(queries[0].select);
    expect(columnas).not.toContain('result_json');
    expect(columnas).not.toContain('provider_metadata');
    // `result` tampoco: esta ruta ignora el filtro por dictamen a propósito.
    expect(columnas).not.toMatch(/\bresult\b/);
  });

  it('la vista de calidad solo pide las columnas que el agregado usa', async () => {
    const { client, queries } = fakeClient({ rows: [] });
    await getAiQuality(client, BASE);
    const columnas = String(queries[0].select).split(',').map((c) => c.trim());
    // Las 6 dimensiones SÍ se piden aunque no se devuelvan: sin ellas el filtro
    // por dimensión no se puede aplicar en SQL, y filtrar en memoria después de
    // traer el conjunto daría métricas distintas de las que dice `truncated`.
    expect(columnas.sort()).toEqual(
      [
        'audit_status',
        'case_status',
        'confidence',
        'created_at',
        'id',
        'missing_evidence_count',
        'country',
        'campus',
        'modality',
        'project',
        'responsible',
        'guideline',
      ].sort(),
    );
  });
});

describe('getAiCosts — el filtro `result` NO se aplica, a propósito', () => {
  it('ignora `result` aunque venga informado, para no esconder el gasto fallido', async () => {
    const { client, queries } = fakeClient({ rows: [metricRow()] });

    await getAiCosts(client, { ...BASE, result: 'CANCELACION_VENTA' }, 'day');

    const columnas = queries[0].eqs.map(([columna]) => columna);
    expect(columnas).not.toContain('result');
    // `status` sí se respeta: ese criterio lo puso quien está mirando.
    expect(queries[0].eqs).toEqual([]);
  });

  it('sí respeta `status`', async () => {
    const { client, queries } = fakeClient({ rows: [metricRow()] });
    await getAiCosts(client, { ...BASE, status: 'COMPLETED' }, 'day');
    expect(queries[0].eqs).toEqual([['case_status', 'COMPLETED']]);
  });

  it('cambia el agrupamiento según la granularidad pedida', async () => {
    const porDia = fakeClient({ rows: [metricRow()] });
    const porMes = fakeClient({ rows: [metricRow()] });

    const dia = await getAiCosts(porDia.client, BASE, 'day');
    const mes = await getAiCosts(porMes.client, BASE, 'month');

    expect(dia.costSeries[0]?.bucket).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mes.costSeries[0]?.bucket).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('errores del proveedor — traducidos y sin filtrar detalles internos', () => {
  it('lanza un ApiError y no filtra el mensaje crudo del proveedor', async () => {
    const interno = 'conexión rechazada a https://db.interno:5432/rpc token=abc123';
    const { client } = fakeClient({ error: { message: interno, code: 'PGRST301' } });

    await expect(getDashboardSummary(client, BASE)).rejects.toThrowError();

    // El mensaje que ve el cliente no puede contener ni la URL interna ni el token.
    let thrown: unknown;
    try {
      await getDashboardSummary(client, BASE);
    } catch (error) {
      thrown = error;
    }
    const mensaje = thrown instanceof Error ? thrown.message : String(thrown);
    expect(mensaje).not.toContain('db.interno');
    expect(mensaje).not.toContain('abc123');
    expect(mensaje).toContain('[oculto]');
  });

  it('propaga el fallo también en ai-costs y quality', async () => {
    const a = fakeClient({ error: { message: 'boom', code: 'XX000' } });
    const b = fakeClient({ error: { message: 'boom', code: 'XX000' } });

    await expect(getAiCosts(a.client, BASE, 'day')).rejects.toThrowError();
    await expect(getAiQuality(b.client, BASE)).rejects.toThrowError();
  });
});

describe('agregación sobre datos reales de la vista', () => {
  it('el resumen cuenta un caso por su última auditoría vigente', async () => {
    const { client } = fakeClient({
      rows: [
        metricRow({ id: 'a1', case_id: 'case-1', created_at: '2026-09-10T10:00:00.000Z', result: 'EVIDENCIA_INSUFICIENTE' }),
        metricRow({ id: 'a2', case_id: 'case-1', created_at: '2026-09-20T10:00:00.000Z', result: 'CANCELACION_VENTA' }),
        metricRow({ id: 'a3', case_id: 'case-2', created_at: '2026-09-21T10:00:00.000Z', result: 'CANCELACION_VENTA' }),
      ],
    });

    const summary = await getDashboardSummary(client, BASE);
    expect(summary.kpi.auditedCases).toBe(2);
    expect(summary.kpi.granted).toBe(2);
  });

  it('la calidad devuelve la confianza media y sus bandas', async () => {
    const { client } = fakeClient({
      rows: [
        metricRow({ id: 'a1', case_id: 'case-1', confidence: 0.95 }),
        metricRow({ id: 'a2', case_id: 'case-2', confidence: 0.5 }),
      ],
    });

    const quality = await getAiQuality(client, BASE);
    expect(quality.confidence.auditedCases).toBe(2);
    expect(quality.confidence.avgConfidence).toBeCloseTo(0.725, 5);
  });

  it('sin filas devuelve un informe vacío, no un error', async () => {
    const { client } = fakeClient({ rows: [], count: 0 });
    const costs = await getAiCosts(client, BASE, 'day');
    expect(costs.kpi.totalCostUsd).toBe(0);
    expect(costs.kpi.auditsCounted).toBe(0);
  });
});

// El tipo real se reexporta desde `insforge.ts`; esta línea evita que el import
// quede sin usar si alguien reorganiza los imports.
export type { InsForgeClient };
