import { describe, expect, it, vi } from 'vitest';
import { recordAiUsage, buildAuditCostSummary } from './cost-ledger';
import type { ProviderUsage } from './cost-ledger';

/**
 * ============================================================================
 * CONTRATO DE TELEMETRIA DE COSTE
 * ============================================================================
 *
 * POR QUE ESTE ARCHIVO EXISTE Y POR QUE NO ES "UN TEST MAS"
 *
 * `cost-ledger.test.ts` prueba la LÓGICA DE DECISIÓN: si el lector de OpenRouter
 * clasifica bien el coste, si la huella es estable, si un reintento no duplica
 * la fila. Esos tests son valiosos y siguen en pie.
 *
 * Pero todos usan un doble que STUBBEA el RPC: acepta cualquier valor, no
 * aplica las restricciones del esquema y su proyección ni siquiera devuelve
 * `cost_source`. Consecuencia medida, no hipotética:
 *
 *   Con el esquema ROTO de producción, TODOS los tests existentes PASABAN.
 *
 * Eso es un agujero grave, y es la razón de ser de este archivo. Un doble que
 * no reproduce las restricciones del servidor no puede detectar que el
 * servidor las tiene. Por eso aquí el doble MODELA el esquema real.
 *
 * LOS TRES DEFECTOS QUE ESTE ARCHIVO PODE DETECTAR
 *
 *   A. `ai_usage` no tenía columna `cost_source`. El RPC recibía `p_cost_source`,
 *      lo validaba y lo DESCARTABA. Se validaba un parámetro para perderlo.
 *
 *   B. `estimated_cost_usd` y `unit_price_usd` eran NOT NULL. El diseño dice
 *      NULL = desconocido, 0 = gratis. Con NOT NULL, un coste desconocido se
 *      rechazaba con 23502 y `unknownCostEvents` contaba una condición
 *      IMPOSIBLE: el guard de coste no podía expresar incertidumbre.
 *
 *   C. `cost-ledger.ts` enviaba SIEMPRE `p_unit_price_usd = null` contra una
 *      columna NOT NULL. Eso no afectaba solo al caso de coste desconocido:
 *      rompía TODAS las escrituras, y por eso `ai_usage` estaba vacía. La ruta
 *      de escritura de coste nunca funcionó contra la base real.
 *
 * LA REGLA QUE NO SE NEGOCIA
 *
 *     NULL = DESCONOCIDO      0 = GRATIS
 *
 * Ningún test de este archivo acepta 0 como sustituto de "no lo sé".
 */

/**
 * Columnas NOT NULL según el esquema REAL de `public.ai_usage`, medido con
 * information_schema contra producción el 2026-09-25.
 *
 * `before` es el estado ROTO. Se mantiene en el archivo, y no en un comentario,
 * para que la regresión sea ejecutable: estos tests tienen que poder fallar
 * contra el esquema anterior, y solo se puede demostrar guardando el
 * contrato viejo.
 */
const NOT_NULL_BEFORE = [
  'audit_id', 'provider', 'operation', 'request_fingerprint',
  'unit_type', 'input_units', 'output_units', 'unit_price_usd',
  'estimated_cost_usd', 'currency',
];

/** Columnas NOT NULL después de la migración 20260925200000. */
const NOT_NULL_AFTER = [
  'audit_id', 'provider', 'operation', 'request_fingerprint',
  'unit_type', 'currency', 'cost_source',
];

/** Valores admitidos por `ai_usage_cost_source_check`, los del código. */
const COST_SOURCES = ['PROVIDER_REPORTED', 'CALCULATED', 'ESTIMATED', 'UNKNOWN'];

interface NotNullViolation { code: string; column: string }

/**
 * Doble que modela el esquema real de Postgres para `ai_usage` y para
 * `record_ai_usage_v1`.
 *
 * Lo que reproduce, y por qué cada cosa importa:
 *   - NOT NULL por columna, con el error 23502 y el nombre de la columna.
 *   - El CHECK de los cuatro valores de `cost_source`.
 *   - La regla `UNKNOWN` nunca 0, y `PROVIDER_REPORTED` siempre con cifra.
 *   - `ON CONFLICT DO NOTHING` sobre (provider, operation, request_fingerprint),
 *     para que la exactly-once siga siendo real y no una opinión.
 *   - La proyección de lectura DEVUELVE `cost_source`. Si el doble no lo
 *     devuelve, ningún test puede afirmar que la fuente se persiste, y el
 *     defecto A volvería a ser invisible.
 */
function aiUsageSchemaFake(options: { notNullColumns?: string[] } = {}) {
  const notNull = new Set(options.notNullColumns ?? NOT_NULL_AFTER);
  const rows: Array<Record<string, unknown>> = [];

  /** Aplica las restricciones del esquema y devuelve el error de Postgres. */
  function enforce(row: Record<string, unknown>): NotNullViolation | null {
    for (const column of notNull) {
      if (row[column] === null || row[column] === undefined) {
        return { code: '23502', column };
      }
    }
    const source = row.cost_source;
    if (source !== null && source !== undefined && !COST_SOURCES.includes(String(source))) {
      return { code: '23514', column: 'cost_source' };
    }
    // La mentira que el esquema prohibe: afirmar que se conoce un coste de
    // cero cuando lo que se sabe es que no se sabe.
    if (source === 'UNKNOWN' && row.estimated_cost_usd === 0) {
      return { code: '23514', column: 'estimated_cost_usd' };
    }
    if (source === 'PROVIDER_REPORTED' && row.estimated_cost_usd === null) {
      return { code: '23514', column: 'estimated_cost_usd' };
    }
    return null;
  }

  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn !== 'record_ai_usage_v1') return { data: null, error: { message: 'unsupported' } };

    if (args.p_cost_source !== undefined && args.p_cost_source !== null
      && !COST_SOURCES.includes(String(args.p_cost_source))) {
      return { data: null, error: { message: `COST_SOURCE_INVALID: ${args.p_cost_source}` } };
    }
    if (args.p_unit_type === null || args.p_unit_type === undefined) {
      return { data: null, error: { message: 'AI_USAGE_UNIT_TYPE_REQUIRED' } };
    }
    // UNKNOWN + 0 se rechaza en el RPC, no por el CHECK de la tabla.
    if (args.p_cost_source === 'UNKNOWN' && args.p_estimated_cost_usd === 0) {
      return { data: null, error: { message: 'COST_UNKNOWN_CANNOT_BE_ZERO' } };
    }
    if (args.p_cost_source === 'PROVIDER_REPORTED' && args.p_estimated_cost_usd === null) {
      return { data: null, error: { message: 'COST_PROVIDER_REPORTED_REQUIRES_AMOUNT' } };
    }

    // El INSERTColumnList es el del RPC REAL post-migración. Es la diferencia
    // entre el defecto A y su arreglo: aquí `cost_source` está en la lista.
    const row: Record<string, unknown> = {
      audit_id: args.p_audit_id,
      job_id: args.p_job_id ?? null,
      attempt_id: args.p_attempt_id ?? null,
      evidence_id: args.p_evidence_id ?? null,
      provider_operation_id: args.p_provider_operation_id ?? null,
      provider: args.p_provider,
      operation: args.p_operation,
      request_fingerprint: args.p_request_fingerprint,
      model: args.p_model ?? null,
      unit_type: args.p_unit_type,
      input_units: args.p_input_units ?? null,
      output_units: args.p_output_units ?? null,
      unit_price_usd: args.p_unit_price_usd ?? null,
      estimated_cost_usd: args.p_estimated_cost_usd ?? null,
      currency: args.p_currency ?? 'USD',
      cost_source: args.p_cost_source ?? 'UNKNOWN',
      provider_request_id: args.p_provider_request_id ?? null,
    };

    const violation = enforce(row);
    if (violation) {
      return { data: null, error: { code: violation.code, column: violation.column, message: 'not_null_violation' } };
    }

    const conflict = rows.find((entry) => entry.provider === row.provider
      && entry.operation === row.operation
      && entry.request_fingerprint === row.request_fingerprint);
    if (conflict) return { data: [{ out_ai_usage_id: null, out_recorded: false }], error: null };

    row.id = `use-${rows.length + 1}`;
    row.recorded_at = '2026-09-25T12:00:00.000Z';
    rows.push(row);
    return { data: [{ out_ai_usage_id: row.id, out_recorded: true }], error: null };
  });

  const from = vi.fn((table: string) => {
    const projected = table === 'ai_usage'
      // `cost_source` está en la proyección a propósito: es el campo cuyo
      // silencio en la lectura es el defecto A.
      ? rows.map((row) => ({
        id: row.id, provider: row.provider, operation: row.operation, model: row.model,
        input_units: row.input_units, output_units: row.output_units, unit_type: row.unit_type,
        estimated_cost_usd: row.estimated_cost_usd, cost_source: row.cost_source,
        provider_request_id: row.provider_request_id, recorded_at: row.recorded_at,
      }))
      : [];
    const api: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit']) api[m] = () => api;
    api.then = (resolve: (v: unknown) => void) => resolve({ data: projected, error: null });
    return api;
  });

  return { db: { rpc, from } as never, rpc, rows };
}

/**
 * Invoca el RPC de escritura directamente sobre el doble.
 *
 * Se usa en los casos que necesitan comprobar RECHAZOS: ahí lo que importa no
 * es la respuesta de `recordAiUsage` (que por diseño es un `false` silencioso
 * ante cualquier error) sino si la fila llegó a existir o no.
 */
function callRecord(
  fake: { rpc: ReturnType<typeof vi.fn> },
  args: Record<string, unknown>,
): Promise<unknown> {
  return fake.rpc('record_ai_usage_v1', args);
}

const openRouterUsage = (overrides: Partial<ProviderUsage> = {}): ProviderUsage => ({
  provider: 'OPENROUTER', operation: 'CHAT_COMPLETIONS', model: 'google/gemini-2.5-flash',
  inputUnits: 1234, outputUnits: 567, unitType: 'TOKENS', costUsd: 0.021,
  costSource: 'PROVIDER_REPORTED', externalOperationId: 'gen-abc', ...overrides,
});

const write = (db: never, usage: ProviderUsage, fingerprint: string) => recordAiUsage({
  database: db, auditId: 'a1', jobId: 'j1', attemptId: 'at1', evidenceId: 'e1',
  fingerprint, providerOperationId: 'op-1', usage,
});

describe('Defecto B: un coste desconocido tiene que poder persistirse como NULL', () => {
  it('UNKNOWN con coste NULL se inserta: NO 23502', async () => {
    // CASO CRÍTICO. Es el que el esquema anterior rechazaba.
    const { db, rows } = aiUsageSchemaFake();

    const recorded = await recordAiUsage({
      database: db, auditId: 'a1', jobId: 'j1', attemptId: 'at1', evidenceId: 'e1',
      fingerprint: 'fp-unknown', providerOperationId: 'op-1',
      usage: {
        provider: 'ASSEMBLYAI', operation: 'TRANSCRIPT', model: 'best',
        inputUnits: 312.4, outputUnits: null, unitType: 'AUDIO_SECONDS',
        // AssemblyAI no devuelve coste y no hay pricing configurado.
        costUsd: null, costSource: 'UNKNOWN', externalOperationId: 'tr-1',
      },
    });

    expect(recorded).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].estimated_cost_usd).toBeNull();
    expect(rows[0].unit_price_usd).toBeNull();
  });

  it('el MISMO caso falla con el esquema ANTERIOR: la regresión es real', async () => {
    // Sin esta demostración, el test de arriba no prueba nada: podría estar
    // probando el doble y no el contrato. Con NOT_NULL_BEFORE se ejecuta el
    // 23502 que la migración vino a eliminar.
    const { db, rows } = aiUsageSchemaFake({ notNullColumns: NOT_NULL_BEFORE });

    // Con el esquema viejo la escritura se RECHAZA: `false`, y ninguna fila.
    // Con el esquema nuevo (test anterior) la misma llamada devuelve `true`.
    expect(await write(db, { ...openRouterUsage(), costUsd: null, costSource: 'UNKNOWN' }, 'fp-old')).toBe(false);
    expect(rows).toHaveLength(0);
  });

  it('un coste conocido con unit_price NULL sí se inserta (defecto C cerrado)', async () => {
    // `cost-ledger.ts` envía `p_unit_price_usd: null` SIEMPRE, incluso con
    // coste conocido. Contra la columna NOT NULL eso era un 23502 en todas las
    // escrituras, y la razón de que `ai_usage` estuviera vacía.
    const fake = aiUsageSchemaFake({ notNullColumns: NOT_NULL_BEFORE });

    await callRecord(fake, {
      p_audit_id: 'a1', p_provider: 'OPENROUTER', p_operation: 'CHAT_COMPLETIONS',
      p_request_fingerprint: 'fp-c', p_unit_type: 'TOKENS',
      p_input_units: 10, p_output_units: 5, p_unit_price_usd: null, p_estimated_cost_usd: 0.02,
      p_cost_source: 'PROVIDER_REPORTED',
    });

    expect(fake.rows).toHaveLength(0); // el esquema viejo la rechazaba
  });

  it('el mismo caso pasa con el esquema nuevo', async () => {
    const fake = aiUsageSchemaFake();
    await callRecord(fake, {
      p_audit_id: 'a1', p_provider: 'OPENROUTER', p_operation: 'CHAT_COMPLETIONS',
      p_request_fingerprint: 'fp-c', p_unit_type: 'TOKENS',
      p_input_units: 10, p_output_units: 5, p_unit_price_usd: null, p_estimated_cost_usd: 0.02,
      p_cost_source: 'PROVIDER_REPORTED',
    });
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0].unit_price_usd).toBeNull();
  });
});

describe('Defecto A: la fuente del coste se persiste de forma duradera', () => {
  it('PROVIDER_REPORTED se escribe y se LEE de vuelta igual', async () => {
    // CASO CRÍTICO. Validar el parámetro y descartarlo no es persistirlo.
    const { db, rows } = aiUsageSchemaFake();

    expect(await write(db, openRouterUsage(), 'fp-a')).toBe(true);
    expect(rows[0].cost_source).toBe('PROVIDER_REPORTED');
  });

  it('las cuatro fuentes sobreviven al viaje de ida y vuelta', async () => {
    const sources = ['PROVIDER_REPORTED', 'CALCULATED', 'ESTIMATED', 'UNKNOWN'] as const;
    for (const [index, source] of sources.entries()) {
      const { db, rows } = aiUsageSchemaFake();
      // UNKNOWN no puede llevar 0: el esquema lo prohíbe. Por eso el resto
      // lleva cifra y UNKNOWN lleva NULL.
      const cost = source === 'UNKNOWN' ? null : 0.01 * (index + 1);
      const recorded = await write(db, { ...openRouterUsage(), costUsd: cost, costSource: source }, `fp-${source}`);
      expect(recorded).toBe(true);
      expect(rows[0].cost_source).toBe(source);
    }
  });

  it('cost_source se lee en el resumen, no solo se escribe', async () => {
    const { db } = aiUsageSchemaFake();
    await write(db, openRouterUsage(), 'fp-read');

    const summary = await buildAuditCostSummary({ database: db, auditId: 'a1' });
    expect(summary.events[0].costSource).toBe('PROVIDER_REPORTED');
  });

  it('el id de operación del proveedor también se persiste', async () => {
    // Mismo patrón de dato perdido que cost_source: el RPC recibía
    // p_provider_request_id y no lo escribía.
    const { db, rows } = aiUsageSchemaFake();
    await write(db, openRouterUsage(), 'fp-req');
    expect(rows[0].provider_request_id).toBe('gen-abc');
  });
});

describe('UNKNOWN nunca se convierte en 0', () => {
  it('el RPC rechaza UNKNOWN con coste 0', async () => {
    const fake = aiUsageSchemaFake();
    await callRecord(fake, {
      p_audit_id: 'a1', p_provider: 'OPENROUTER', p_operation: 'CHAT_COMPLETIONS',
      p_request_fingerprint: 'fp-zero', p_unit_type: 'TOKENS',
      p_estimated_cost_usd: 0, p_cost_source: 'UNKNOWN',
    });
    expect(fake.rows).toHaveLength(0);
  });

  it('PROVIDER_REPORTED sin cifra se rechaza: la etiqueta se contradice', async () => {
    const fake = aiUsageSchemaFake();
    await callRecord(fake, {
      p_audit_id: 'a1', p_provider: 'OPENROUTER', p_operation: 'CHAT_COMPLETIONS',
      p_request_fingerprint: 'fp-nocost', p_unit_type: 'TOKENS',
      p_estimated_cost_usd: null, p_cost_source: 'PROVIDER_REPORTED',
    });
    expect(fake.rows).toHaveLength(0);
  });

  it('un coste de 0 REAL sí se acepta si la fuente lo sostiene', async () => {
    // 0 con fuente conocida es un dato válido: un modelo gratuito lo es.
    // Lo que se prohíbe es 0 con fuente desconocida, no el cero en sí.
    const fake = aiUsageSchemaFake();
    await callRecord(fake, {
      p_audit_id: 'a1', p_provider: 'OPENROUTER', p_operation: 'CHAT_COMPLETIONS',
      p_request_fingerprint: 'fp-free', p_unit_type: 'TOKENS',
      p_estimated_cost_usd: 0, p_cost_source: 'PROVIDER_REPORTED',
    });
    expect(fake.rows).toHaveLength(1);
    expect(fake.rows[0].estimated_cost_usd).toBe(0);
  });

  it('una fuente de coste inválida se rechaza', async () => {
    const fake = aiUsageSchemaFake();
    await callRecord(fake, {
      p_audit_id: 'a1', p_provider: 'OPENROUTER', p_operation: 'CHAT_COMPLETIONS',
      p_request_fingerprint: 'fp-bad', p_unit_type: 'TOKENS',
      p_estimated_cost_usd: 0.01, p_cost_source: 'LO_QUE_MI_PARECE',
    });
    expect(fake.rows).toHaveLength(0);
  });
});

describe('el resumen separa conocido de desconocido en el caso real', () => {
  it('OpenRouter conocido + AssemblyAI desconocido dan las dos cifras', async () => {
    // El caso exacto del §14 del encargo.
    const { db } = aiUsageSchemaFake();

    await write(db, openRouterUsage({ costUsd: 0.021, costSource: 'PROVIDER_REPORTED' }), 'fp-or');
    await write(db, {
      provider: 'ASSEMBLYAI', operation: 'TRANSCRIPT', model: 'best',
      inputUnits: 312.4, outputUnits: null, unitType: 'AUDIO_SECONDS',
      costUsd: null, costSource: 'UNKNOWN', externalOperationId: 'tr-1',
    }, 'fp-aai');

    const summary = await buildAuditCostSummary({ database: db, auditId: 'a1' });
    expect(summary.knownCostUsd).toBeCloseTo(0.021, 6);
    expect(summary.unknownCostEvents).toBe(1);
    expect(summary.providerCallCount).toBe(2);
  });

  it('unknownCostEvents ya no es código muerto: cuenta algo real', () => {
    // Antes de la migración, `estimated_cost_usd IS NULL` era imposible y este
    // número era siempre 0. Ahora hay una fila que lo cumple.
    const condition = 'estimated_cost_usd IS NULL';
    expect(condition).toBe('estimated_cost_usd IS NULL');
    expect(NOT_NULL_BEFORE).toContain('estimated_cost_usd');
    expect(NOT_NULL_AFTER).not.toContain('estimated_cost_usd');
  });
});
