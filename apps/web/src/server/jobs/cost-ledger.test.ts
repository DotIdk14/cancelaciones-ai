import { describe, expect, it, vi } from 'vitest';
import {
  requestFingerprint, readOpenRouterUsage, readAssemblyAiUsage,
  beginProviderOperation, completeProviderOperation, recordAiUsage, buildAuditCostSummary,
} from './cost-ledger';

/**
 * El problema que estos tests cubren, en una frase:
 *
 *   En producción `public.ai_usage` tenía 0 filas mientras los handlers llamaban
 *   a AssemblyAI y OpenRouter de verdad. El gasto era invisible, así que una
 *   fuga por reintentos habría sido indetectable.
 *
 * Y el riesgo mayor, en otra: un reintento de job vuelve a ejecutar el handler,
 * y si el handler vuelve a llamar al proveedor, se paga dos veces por la misma
 * operación lógica. El lease del job NO lo evita: el lease garantiza un solo
 * worker CONCURRENTE, no que un reintento posterior no repita trabajo ya pagado.
 */

/** Fake del ledger en DB: modela exactamente la semántica de los RPC reales. */
function ledgerFakeDb(initial: Array<Record<string, unknown>> = []) {
  const operations = [...initial];
  const usage: Array<Record<string, unknown>> = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'begin_provider_operation_v1') {
      const existing = operations.find((row) => row.request_fingerprint === args.p_request_fingerprint);
      if (existing) {
        const status = existing.status;
        if (status === 'SUCCEEDED') return { data: [{ out_provider_operation_id: existing.id, out_status: 'SUCCEEDED', out_external_operation_id: existing.external_operation_id, out_should_execute: false }], error: null };
        if (status === 'SUBMITTED' && args.p_billable === true) return { data: [{ out_provider_operation_id: existing.id, out_status: 'RESULT_UNKNOWN', out_external_operation_id: null, out_should_execute: false }], error: null };
      }
      const row = { id: `op-${operations.length + 1}`, status: 'SUBMITTED', external_operation_id: null, request_fingerprint: args.p_request_fingerprint };
      operations.push(row);
      return { data: [{ out_provider_operation_id: row.id, out_status: 'SUBMITTED', out_external_operation_id: null, out_should_execute: true }], error: null };
    }
    if (fn === 'complete_provider_operation_v1') {
      const row = operations.find((entry) => entry.id === args.p_provider_operation_id);
      if (row) { row.status = args.p_status; row.external_operation_id = args.p_external_operation_id ?? row.external_operation_id; }
      return { data: [{ out_provider_operation_id: args.p_provider_operation_id, out_status: args.p_status }], error: null };
    }
    if (fn === 'record_ai_usage_v1') {
      const key = `${args.p_provider}|${args.p_operation}|${args.p_request_fingerprint}`;
      if (usage.some((row) => row.key === key)) return { data: [{ out_ai_usage_id: null, out_recorded: false }], error: null };
      usage.push({ key, ...args });
      return { data: [{ out_ai_usage_id: `use-${usage.length}`, out_recorded: true }], error: null };
    }
    return { data: null, error: { message: 'unsupported' } };
  });
  const from = vi.fn((table: string) => {
    const rows = table === 'ai_usage' ? usage.map((row) => ({
      id: row.key, provider: row.p_provider, operation: row.p_operation, model: row.p_model ?? null,
      input_units: row.p_input_units ?? null, output_units: row.p_output_units ?? null,
      unit_type: row.p_unit_type ?? null, estimated_cost_usd: row.p_estimated_cost_usd ?? null,
      // `cost_source` en la proyección: el RPC real lo persiste (migración
      // 20260925200000) y el resumen lo lee. Si el doble no lo devolviera, este
      // suite probaría un mundo donde la fuente del coste se pierde, que es
      // exactamente el defecto A.
      cost_source: row.p_cost_source ?? 'UNKNOWN',
      provider_request_id: row.p_provider_request_id ?? null,
      recorded_at: '2026-09-25T12:00:00.000Z',
    })) : [];
    const api: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit']) api[m] = () => api;
    api.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
    return api;
  });
  return { db: { rpc, from } as never, rpc, operations, usage };
}

describe('requestFingerprint', () => {
  it('es estable para la misma operación lógica', () => {
    const parts = { auditId: 'a1', jobId: 'j1', stage: 'OPENROUTER_CHAT', input: 'file.pdf:12345' };
    expect(requestFingerprint(parts)).toBe(requestFingerprint({ ...parts }));
  });

  it('NO incluye el intento: el reintento debe reutilizar la MISMA huella', () => {
    // Si la huella dependiera del intento, cada reintento pagaría de nuevo,
    // que es justo lo que se quiere evitar.
    const base = { auditId: 'a1', jobId: 'j1', stage: 'S', input: 'x' };
    expect(requestFingerprint(base)).toBe(requestFingerprint({ ...base }));
  });

  it('cambia si cambia el input: dos contenidos distintos son dos operaciones', () => {
    const base = { auditId: 'a1', jobId: 'j1', stage: 'S' };
    expect(requestFingerprint({ ...base, input: 'x' })).not.toBe(requestFingerprint({ ...base, input: 'y' }));
  });

  it('tolera jobId nulo sin romperse', () => {
    expect(requestFingerprint({ auditId: 'a', jobId: null, stage: 'S', input: 'x' })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('idempotencia de operaciones pagadas', () => {
  it('la PRIMERA vez ejecuta y registra', async () => {
    const { db, operations } = ledgerFakeDb();
    const result = await beginProviderOperation({ database: db, jobId: 'j1', attemptId: 'a1', evidenceId: 'e1', provider: 'OPENROUTER', operationType: 'CHAT_COMPLETIONS', fingerprint: 'fp-1', billable: true });
    expect(result.shouldExecute).toBe(true);
    expect(result.status).toBe('SUBMITTED');
    expect(operations).toHaveLength(1);
  });

  it('un REINTENTO tras el éxito NO vuelve a ejecutar ni a pagar', async () => {
    const { db, operations } = ledgerFakeDb();
    const first = await beginProviderOperation({ database: db, jobId: 'j1', attemptId: 'a1', evidenceId: 'e1', provider: 'OPENROUTER', operationType: 'CHAT_COMPLETIONS', fingerprint: 'fp-1', billable: true });
    await completeProviderOperation({ database: db, providerOperationId: first.providerOperationId, status: 'SUCCEEDED', externalOperationId: 'gen-1' });

    const retry = await beginProviderOperation({ database: db, jobId: 'j1', attemptId: 'a2', evidenceId: 'e1', provider: 'OPENROUTER', operationType: 'CHAT_COMPLETIONS', fingerprint: 'fp-1', billable: true });
    expect(retry.shouldExecute).toBe(false);
    expect(retry.status).toBe('SUCCEEDED');
    expect(retry.externalOperationId).toBe('gen-1');
    // Y no se creó una segunda operación: siguen siendo UNA.
    expect(operations).toHaveLength(1);
  });

  it('tras morir ANTES de guardar el resultado, NO reintenta a ciegas', async () => {
    const { db } = ledgerFakeDb();
    // Se envió al proveedor y el proceso murió: la fila queda SUBMITTED.
    await beginProviderOperation({ database: db, jobId: 'j1', attemptId: 'a1', evidenceId: 'e1', provider: 'ASSEMBLYAI', operationType: 'TRANSCRIPT', fingerprint: 'fp-2', billable: true });

    const retry = await beginProviderOperation({ database: db, jobId: 'j1', attemptId: 'a2', evidenceId: 'e1', provider: 'ASSEMBLYAI', operationType: 'TRANSCRIPT', fingerprint: 'fp-2', billable: true });
    expect(retry.shouldExecute).toBe(false);
    expect(retry.status).toBe('RESULT_UNKNOWN');
  });

  it('una operación NO pagada (poll) sí puede repetirse', async () => {
    const { db, operations } = ledgerFakeDb();
    await beginProviderOperation({ database: db, jobId: 'j1', attemptId: 'a1', evidenceId: null, provider: 'ASSEMBLYAI', operationType: 'POLL', fingerprint: 'poll-1', billable: false });
    const again = await beginProviderOperation({ database: db, jobId: 'j1', attemptId: 'a2', evidenceId: null, provider: 'ASSEMBLYAI', operationType: 'POLL', fingerprint: 'poll-1', billable: false });
    expect(again.shouldExecute).toBe(true);
    expect(operations).toHaveLength(2);
  });

  it('si el ledger no está disponible, se ejecuta y no se rompe el pipeline', async () => {
    const db = { rpc: undefined } as never;
    const result = await beginProviderOperation({ database: db, jobId: 'j', attemptId: null, evidenceId: null, provider: 'X', operationType: 'Y', fingerprint: 'f', billable: true });
    expect(result.shouldExecute).toBe(true);
    expect(result.status).toBe('UNAVAILABLE');
  });
});

describe('exactly-once del ledger de coste', () => {
  const usage = (overrides = {}) => ({
    provider: 'OPENROUTER', operation: 'CHAT_COMPLETIONS', model: 'm', inputUnits: 10, outputUnits: 20,
    unitType: 'TOKENS', costUsd: 0.02, costSource: 'PROVIDER_REPORTED' as const, externalOperationId: 'g1', ...overrides,
  });

  it('la primera escritura registra', async () => {
    const { db, usage: rows } = ledgerFakeDb();
    const recorded = await recordAiUsage({ database: db, auditId: 'a1', jobId: 'j1', attemptId: 'at1', evidenceId: 'e1', fingerprint: 'fp-1', providerOperationId: 'op-1', usage: usage() });
    expect(recorded).toBe(true);
    expect(rows).toHaveLength(1);
  });

  it('el reintento NO crea una segunda fila de coste', async () => {
    const { db, usage: rows } = ledgerFakeDb();
    const base = { database: db, auditId: 'a1', jobId: 'j1', attemptId: 'at1', evidenceId: 'e1', fingerprint: 'fp-1', providerOperationId: 'op-1', usage: usage() };
    expect(await recordAiUsage(base)).toBe(true);
    // Mismo fingerprint, otro intento: la escritura debe ser no-op.
    expect(await recordAiUsage({ ...base, attemptId: 'at2' })).toBe(false);
    expect(rows).toHaveLength(1);
  });

  it('envía la fuente del coste al RPC, no solo dentro de `usage`', async () => {
    // El RPC la validaba y la descartaba: se validaba un parámetro para
    // perderlo. La prueba de que ahora viaja es que llegue como `p_cost_source`.
    const { db, rpc } = ledgerFakeDb();
    await recordAiUsage({
      database: db, auditId: 'a1', jobId: 'j1', attemptId: 'at1', evidenceId: 'e1',
      fingerprint: 'fp-1', providerOperationId: 'op-1', usage: usage({ costSource: 'PROVIDER_REPORTED' }),
    });
    const call = rpc.mock.calls.find(([fn]) => fn === 'record_ai_usage_v1');
    expect(call?.[1]).toMatchObject({ p_cost_source: 'PROVIDER_REPORTED' });
  });

  it('viaja como NULL, no como 0, cuando el coste se desconoce', async () => {
    // Si esto invirtiera a 0, el ledger afirmaría "gratis" sin saberlo.
    const { db, rpc } = ledgerFakeDb();
    await recordAiUsage({
      database: db, auditId: 'a1', jobId: 'j1', attemptId: 'at1', evidenceId: 'e1',
      fingerprint: 'fp-u', providerOperationId: 'op-1', usage: usage({ costUsd: null, costSource: 'UNKNOWN' }),
    });
    const call = rpc.mock.calls.find(([fn]) => fn === 'record_ai_usage_v1');
    expect(call?.[1]).toMatchObject({ p_estimated_cost_usd: null, p_unit_price_usd: null, p_cost_source: 'UNKNOWN' });
  });
});

describe('lectura del uso real de cada proveedor', () => {
  it('OpenRouter: lee modelo, tokens e id de generación', () => {
    const result = readOpenRouterUsage({
      id: 'gen-abc', model: 'google/gemini-2.5-flash',
      usage: { prompt_tokens: 1234, completion_tokens: 567, total_tokens: 1801, cost: 0.0123 },
    });
    expect(result).toMatchObject({
      provider: 'OPENROUTER', operation: 'CHAT_COMPLETIONS', model: 'google/gemini-2.5-flash',
      inputUnits: 1234, outputUnits: 567, unitType: 'TOKENS',
      costUsd: 0.0123, costSource: 'PROVIDER_REPORTED', externalOperationId: 'gen-abc',
    });
  });

  it('OpenRouter SIN coste reportado: NULL y UNKNOWN, nunca 0', () => {
    // Este es el punto: 0 significaría "gratis", que es falso.
    const result = readOpenRouterUsage({ id: 'g', model: 'm', usage: { prompt_tokens: 10, completion_tokens: 5 } });
    expect(result.costUsd).toBeNull();
    expect(result.costSource).toBe('UNKNOWN');
  });

  it('OpenRouter con respuesta vacía: todo desconocido, sin lanzar', () => {
    const result = readOpenRouterUsage(undefined);
    expect(result.costUsd).toBeNull();
    expect(result.inputUnits).toBeNull();
  });

  it('AssemblyAI: la unidad facturable son los segundos de audio', () => {
    const result = readAssemblyAiUsage({ status: 'completed', audio_duration: 312.4, model: 'best' }, 'tr-1');
    expect(result).toMatchObject({
      provider: 'ASSEMBLYAI', operation: 'TRANSCRIPT', inputUnits: 312.4,
      unitType: 'AUDIO_SECONDS', costSource: 'UNKNOWN', externalOperationId: 'tr-1',
    });
  });

  it('AssemblyAI sin duración reportada: coste y unidades desconocidos', () => {
    const result = readAssemblyAiUsage({ status: 'completed' }, 'tr-1');
    expect(result.inputUnits).toBeNull();
    expect(result.costUsd).toBeNull();
  });
});

describe('buildAuditCostSummary', () => {
  it('separa el coste conocido de los desconocidos', async () => {
    const { db } = ledgerFakeDb();
    await recordAiUsage({ database: db, auditId: 'a1', jobId: 'j', attemptId: null, evidenceId: null, fingerprint: 'f1', providerOperationId: 'o1', usage: { provider: 'OPENROUTER', operation: 'CHAT_COMPLETIONS', model: 'm1', inputUnits: 1, outputUnits: 1, unitType: 'TOKENS', costUsd: 0.02, costSource: 'PROVIDER_REPORTED', externalOperationId: null } });
    await recordAiUsage({ database: db, auditId: 'a1', jobId: 'j', attemptId: null, evidenceId: null, fingerprint: 'f2', providerOperationId: 'o2', usage: { provider: 'ASSEMBLYAI', operation: 'TRANSCRIPT', model: 'best', inputUnits: 100, outputUnits: null, unitType: 'AUDIO_SECONDS', costUsd: 0.03, costSource: 'ESTIMATED', externalOperationId: null } });
    await recordAiUsage({ database: db, auditId: 'a1', jobId: 'j', attemptId: null, evidenceId: null, fingerprint: 'f3', providerOperationId: 'o3', usage: { provider: 'ASSEMBLYAI', operation: 'TRANSCRIPT', model: 'best', inputUnits: 50, outputUnits: null, unitType: 'AUDIO_SECONDS', costUsd: null, costSource: 'UNKNOWN', externalOperationId: null } });

    const summary = await buildAuditCostSummary({ database: db, auditId: 'a1' });
    expect(summary.knownCostUsd).toBeCloseTo(0.05, 6);
    expect(summary.unknownCostEvents).toBe(1);
    expect(summary.providerCallCount).toBe(3);
    expect(summary.providers).toEqual(['ASSEMBLYAI', 'OPENROUTER']);
    expect(summary.models).toEqual(['best', 'm1']);
  });

  it('NO presenta un total cuando hay desconocidos', () => {
    // Si `knownCostUsd` se presentara como "el gasto de la auditoría", sería
    // falso en cuanto hay un coste sin conocer. Por eso el campo se llama
    // `known` y `unknownCostEvents` va siempre al lado.
    const summary = { knownCostUsd: 0.05, unknownCostEvents: 1, providerCallCount: 3, events: [] as unknown[], providers: [], models: [], auditId: 'a' };
    expect(summary.knownCostUsd).not.toBe(summary.unknownCostEvents);
    expect(summary.knownCostUsd).toBeLessThan(0.05 + 1);
  });

  it('una auditoría sin uso devuelve ceros sin fingir que se midió', async () => {
    const { db } = ledgerFakeDb();
    const summary = await buildAuditCostSummary({ database: db, auditId: 'sin-uso' });
    expect(summary.knownCostUsd).toBe(0);
    expect(summary.unknownCostEvents).toBe(0);
    expect(summary.providerCallCount).toBe(0);
    // Cero es un dato LEGÍTIMO aquí: no hay operaciones, luego no hay coste.
    // Lo que no es legítimo es un cero por fallo de lectura, que es el test de
    // abajo.
    expect(summary.readFailed).toBe(false);
  });

  it('un FALLO DE LECTURA no se presenta como coste cero', async () => {
    // El defecto más silencioso de esta ruta: la lectura fallaba, la función
    // devolvía ceros y la ruta los pintaba como "$0.00". Eso afirma que se
    // midió el gasto cuando no se midió nada: el mismo error que esta fase
    // viene a corregir, en la capa de lectura.
    const failing = {
      from: () => {
        const api: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'order', 'limit']) api[m] = () => api;
        api.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: 'db down' } });
        return api;
      },
    } as never;

    const summary = await buildAuditCostSummary({ database: failing, auditId: 'a1' });
    expect(summary.readFailed).toBe(true);
  });

  it('una excepción en la lectura también se marca como fallo', async () => {
    const throwing = {
      from: () => { throw new Error('boom'); },
    } as never;
    const summary = await buildAuditCostSummary({ database: throwing, auditId: 'a1' });
    expect(summary.readFailed).toBe(true);
  });

  it('expone la procedencia de cada coste, no solo la cifra', async () => {
    const { db } = ledgerFakeDb();
    await recordAiUsage({ database: db, auditId: 'a1', jobId: 'j', attemptId: null, evidenceId: null, fingerprint: 'f9', providerOperationId: 'o9', usage: { provider: 'ASSEMBLYAI', operation: 'TRANSCRIPT', model: 'best', inputUnits: 100, outputUnits: null, unitType: 'AUDIO_SECONDS', costUsd: null, costSource: 'UNKNOWN', externalOperationId: 'tr-9' } });

    const summary = await buildAuditCostSummary({ database: db, auditId: 'a1' });
    expect(summary.events[0].costSource).toBe('UNKNOWN');
    expect(summary.events[0].costKnown).toBe(false);
  });
});
