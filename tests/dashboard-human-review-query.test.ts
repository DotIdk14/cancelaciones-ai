// =============================================================================
// La parte humana del informe de calidad, en la CAPA DE DATOS.
//
// `tests/dashboard.test.ts` prueba el agregador PURO con filas ya filtradas.
// Aquí se prueba lo que no se puede ver desde ahí: que la consulta de
// comparaciones usa el mismo periodo, los mismos filtros y la MISMA fuente que
// el resto del dashboard, que no se trae el comentario humano, y que un fallo
// de la vista NO se degrada en un "no hay revisiones" inventado.
//
// El cliente InsForge es un PostgREST en memoria: aplica de verdad los
// predicados que recibe (`eq`/`gte`/`lte`/`limit`), así que un filtro que no se
//_pidiera_ en el código devolvería filas de más y el test fallaría. No hay red
// ni base de datos.
//
// DEPENDENCIA DE MIGRACIÓN: las tablas `case_reviews` y `case_comparisons` (y
// la vista `case_comparisons_dashboard_metrics`) las crea la migración de la
// revisión humana. Este archivo no las define: siembra filas con esa forma y
// espera que exista la vista.
// =============================================================================

import { describe, expect, it } from 'vitest';
import type { DashboardFilters } from '../src/lib/dashboard';
import {
  DASHBOARD_PAGE_SIZE,
  aggregateQuality,
  type ComparisonMetricRow,
  type DashboardMetricRow,
} from '../src/server/dashboard';
import { getAiQuality, getHumanReviewInput } from '../src/server/dashboard-queries';
import type { InsForgeClient } from '../src/server/insforge';
import { ApiError } from '../src/server/http';
import { fakeAuthContext, FAKE_USER_SUB, FAKE_COORDINATOR_SUB } from './helpers/auth';

const FILTERS: DashboardFilters = { from: '2026-09-01', to: '2026-09-30', result: null, status: null };
const VIEW = 'case_comparisons_dashboard_metrics';
const REVIEWS = 'case_reviews';

// ------------------------------------------------------------------ fake cliente

type Row = Record<string, unknown>;

interface Predicate {
  op: 'eq' | 'gte' | 'lte' | 'in';
  column: string;
  value: unknown;
}

interface RecordedCall {
  table: string;
  columns: unknown;
  predicates: Predicate[];
  limit: number | null;
  range: [number, number] | null;
}

interface QueryResult {
  data: Row[] | null;
  error: unknown;
  count: number | null;
}

interface FakeSeed {
  comparisons?: Array<Partial<ComparisonMetricRow> & { is_test?: boolean; created_by?: string | null }>;
  reviews?: Array<{
    id: string;
    created_at: string;
    result?: string;
    coordinator_decision?: 'APPROVE' | 'CHANGE' | null;
    coordinator_resolution?: string | null;
    'cases.is_test'?: boolean;
    'cases.created_by'?: string | null;
  }>;
  metrics?: Array<Partial<DashboardMetricRow> & { is_test?: boolean; created_by?: string | null }>;
  /** Tablas que fallan, para comprobar que el error NO se come. */
  failing?: string[];
}

interface FakeClient {
  client: InsForgeClient;
  calls: RecordedCall[];
  callFor(table: string): RecordedCall | undefined;
}

/**
 * `created_at` es un `timestamptz` que el SDK devuelve siempre en ISO-8601 UTC,
 * y el orden lexicográfico de ese formato ES el cronológico. Por eso comparar
 * texto reproduce el `>=` / `<=` de Postgres sin parsear fechas en el fake.
 */
function matches(row: Row, predicate: Predicate): boolean {
  if (predicate.op === 'eq') return row[predicate.column] === predicate.value;
  if (predicate.op === 'in') return (predicate.value as unknown[]).includes(row[predicate.column]);
  const left = typeof row[predicate.column] === 'string' ? (row[predicate.column] as string) : '';
  const right = String(predicate.value);
  return predicate.op === 'gte' ? left >= right : left <= right;
}

function createFakeClient(seed: FakeSeed): FakeClient {
  const calls: RecordedCall[] = [];
  const tables: Record<string, Row[]> = {
    // Las filas sembradas llevan `is_test`/`created_by` (las columnas que la
    // consulta filtra tras la migración). `is_test` por defecto `false`: es el
    // default de la columna y el estado de un caso real.
    [VIEW]: (seed.comparisons ?? []).map((row) => ({ is_test: false, ...row })),
    [REVIEWS]: (seed.reviews ?? []).map((row) => ({ 'cases.is_test': false, ...row })),
    audit_dashboard_metrics: (seed.metrics ?? []).map((row) => ({ is_test: false, ...row })),
  };

  function from(table: string) {
    const predicates: Predicate[] = [];
    let columns: unknown = '*';
    let limit: number | null = null;
    let range: [number, number] | null = null;

    function run(): QueryResult {
      if ((seed.failing ?? []).includes(table)) {
        return { data: null, error: { statusCode: 500, message: 'relation does not exist' }, count: null };
      }
      const matching = (tables[table] ?? []).filter((row) => predicates.every((p) => matches(row, p)));
      // `count: 'exact'` es el total ANTES del `limit`: es lo único que permite
      // avisar de una truncación, así que el fake lo respeta igual.
      const limited = limit === null ? matching : matching.slice(0, limit);
      return { data: range === null ? limited : limited.slice(range[0], range[1] + 1), error: null, count: matching.length };
    }

    const query = {
      select(next: unknown): typeof query {
        columns = next;
        return query;
      },
      eq(column: string, value: unknown): typeof query {
        predicates.push({ op: 'eq', column, value });
        return query;
      },
      gte(column: string, value: unknown): typeof query {
        predicates.push({ op: 'gte', column, value });
        return query;
      },
      lte(column: string, value: unknown): typeof query {
        predicates.push({ op: 'lte', column, value });
        return query;
      },
      in(column: string, values: unknown[]): typeof query {
        predicates.push({ op: 'in', column, value: values });
        return query;
      },
      order(): typeof query {
        return query;
      },
      limit(count: number): typeof query {
        limit = count;
        return query;
      },
      range(from: number, to: number): typeof query {
        range = [from, to];
        return query;
      },
      then<TResult1 = QueryResult, TResult2 = never>(
        onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): PromiseLike<TResult1 | TResult2> {
        calls.push({ table, columns, predicates: [...predicates], limit, range });
        return Promise.resolve(run()).then(onfulfilled, onrejected);
      },
    };

    return query;
  }

  return {
    client: { database: { from } } as unknown as InsForgeClient,
    calls,
    callFor: (table) => calls.find((call) => call.table === table),
  };
}

// ------------------------------------------------------------------- siembras

function comparisonRow(
  overrides: Partial<ComparisonMetricRow> & { is_test?: boolean; created_by?: string | null } = {},
): Partial<ComparisonMetricRow> & { is_test?: boolean; created_by?: string | null } {
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

function metricRow(
  overrides: Partial<DashboardMetricRow> & { is_test?: boolean; created_by?: string | null } = {},
): Partial<DashboardMetricRow> & { is_test?: boolean; created_by?: string | null } {
  return {
    id: 'audit-1',
    case_id: 'case-1',
    case_status: 'COMPLETED',
    student_identifier: null,
    audit_status: 'COMPLETED',
    model: 'google/gemini-2.5-flash-lite',
    provider: 'openrouter',
    latency_ms: 1000,
    error_category: null,
    attempt_number: 1,
    created_at: '2026-09-15T12:00:00.000Z',
    result: 'CANCELACION_VENTA',
    confidence: 0.9,
    missing_evidence_count: 0,
    usage_cost_usd: 0.01,
    usage_total_tokens: 1000,
    usage_prompt_tokens: 800,
    usage_completion_tokens: 200,
    provider_models: ['google/gemini-2.5-flash-lite'],
    attempts_cost_usd: 0.01,
    attempts_total_tokens: 1000,
    attempts_prompt_tokens: 800,
    attempts_completion_tokens: 200,
    attempts_count: 1,
    ...overrides,
  };
}

// ------------------------------------------------------------------------ tests

describe('getHumanReviewInput — el corte por periodo', () => {
  it('excluye las comparaciones fuera del rango, con los mismos límites inclusivos que el resto', async () => {
    const fake = createFakeClient({
      comparisons: [
        // Un milisegundo antes del primer instante del día: fuera.
        comparisonRow({ id: 'antes', created_at: '2026-08-31T23:59:59.999Z' }),
        comparisonRow({ id: 'primer-ms', created_at: '2026-09-01T00:00:00.000Z' }),
        comparisonRow({ id: 'dentro', created_at: '2026-09-15T12:00:00.000Z' }),
        // El último milisegundo del día final: DENTRO. Un filtro por día no
        // puede perder la comparación de las 23:59:59.999.
        comparisonRow({ id: 'ultimo-ms', created_at: '2026-09-30T23:59:59.999Z' }),
        comparisonRow({ id: 'despues', created_at: '2026-10-01T00:00:00.000Z' }),
      ],
    });

    const input = await getHumanReviewInput(fake.client, FILTERS);

    expect(input.comparisons.map((row) => row.id)).toEqual(['primer-ms', 'dentro', 'ultimo-ms']);
    const call = fake.callFor(VIEW);
    expect(call?.predicates).toEqual([
      { op: 'gte', column: 'created_at', value: '2026-09-01T00:00:00.000Z' },
      { op: 'lte', column: 'created_at', value: '2026-09-30T23:59:59.999Z' },
      // La exclusión de pruebas va SIEMPRE, ANTES del limit.
      { op: 'eq', column: 'is_test', value: false },
    ]);
    expect(call?.range).toEqual([0, DASHBOARD_PAGE_SIZE - 1]);
  });

  it('las revisiones se cuentan en el MISMO periodo, y sólo se pide su `id`', async () => {
    const fake = createFakeClient({
      comparisons: [comparisonRow({ case_review_id: 'review-septiembre' })],
      reviews: [
        { id: 'review-agosto', created_at: '2026-08-20T09:00:00.000Z' },
        { id: 'review-septiembre', created_at: '2026-09-10T09:00:00.000Z' },
        { id: 'review-octubre', created_at: '2026-10-02T09:00:00.000Z' },
      ],
    });

    const input = await getHumanReviewInput(fake.client, FILTERS);

    // Sólo la de septiembre: ni la de agosto ni la de octubre.
    expect(input.reviewedCases).toBe(1);
    const call = fake.callFor(REVIEWS);
    // El embed `cases!inner` trae `is_test`/`created_by` del caso: la tabla
    // `case_reviews` no tiene esas columnas, y sin el embed no se podría excluir
    // una revisión de prueba ni acotar por dueño EN SQL (un `.in` con todos los
    // ids de casos no escala). El comentario humano (`comment`) NO se pide.
    expect(call?.columns).toBe('id,case_id,cases!inner(is_test,created_by)');
    expect(call?.predicates).toEqual([
      { op: 'eq', column: 'cases.is_test', value: false },
      { op: 'gte', column: 'created_at', value: '2026-09-01T00:00:00.000Z' },
      { op: 'lte', column: 'created_at', value: '2026-09-30T23:59:59.999Z' },
    ]);
  });

  it('una revisión sin comparación cuenta igual: son dos hechos distintos', async () => {
    const fake = createFakeClient({
      comparisons: [],
      reviews: [
        { id: 'r1', created_at: '2026-09-10T09:00:00.000Z' },
        { id: 'r2', created_at: '2026-09-11T09:00:00.000Z' },
      ],
    });

    const input = await getHumanReviewInput(fake.client, FILTERS);

    expect(input.reviewedCases).toBe(2);
    expect(input.comparisons).toEqual([]);
  });

  it('la revisión de una comparación también cuenta si su comparación cayó en el periodo', async () => {
    // Una revisión del 31 de agosto cuya comparación terminó el 2 de
    // septiembre. Si `reviewedCases` fuera sólo el conteo de revisiones del
    // rango, el informe diría "no hay revisión registrada" junto a una tasa
    // calculada: dos afirmaciones que se contradicen en la misma tarjeta.
    const fake = createFakeClient({
      comparisons: [comparisonRow({ case_review_id: 'review-agosto' })],
      reviews: [{ id: 'review-agosto', created_at: '2026-08-31T22:00:00.000Z' }],
    });

    const input = await getHumanReviewInput(fake.client, FILTERS);

    expect(input.comparisons).toHaveLength(1);
    expect(input.reviewedCases).toBe(1);
  });

  it('comparisonsAvailable trae el total sin recortar: es lo que avisa de truncación', async () => {
    const fake = createFakeClient({
      comparisons: Array.from({ length: 3 }, (_, i) => comparisonRow({ id: `c${i}` })),
    });

    const input = await getHumanReviewInput(fake.client, FILTERS);

    expect(input.comparisons).toHaveLength(3);
    expect(input.comparisonsAvailable).toBe(3);
  });
});

describe('getHumanReviewInput — los mismos filtros que el resto del dashboard', () => {
  it('result y status también cortan las comparaciones, por el dictamen comparado', async () => {
    // Sin esto, filtrar "CANCELACION_VENTA" mostraría la coincidencia de
    // comparación de BAJAs junto a la confianza de las cancelaciones: dos
    // tarjetas del mismo informe hablando de periodos distintos.
    const fake = createFakeClient({
      comparisons: [comparisonRow({ id: 'coincide', audit_result: 'CANCELACION_VENTA', case_status: 'COMPLETED' })],
    });

    await getHumanReviewInput(fake.client, { ...FILTERS, result: 'CANCELACION_VENTA', status: 'COMPLETED' });

    expect(fake.callFor(VIEW)?.predicates).toEqual([
      { op: 'gte', column: 'created_at', value: '2026-09-01T00:00:00.000Z' },
      { op: 'lte', column: 'created_at', value: '2026-09-30T23:59:59.999Z' },
      { op: 'eq', column: 'audit_result', value: 'CANCELACION_VENTA' },
      { op: 'eq', column: 'case_status', value: 'COMPLETED' },
      // Las pruebas nunca cuentan como revisión humana operativa.
      { op: 'eq', column: 'is_test', value: false },
    ]);
  });

  it('sin filtros de resultado o estado no se envían predicados de más', async () => {
    const fake = createFakeClient({ comparisons: [] });

    await getHumanReviewInput(fake.client, FILTERS);

    const columnas = fake.callFor(VIEW)?.predicates.map((predicate) => predicate.column) ?? [];
    expect(columnas).toEqual(['created_at', 'created_at', 'is_test']);
  });
});

describe('getHumanReviewInput — pruebas y alcance', () => {
  it('excluye las comparaciones de un caso de prueba', async () => {
    const fake = createFakeClient({
      comparisons: [
        comparisonRow({ id: 'real', case_review_id: 'r-real', is_test: false }),
        comparisonRow({ id: 'prueba', case_review_id: 'r-prueba', is_test: true }),
      ],
      reviews: [
        { id: 'r-real', created_at: '2026-09-10T09:00:00.000Z' },
        { id: 'r-prueba', created_at: '2026-09-11T09:00:00.000Z' },
      ],
    });

    const input = await getHumanReviewInput(fake.client, FILTERS);

    expect(input.comparisons.map((c) => c.id)).toEqual(['real']);
  });

  it('excluye del conteo las revisiones de casos de prueba', async () => {
    const fake = createFakeClient({
      comparisons: [],
      reviews: [
        { id: 'r-real', created_at: '2026-09-10T09:00:00.000Z', 'cases.is_test': false },
        { id: 'r-prueba', created_at: '2026-09-11T09:00:00.000Z', 'cases.is_test': true },
      ],
    });

    const input = await getHumanReviewInput(fake.client, FILTERS);

    expect(input.reviewedCases).toBe(1);
  });

  it('un Asesor solo ve lo propio; global ve todo lo real pero nunca las pruebas', async () => {
    const seed = {
      comparisons: [
        comparisonRow({ id: 'mio', case_review_id: 'r-mio', created_by: FAKE_USER_SUB }),
        comparisonRow({ id: 'ajeno', case_review_id: 'r-ajeno', created_by: FAKE_COORDINATOR_SUB }),
      ],
      reviews: [
        { id: 'r-mio', created_at: '2026-09-10T09:00:00.000Z', 'cases.created_by': FAKE_USER_SUB },
        { id: 'r-ajeno', created_at: '2026-09-11T09:00:00.000Z', 'cases.created_by': FAKE_COORDINATOR_SUB },
      ],
    };

    const asesor = createFakeClient(seed);
    const propio = await getHumanReviewInput(asesor.client, FILTERS, fakeAuthContext('user'));
    expect(propio.comparisons.map((c) => c.id)).toEqual(['mio']);
    expect(propio.reviewedCases).toBe(1);
    expect(asesor.callFor(VIEW)?.predicates).toContainEqual({ op: 'eq', column: 'created_by', value: FAKE_USER_SUB });
    expect(asesor.callFor(REVIEWS)?.predicates).toContainEqual({
      op: 'eq',
      column: 'cases.created_by',
      value: FAKE_USER_SUB,
    });

    const gerente = createFakeClient(seed);
    const global = await getHumanReviewInput(gerente.client, FILTERS, fakeAuthContext('manager'));
    expect(global.comparisons.map((c) => c.id).sort()).toEqual(['ajeno', 'mio']);
    expect(global.reviewedCases).toBe(2);
    // El Gerente no acota por dueño, pero sigue excluyendo pruebas.
    expect(gerente.callFor(VIEW)?.predicates.map((p) => p.column)).not.toContain('created_by');
    expect(gerente.callFor(VIEW)?.predicates).toContainEqual({ op: 'eq', column: 'is_test', value: false });
  });
});

describe('getAiQuality — el bloque humano sin degradarse en silencio', () => {
  it('calcula la coincidencia sobre las comparaciones del periodo', async () => {
    const fake = createFakeClient({
      comparisons: [
        comparisonRow({ id: 'a', case_review_id: 'r-a', agrees: true, confidence: 0.9 }),
        comparisonRow({ id: 'b', case_review_id: 'r-b', agrees: false, confidence: 0.5 }),
      ],
      reviews: [
        { id: 'r-a', created_at: '2026-09-10T09:00:00.000Z' },
        { id: 'r-b', created_at: '2026-09-11T09:00:00.000Z' },
      ],
      metrics: [metricRow()],
    });

    const report = await getAiQuality(fake.client, FILTERS);

    expect(report.humanReview.available).toBe(true);
    expect(report.humanReview.reviewedCases).toBe(2);
    expect(report.humanReview.completedComparisons).toBe(2);
    expect(report.humanReview.agreementRate).toBe(0.5);
    expect(report.humanReview.avgComparisonConfidence).toBe(0.7);
    // Y la parte de confianza sigue leyéndose de su propia fuente.
    expect(report.confidence.auditedCases).toBe(1);
    expect(report.confidence.avgConfidence).toBe(0.9);
  });

  it('una comparación fuera del periodo no inventa una tasa', async () => {
    const fake = createFakeClient({
      comparisons: [comparisonRow({ id: 'vieja', created_at: '2026-07-01T10:00:00.000Z' })],
      reviews: [{ id: 'review-1', created_at: '2026-07-01T10:00:00.000Z' }],
    });

    const report = await getAiQuality(fake.client, FILTERS);

    expect(report.humanReview.available).toBe(false);
    expect(report.humanReview.completedComparisons).toBe(0);
    expect(report.humanReview.agreementRate).toBeNull();
  });

  it('un fallo de la vista se propaga: no se responde "no hay revisiones"', async () => {
    // Este es el motivo de que `getHumanReviewInput` no tenga un `catch` que
    // devuelva ceroes: una vista ausente es un fallo de despliegue, y
    // tragárselo publicaría "no hay revisión humana registrada" sobre una base
    // que sí la tiene. El error sale como `ApiError`, con su 5xx, y la UI lo
    // muestra como error de carga.
    const fake = createFakeClient({ failing: [VIEW] });

    await expect(getAiQuality(fake.client, FILTERS)).rejects.toBeInstanceOf(ApiError);
    await expect(getAiQuality(fake.client, FILTERS)).rejects.toMatchObject({ status: 500 });
  });
});

// --------------------------------------------------------------------------- forma

describe('getAiQuality — la forma que viaja al navegador', () => {
  it('humanReview tiene los campos declarados del contrato', async () => {
    // El nombre de cada clave ES el contrato con `src/lib/dashboard.ts` y con
    // `src/components/dashboard/QualityPage.tsx`. Se fija la lista completa en
    // vez de comprobar campos sueltos porque el defecto que hay que cazar aquí es
    // un campo que SOBRA (los que tenía la versión anterior: `reason`,
    // `correctedCases`, `agreementPct`, `confusionMatrix`, `agreementByCaseType`),
    // y un `toMatchObject` de los campos esperados dejaría pasar los cinco sin
    // decir nada.
    const fake = createFakeClient({
      comparisons: [comparisonRow()],
      reviews: [{ id: 'review-1', created_at: '2026-09-10T09:00:00.000Z' }],
    });

    const report = await getAiQuality(fake.client, FILTERS);

    expect(Object.keys(report.humanReview).sort()).toEqual([
      'agreementRate',
      'agreements',
      'available',
      'avgComparisonConfidence',
      'comparableReviews',
      'completedComparisons',
      'disagreements',
      'discrepancies',
      'discrepanciesTruncated',
      'failedComparisons',
      'message',
      'pendingComparisons',
      'reviewedCases',
    ]);
  });

  it('expone las resoluciones IA y humana finales solo para comparaciones discrepantes', async () => {
    const fake = createFakeClient({
      comparisons: [
        comparisonRow({ agrees: false, case_id: 'case-discrepancy', audit_result: 'CANCELACION_VENTA' }),
        comparisonRow({ id: 'agreement', agrees: true, case_id: 'case-agreement' }),
      ],
      reviews: [{
        id: 'review-1',
        created_at: '2026-09-10T09:00:00.000Z',
        result: 'BAJA',
        coordinator_decision: 'CHANGE',
        coordinator_resolution: 'TICKET_RECHAZADO',
      }],
    });

    const report = await getAiQuality(fake.client, FILTERS);

    expect(report.humanReview.discrepancies).toEqual([{
      caseId: 'case-discrepancy',
      aiResolution: 'CANCELACION_VENTA',
      humanResolution: 'TICKET_RECHAZADO',
      createdAt: '2026-09-15T12:00:00.000Z',
    }]);
  });

  it('el informe no lleva el comentario humano ni la explicación del modelo', async () => {
    // `case_reviews.comment` es texto que escribió una persona sobre un
    // expediente con PII, y `result_json.explanation` / `discrepancyReason` es
    // texto del modelo sobre ese mismo expediente. Ninguno hace falta para
    // contar, así que ninguno debe existir en la respuesta: si el informe los
    // arrastrara, estarían en el JSON que sirve `/api/dashboard/quality`, y de
    // ahí en el historial del navegador de cualquiera que abra la pantalla.
    const COMENTARIO = 'el estudiante sí tuvo contacto efectivo, lo confirmo yo';
    const EXPLICACION = 'el modelo discrepa porque no hay evidencia de contacto';

    const fake = createFakeClient({
      comparisons: [{ ...comparisonRow(), explanation: EXPLICACION, discrepancy_reason: EXPLICACION }],
      reviews: [{ id: 'review-1', comment: COMENTARIO, created_at: '2026-09-10T09:00:00.000Z' }],
    });

    const report = await getAiQuality(fake.client, FILTERS);
    const serializado = JSON.stringify(report);

    expect(serializado).not.toContain(COMENTARIO);
    expect(serializado).not.toContain(EXPLICACION);
    // Y tampoco los nombres de las columnas que las llevarían, por si alguien
    // cambiara el texto pero se olvidara de quitar el campo.
    for (const columna of ['comment', 'explanation', 'discrepancyReason', 'discrepancy_reason', 'result_json']) {
      expect(Object.keys(report.humanReview)).not.toContain(columna);
    }
  });

  it('el agregado humano no marca truncado después de leer todas las páginas', async () => {
    // `truncated` es de las DOS fuentes. Si sólo mirara las auditorías, una
    // comparación truncada se publicaría como una tasa completa, que es un dato
    // medido sobre menos comparaciones de las que existen: la tarjeta parecía
    // entera y no lo estaba.
    const fake = createFakeClient({
      comparisons: Array.from({ length: 2 }, (_, i) => comparisonRow({ id: `c${i}` })),
      reviews: [{ id: 'review-1', created_at: '2026-09-10T09:00:00.000Z' }],
    });
    const recortada = await getHumanReviewInput(fake.client, FILTERS);
    expect(recortada.comparisonsAvailable).toBe(2);

    const informe = aggregateQuality([], FILTERS, 0, {
      ...recortada,
      comparisonsAvailable: DASHBOARD_PAGE_SIZE + 1,
    });

    expect(informe.truncated).toBe(false);
  });
});
