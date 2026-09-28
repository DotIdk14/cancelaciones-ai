import { beforeEach, describe, expect, it } from 'vitest';
import { createToolExecutionRepository } from './tool-executions';
import { createFakeDatabase, type FakeDatabase } from './testing/fake-db';

let db: FakeDatabase;
let tools: ReturnType<typeof createToolExecutionRepository>;

const ISO_PASADO = '2026-01-01T00:00:00.000Z';

function arranque(idempotencyKey = 'idem_1') {
  return tools.start({
    auditId: 'audit_1',
    runId: 'run_1',
    name: 'transcribir_audio',
    kind: 'AUDIO',
    input: { evidenceId: 'ev_1' },
    idempotencyKey,
  });
}

beforeEach(() => {
  db = createFakeDatabase();
  tools = createToolExecutionRepository(db);
});

describe('createToolExecutionRepository', () => {
  it('arranca una tool en RUNNING con su started_at y el primer intento', async () => {
    const tool = await arranque();

    expect(tool.status).toBe('RUNNING');
    expect(tool.attempts).toBe(1);
    expect(tool.startedAt).not.toBeNull();
    expect(tool.finishedAt).toBeNull();
    expect(tool.runId).toBe('run_1');
    expect(tool.name).toBe('transcribir_audio');
    expect(tool.kind).toBe('AUDIO');
  });

  it('es idempotente por idempotency_key: dos arranques dejan una sola fila', async () => {
    const primero = await arranque();
    const segundo = await arranque();

    expect(segundo.id).toBe(primero.id);
    expect(db.rows('tool_executions')).toHaveLength(1);
  });

  it('no reabre una tool ya SUCCEEDED', async () => {
    const tool = await arranque();
    await tools.succeed(tool.id, { texto: 'hola' });

    const reintento = await arranque();

    expect(reintento.status).toBe('SUCCEEDED');
    expect(reintento.output).toEqual({ texto: 'hola' });
    expect(reintento.attempts).toBe(1);
    expect(db.rows('tool_executions')).toHaveLength(1);
  });

  it('reactiva a PENDING una tool FAILED, con los intentos a cero', async () => {
    const tool = await arranque();
    await tools.fail(tool.id, 'PROVIDER_500', 'AssemblyAI devolvio 500');

    const reactivada = await arranque();

    expect(reactivada.id).toBe(tool.id);
    expect(reactivada.status).toBe('PENDING');
    expect(reactivada.attempts).toBe(0);
    expect(reactivada.errorCode).toBeNull();
    expect(reactivada.errorMessage).toBeNull();
    expect(reactivada.finishedAt).toBeNull();
    expect(db.rows('tool_executions')).toHaveLength(1);
  });

  it('no reinicia una tool que ya esta corriendo', async () => {
    const tool = await arranque();

    const repetido = await arranque();

    expect(repetido.id).toBe(tool.id);
    expect(repetido.startedAt).toBe(tool.startedAt);
    expect(db.rows('tool_executions')).toHaveLength(1);
  });

  it('sella finished_al completar y guarda la salida', async () => {
    const tool = await arranque();

    const completada = await tools.succeed(tool.id, { texto: 'transcripcion' });

    expect(completada.status).toBe('SUCCEEDED');
    expect(completada.finishedAt).not.toBeNull();
    expect(completada.output).toEqual({ texto: 'transcripcion' });
    expect(completada.errorCode).toBeNull();
  });

  it('sella finished_at con su codigo de error al fallar', async () => {
    const tool = await arranque();

    const fallida = await tools.fail(tool.id, 'TIMEOUT', 'El proveedor no respondio');

    expect(fallida.status).toBe('FAILED');
    expect(fallida.finishedAt).not.toBeNull();
    expect(fallida.errorCode).toBe('TIMEOUT');
    expect(fallida.errorMessage).toBe('El proveedor no respondio');
  });

  it('deja una tool en WAITING_EXTERNAL cuando depende de un tercero', async () => {
    const tool = await arranque();

    const esperando = await tools.markWaitingExternal(tool.id, { webhookId: 'wh_1' });

    expect(esperando.status).toBe('WAITING_EXTERNAL');
    expect(esperando.output).toEqual({ webhookId: 'wh_1' });
    expect(esperando.finishedAt).toBeNull();
  });

  it('lista las tools por run y por auditoria', async () => {
    const primera = await arranque('idem_1');
    await tools.start({
      auditId: 'audit_1',
      runId: 'run_2',
      name: 'leer_pdf',
      kind: 'EVIDENCE',
      input: {},
      idempotencyKey: 'idem_2',
    });
    await tools.start({
      auditId: 'audit_2',
      runId: 'run_3',
      name: 'buscar_normativa',
      kind: 'POLICY',
      input: {},
      idempotencyKey: 'idem_3',
    });

    expect((await tools.listByRun('run_1')).map((tool) => tool.id)).toEqual([primera.id]);
    expect(await tools.listByAudit('audit_1')).toHaveLength(2);
    expect(await tools.listByAudit('audit_2')).toHaveLength(1);
  });

  it('lista como caducas solo las tools abiertas cuyo timeout ya paso', async () => {
    const vencida = await tools.start({
      auditId: 'audit_1',
      name: 'transcribir',
      kind: 'AUDIO',
      input: {},
      idempotencyKey: 'idem_vencida',
      timeoutAt: ISO_PASADO,
    });
    const esperando = await tools.start({
      auditId: 'audit_1',
      name: 'vision',
      kind: 'VISION',
      input: {},
      idempotencyKey: 'idem_esperando',
      timeoutAt: ISO_PASADO,
    });
    await tools.markWaitingExternal(esperando.id);
    const sinTimeout = await tools.start({
      auditId: 'audit_1',
      name: 'leer',
      kind: 'EVIDENCE',
      input: {},
      idempotencyKey: 'idem_sin_timeout',
    });
    const cerrada = await tools.start({
      auditId: 'audit_1',
      name: 'listo',
      kind: 'EVIDENCE',
      input: {},
      idempotencyKey: 'idem_cerrada',
      timeoutAt: ISO_PASADO,
    });
    await tools.succeed(cerrada.id, { ok: true });

    const caducadas = await tools.listStale(new Date('2026-06-01T00:00:00.000Z'));

    expect(caducadas.map((tool) => tool.id).sort()).toEqual([vencida.id, esperando.id].sort());
    expect(caducadas.map((tool) => tool.id)).not.toContain(sinTimeout.id);
    expect(caducadas.map((tool) => tool.id)).not.toContain(cerrada.id);
  });

  it('no lista como caduca una tool cuyo timeout sigue en el futuro', async () => {
    await tools.start({
      auditId: 'audit_1',
      name: 'transcribir',
      kind: 'AUDIO',
      input: {},
      idempotencyKey: 'idem_futura',
      timeoutAt: '2026-12-01T00:00:00.000Z',
    });

    expect(await tools.listStale(new Date('2026-06-01T00:00:00.000Z'))).toEqual([]);
  });

  it('devuelve null al buscar una tool que no existe', async () => {
    expect(await tools.findById('tool_inexistente')).toBeNull();
  });
});
