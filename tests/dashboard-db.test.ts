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
  DASHBOARD_PAGE_SIZE,
  type DashboardMetricRow,
} from '../src/server/dashboard';
import {
  getAiCosts,
  getAiQuality,
  getDashboardFilterOptions,
  getDashboardSummary,
} from '../src/server/dashboard-queries';
import { fakeAuthContext, FAKE_USER_SUB } from './helpers/auth';

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
  ins: Array<[string, unknown[]]>;
  order: Array<[string, unknown]>;
  limit: number | null;
  range: [number, number] | null;
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
      ins: [],
      order: [],
      limit: null,
      range: null,
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
    in(column: string, values: unknown[]) {
      queries[queries.length - 1].ins.push([column, values]);
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
    range(from: number, to: number) {
      queries[queries.length - 1].range = [from, to];
      return chain;
    },
    then(resolve: (v: unknown) => unknown) {
      const query = queries[queries.length - 1]!;
      const range = query.range;
      const rows = (options.rows ?? []).map((row) => ({ is_test: false, created_by: FAKE_USER_SUB, ...row }));
      const filtered = rows.filter((row) => query.eqs.every(([column, value]) =>
        (row as unknown as Record<string, unknown>)[column] === value,
      ));
      return Promise.resolve({
        data: range ? filtered.slice(range[0], range[1] + 1) : filtered,
        error: options.error ?? null,
        count: options.count ?? filtered.length,
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
    // Sin filtros del usuario, el único predicado es la exclusión de pruebas, que
    // SIEMPRE va (una prueba no es métrica operativa para ningún rol).
    expect(sinFiltros.queries[0].eqs).toEqual([['is_test', false]]);

    const conFiltros = fakeClient({ rows: [metricRow()] });
    await getDashboardSummary(conFiltros.client, {
      ...BASE,
      result: 'CANCELACION_VENTA',
      status: 'COMPLETED',
    });
    expect(conFiltros.queries[0].eqs).toEqual([
      ['result', 'CANCELACION_VENTA'],
      ['case_status', 'COMPLETED'],
      ['is_test', false],
    ]);
  });

  it('lee por páginas menores que el límite REST y sigue hasta agotar el conjunto', async () => {
    const { client, queries } = fakeClient({ rows: [] });
    await getDashboardSummary(client, BASE);
    expect(queries[0].range).toEqual([0, DASHBOARD_PAGE_SIZE - 1]);
  });

  it('calcula KPI completos con más de 10,000 auditorías y no reporta un total truncado', async () => {
    const rows = Array.from({ length: 10_250 }, (_, index) => metricRow({
      id: `audit-${index}`,
      case_id: `case-${Math.floor(index / 2)}`,
      created_at: new Date(Date.UTC(2026, 8, 1 + (index % 30), 12)).toISOString(),
      is_test: false,
    }));
    const { client } = fakeClient({ rows, count: rows.length });
    const summary = await getDashboardSummary(client, BASE);

    expect(summary.truncated).toBe(false);
    expect(summary.kpi.auditedCases).toBe(5_125);
  });

  it('aplica owner scope y casos de prueba antes de paginar más de 10,000 auditorías mixtas', async () => {
    const rows = Array.from({ length: 10_250 }, (_, index) => {
      const auditStatus = index % 7 === 0 ? 'ERROR' : index % 7 === 1 ? 'RUNNING' : 'COMPLETED';
      return metricRow({
        id: `audit-${index}`,
        case_id: `case-${Math.floor(index / 2)}`,
        created_at: new Date(Date.UTC(2026, 8, 1) + index).toISOString(),
        audit_status: auditStatus,
        case_status: auditStatus === 'ERROR' ? 'ERROR' : auditStatus === 'RUNNING' ? 'AUDITING' : 'COMPLETED',
        result: auditStatus === 'COMPLETED' ? 'CANCELACION_VENTA' : null,
        confidence: auditStatus === 'COMPLETED' ? 0.8 : null,
        is_test: index % 5 === 0,
        created_by: index % 2 === 0 ? FAKE_USER_SUB : 'otro-usuario',
        usage_cost_usd: index % 11 === 0 ? null : 0.01,
      } as Partial<DashboardMetricRow>);
    });
    const eligible = rows.filter((row) => row.created_by === FAKE_USER_SUB && row.is_test === false);
    const latestByCase = new Map<string, DashboardMetricRow>();
    for (const row of eligible) latestByCase.set(row.case_id, row);
    const expectedAuditedCases = [...latestByCase.values()].filter((row) => row.audit_status !== 'RUNNING').length;
    const { client, queries } = fakeClient({ rows });

    const summary = await getDashboardSummary(client, BASE, fakeAuthContext('user'));
    const costs = await getAiCosts(client, BASE, 'day', fakeAuthContext('user'));

    expect(summary.kpi.auditedCases).toBe(expectedAuditedCases);
    expect(summary.truncated).toBe(false);
    expect(costs.kpi.auditsCounted).toBe(eligible.length);
    expect(costs.truncated).toBe(false);
    expect(queries.every((query) => query.eqs.some(([column, value]) => column === 'created_by' && value === FAKE_USER_SUB))).toBe(true);
    expect(queries.every((query) => query.eqs.some(([column, value]) => column === 'is_test' && value === false))).toBe(true);
  });

  it('no marca `truncated` cuando todo cabe en el tope', async () => {
    const { client } = fakeClient({ rows: [metricRow()], count: 1 });
    const summary = await getDashboardSummary(client, BASE);
    expect(summary.truncated).toBe(false);
  });

  it('ordena por created_at DESCENDENTE para que "Casos recientes" sean los recientes', async () => {
    // Con `ascending: true` + `limit`, al superar `DASHBOARD_PAGE_SIZE` la ventana
    // traía las filas MÁS ANTIGUAS y la tabla "Casos recientes" mentía.
    const { client, queries } = fakeClient({ rows: [metricRow()] });
    await getDashboardSummary(client, BASE);
    expect(queries[0].order).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
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
    // Las dimensiones SÍ se piden aunque no se devuelvan: sin ellas el filtro
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
        'channel',
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
    // `status` sí se respeta: ese criterio lo puso quien está mirando. La única
    // igualdad incondicional es la exclusión de pruebas.
    expect(queries[0].eqs).toEqual([['is_test', false]]);
  });

  it('sí respeta `status`', async () => {
    const { client, queries } = fakeClient({ rows: [metricRow()] });
    await getAiCosts(client, { ...BASE, status: 'COMPLETED' }, 'day');
    expect(queries[0].eqs).toEqual([
      ['case_status', 'COMPLETED'],
      ['is_test', false],
    ]);
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

// -----------------------------------------------------------------------------
// Scope de dueño y exclusión de pruebas
// -----------------------------------------------------------------------------

describe('dashboard — scope de dueño y exclusión de pruebas, en SQL', () => {
  it('un Asesor acota por created_by y excluye pruebas; Coordinador/Gerente leen global pero sin pruebas', async () => {
    const asesor = fakeClient({ rows: [metricRow()] });
    await getDashboardSummary(asesor.client, BASE, fakeAuthContext('user'));
    expect(asesor.queries[0].eqs).toEqual([
      ['created_by', FAKE_USER_SUB],
      ['is_test', false],
    ]);

    for (const role of ['coordinator', 'manager'] as const) {
      const global = fakeClient({ rows: [metricRow()] });
      await getDashboardSummary(global.client, BASE, fakeAuthContext(role));
      // La visibilidad global NO mete las pruebas en las métricas operativas.
      expect(global.queries[0].eqs).toEqual([['is_test', false]]);
    }
  });

  it('getAiCosts y getAiQuality aplican el mismo scope y exclusión', async () => {
    const costs = fakeClient({ rows: [] });
    await getAiCosts(costs.client, BASE, 'day', fakeAuthContext('user'));
    expect(costs.queries[0].eqs).toEqual([
      ['created_by', FAKE_USER_SUB],
      ['is_test', false],
    ]);

    const quality = fakeClient({ rows: [] });
    await getAiQuality(quality.client, BASE, fakeAuthContext('user'));
    expect(quality.queries[0].eqs).toEqual([
      ['created_by', FAKE_USER_SUB],
      ['is_test', false],
    ]);
  });

  it('getDashboardFilterOptions recibe el alcance y excluye pruebas', async () => {
    const asesor = fakeClient({ rows: [] });
    await getDashboardFilterOptions(asesor.client, fakeAuthContext('user'));
    expect(asesor.queries[0].eqs).toEqual([
      ['created_by', FAKE_USER_SUB],
      ['is_test', false],
    ]);

    const gerente = fakeClient({ rows: [] });
    await getDashboardFilterOptions(gerente.client, fakeAuthContext('manager'));
    expect(gerente.queries[0].eqs).toEqual([['is_test', false]]);
  });

  it('el scope va en la MISMA consulta que el limit: con más filas que el tope no se subcuenta', async () => {
    // Defecto que se corrige: antes el scope se aplicaba en memoria DESPUÉS del
    // `limit`. Con 5000 filas ajenas (más recientes) y 3 propias (más antiguas),
    // el recorte traía las 5000 ajenas, el filtro en memoria dejaba 0 y el Asesor
    // veía un total subcontado. Aquí el fixture es un PostgREST en memoria que
    // aplica de verdad `eq`/`gte`/`lte` y `limit`, así que la única forma de ver
    // las 3 propias es que el scope viaje en la consulta.
    const foreign: DashboardMetricRow[] = Array.from({ length: DASHBOARD_PAGE_SIZE }, (_, i) =>
      metricRow({
        id: `foreign-${i}`,
        case_id: `foreign-case-${i}`,
        created_at: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
      }) as unknown as DashboardMetricRow,
    );
    const owned: DashboardMetricRow[] = [0, 1, 2].map((i) =>
      metricRow({ id: `owned-${i}`, case_id: `owned-case-${i}` }) as unknown as DashboardMetricRow,
    );
    // Filas crudas con las columnas que la consulta filtra (`is_test`,
    // `created_by`) — la vista las proyecta tras la migración.
    const raw: Array<Record<string, unknown>> = [...foreign, ...owned].map((row, index) => ({
      ...row,
      is_test: false,
      created_by: index < DASHBOARD_PAGE_SIZE ? 'otro-usuario' : FAKE_USER_SUB,
    }));

    const summary = await getDashboardSummary(scopedClient(raw), BASE, fakeAuthContext('user'));

    expect(summary.kpi.auditedCases).toBe(3);
  });
});

/**
 * PostgREST en memoria mínimo: aplica `eq`/`gte`/`lte` y `limit` de verdad, para
 * poder observar el efecto de aplicar (o no) el scope ANTES del recorte.
 */
function scopedClient(rows: Array<Record<string, unknown>>): SdkClient {
  function from(_table: string) {
    const predicates: Array<[string, string, unknown]> = [];
    let limitCount: number | null = null;
    let range: [number, number] | null = null;
    const query = {
      select(): typeof query {
        return query;
      },
      gte(column: string, value: unknown): typeof query {
        predicates.push([column, 'gte', value]);
        return query;
      },
      lte(column: string, value: unknown): typeof query {
        predicates.push([column, 'lte', value]);
        return query;
      },
      eq(column: string, value: unknown): typeof query {
        predicates.push([column, 'eq', value]);
        return query;
      },
      order(): typeof query {
        return query;
      },
      limit(count: number): typeof query {
        limitCount = count;
        return query;
      },
      range(from: number, to: number): typeof query {
        range = [from, to];
        return query;
      },
      then(resolve: (value: unknown) => unknown): unknown {
        const matching = rows.filter((row) =>
          predicates.every(([column, op, value]) => {
            const left = row[column];
            if (op === 'eq') return left === value;
            if (op === 'gte') return String(left) >= String(value);
            return String(left) <= String(value);
          }),
        );
        const limited = limitCount === null ? matching : matching.slice(0, limitCount);
        const data = range === null ? limited : limited.slice(range[0], range[1] + 1);
        return Promise.resolve({ data, error: null, count: matching.length }).then(resolve);
      },
    };
    return query;
  }
  return { database: { from } } as unknown as SdkClient;
}
