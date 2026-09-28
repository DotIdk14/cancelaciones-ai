import { beforeEach, describe, expect, it } from 'vitest';
import { createAuditRunRepository } from './audit-runs';
import { TerminalStateError } from './errors';
import { createFakeDatabase, type FakeDatabase } from './testing/fake-db';

let db: FakeDatabase;
let runs: ReturnType<typeof createAuditRunRepository>;

beforeEach(() => {
  db = createFakeDatabase();
  runs = createAuditRunRepository(db);
});

async function nuevoRun(auditId = 'audit_1') {
  return runs.create({ auditId, createdBy: 'user_1', evidenceFingerprint: 'fp_1' });
}

/** Camino legal CREATED -> PROCESSING_EVIDENCE -> ANALYZING. */
async function runEnAnalizando(auditId = 'audit_1') {
  const run = await nuevoRun(auditId);
  await runs.advance(run.id, 'PROCESSING_EVIDENCE');
  return runs.advance(run.id, 'ANALYZING');
}

describe('createAuditRunRepository', () => {
  it('numera los runs de una auditoria de forma correlativa', async () => {
    const primero = await nuevoRun();
    const segundo = await nuevoRun();

    expect(primero.runNumber).toBe(1);
    expect(segundo.runNumber).toBe(2);
    expect(primero.status).toBe('CREATED');
    expect(segundo.auditId).toBe('audit_1');
  });

  it('numera por auditoria, no de forma global', async () => {
    await nuevoRun('audit_1');
    await nuevoRun('audit_1');
    const otroCaso = await nuevoRun('audit_2');

    expect(otroCaso.runNumber).toBe(1);
  });

  it('avanza CREATED -> PROCESSING_EVIDENCE y devuelve el run actualizado', async () => {
    const run = await nuevoRun();
    const avanzado = await runs.advance(run.id, 'PROCESSING_EVIDENCE');

    expect(avanzado.status).toBe('PROCESSING_EVIDENCE');
    expect(avanzado.id).toBe(run.id);
  });

  it('rechaza volver a PROCESSING_EVIDENCE -> CREATED', async () => {
    const run = await nuevoRun();
    await runs.advance(run.id, 'PROCESSING_EVIDENCE');

    await expect(runs.advance(run.id, 'CREATED')).rejects.toThrow(
      'ILLEGAL_AUDIT_RUN_TRANSITION: PROCESSING_EVIDENCE -> CREATED',
    );
  });

  it('un run COMPLETED no vuelve a PROCESSING_EVIDENCE', async () => {
    const run = await runEnAnalizando();
    const completado = await runs.advance(run.id, 'COMPLETED');
    expect(completado.status).toBe('COMPLETED');

    await expect(runs.advance(run.id, 'PROCESSING_EVIDENCE')).rejects.toBeInstanceOf(TerminalStateError);
    await expect(runs.advance(run.id, 'FAILED')).rejects.toBeInstanceOf(TerminalStateError);

    const intacto = await runs.findById(run.id);
    expect(intacto?.status).toBe('COMPLETED');
  });

  it('un run FAILED no vuelve a ejecutarse automaticamente', async () => {
    const run = await runEnAnalizando();
    const fallido = await runs.fail(run.id, 'RUNNER_CRASH', 'El proceso murio a mitad del analisis');
    expect(fallido.status).toBe('FAILED');
    expect(fallido.errorCode).toBe('RUNNER_CRASH');

    await expect(runs.advance(run.id, 'ANALYZING')).rejects.toBeInstanceOf(TerminalStateError);
  });

  it('un run NEEDS_INPUT tampoco se reescribe', async () => {
    const run = await runEnAnalizando();
    const needsInput = await runs.advance(run.id, 'NEEDS_INPUT');
    expect(needsInput.status).toBe('NEEDS_INPUT');

    await expect(runs.advance(run.id, 'REVIEWING')).rejects.toBeInstanceOf(TerminalStateError);
  });

  it('sella finished_at al completar y marca started_at al analizar', async () => {
    const run = await nuevoRun();
    const analizado = await runs.advance(run.id, 'PROCESSING_EVIDENCE');
    const enAnalisis = await runs.advance(run.id, 'ANALYZING');

    expect(analizado.finishedAt).toBeNull();
    expect(enAnalisis.startedAt).not.toBeNull();
    expect(enAnalisis.finishedAt).toBeNull();

    const completado = await runs.advance(run.id, 'COMPLETED');
    expect(completado.finishedAt).not.toBeNull();
    expect(completado.startedAt).toBe(enAnalisis.startedAt);
  });

  it('acumula las secciones de politica consultadas sin duplicar', async () => {
    const run = await nuevoRun();

    await runs.recordPolicySections(run.id, ['GDM_GAM_PRD_MLG_003#3.2', 'GDM_GAM_PRD_MLG_003#4.1']);
    const acumulado = await runs.recordPolicySections(run.id, ['GDM_GAM_PRD_MLG_003#4.1', 'GDM_GAM_PRD_MLG_003#5']);

    expect(acumulado.policySectionsConsulted).toEqual([
      'GDM_GAM_PRD_MLG_003#3.2',
      'GDM_GAM_PRD_MLG_003#4.1',
      'GDM_GAM_PRD_MLG_003#5',
    ]);
  });

  it('suma los contadores en vez de asignarlos', async () => {
    const run = await nuevoRun();

    await runs.incrementCounters(run.id, { toolCallCount: 3, agentStepCount: 2 });
    const tras = await runs.incrementCounters(run.id, { toolCallCount: 1, agentStepCount: 4 });

    expect(tras.toolCallCount).toBe(4);
    expect(tras.agentStepCount).toBe(6);
  });

  it('deja los contadores intactos si el parche no trae ninguno de los dos', async () => {
    const run = await nuevoRun();
    await runs.incrementCounters(run.id, { toolCallCount: 7 });

    const tras = await runs.incrementCounters(run.id, { agentStepCount: 1 });

    expect(tras.toolCallCount).toBe(7);
    expect(tras.agentStepCount).toBe(1);
  });

  it('un mensaje de transicion ilegal empieza por ILLEGAL_AUDIT_RUN_TRANSITION', async () => {
    const run = await nuevoRun();
    await expect(runs.advance(run.id, 'REVIEWING')).rejects.toThrow(/^ILLEGAL_AUDIT_RUN_TRANSITION: CREATED -> REVIEWING/);
    await expect(runs.advance(run.id, 'ANALYZING')).rejects.toThrow(/^ILLEGAL_AUDIT_RUN_TRANSITION/);
  });

  it('avanza un run a FAILED con su codigo de error desde cualquier estado abierto', async () => {
    const run = await nuevoRun();

    const fallido = await runs.fail(run.id, 'EVIDENCE_TIMEOUT', 'Una evidencia no llego a tiempo');

    expect(fallido.status).toBe('FAILED');
    expect(fallido.errorCode).toBe('EVIDENCE_TIMEOUT');
    expect(fallido.errorMessage).toBe('Una evidencia no llego a tiempo');
    expect(fallido.finishedAt).not.toBeNull();
  });

  it('devuelve el ultimo run de la auditoria', async () => {
    await nuevoRun('audit_1');
    const segundo = await nuevoRun('audit_1');
    await nuevoRun('audit_2');

    const ultimo = await runs.latest('audit_1');

    expect(ultimo?.id).toBe(segundo.id);
  });

  it('devuelve null si la auditoria no tiene runs', async () => {
    expect(await runs.latest('audit_vacio')).toBeNull();
    expect(await runs.findById('run_inexistente')).toBeNull();
  });

  it('lista los runs de una auditoria del mas reciente al mas antiguo', async () => {
    const primero = await nuevoRun();
    const segundo = await nuevoRun();

    const listados = await runs.listByAudit('audit_1');

    expect(listados.map((run) => run.id)).toEqual([segundo.id, primero.id]);
  });
});
