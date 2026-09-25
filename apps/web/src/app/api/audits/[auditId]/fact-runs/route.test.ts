import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FoundationFakeDb } from '@/server/facts/foundation-fake-db';

/**
 * C1: este route hacía `repo.freezeRun(run.id)`, que era `DRAFT -> FROZEN` en un
 * solo `UPDATE`. Con la migración aplicada, `guard_fact_run_transition` aborta
 * esa transición y el route devolvía 500.
 *
 * Ahora congela con `freezeFactRunWithSnapshot`, que sella el snapshot por
 * `freeze_fact_run_v1` cuando el RPC existe y recorre la máquina de estados
 * legal cuando todavía no existe. Este test fija las DOS ramas y comprueba que
 * el route no acepta inventar una auditoría ajena.
 */

const AUDIT_ID = 'audit-1';
const RUN_ID = 'run-1';
const ACTOR_ID = 'actor-1';
const CREATED_AT = '2026-09-25T00:00:00.000Z';

const database = new FoundationFakeDb().withFoundationApplied();
const user = { id: ACTOR_ID };

vi.mock('@/server/auth/session', () => ({ getCurrentUser: async () => user }));
vi.mock('@/server/insforge/server', () => ({ createInsForgeServerClient: async () => ({ database }) }));

const { POST, GET } = await import('./route');

function request(form: Record<string, string>) {
  return {
    formData: async () => new Map(Object.entries(form)),
    url: 'http://localhost/api/audits/audit-1/fact-runs',
  };
}

const context = { params: Promise.resolve({ auditId: AUDIT_ID }) };

function seed(state: 'DRAFT' | 'PROCESSING' | 'FROZEN') {
  database.table('audits').length = 0;
  database.table('fact_extraction_runs').length = 0;
  database.table('facts').length = 0;
  database.rpcCalls.length = 0;
  database.writes.length = 0;
  database.absentRpcs.add('freeze_fact_run_v1');
  database.rpcHandlers.delete('freeze_fact_run_v1');

  database.table('audits').push({ id: AUDIT_ID, display_name: 'Caso', status: 'PROCESSING', external_case_id: 'E2E-1', created_by: ACTOR_ID, created_at: CREATED_AT, updated_at: CREATED_AT });
  database.table('fact_extraction_runs').push({
    id: RUN_ID, audit_id: AUDIT_ID, policy_code: 'GDM_GAM_PRD_MLG_003', policy_version: '5',
    extractor_version: 'deterministic-facts-v1', artifact_set_fingerprint: 'artifact-fp', state,
    frozen_at: state === 'FROZEN' ? CREATED_AT : null, created_at: CREATED_AT,
  });
  database.table('facts').push({ id: 'fact-level', audit_id: AUDIT_ID, run_id: RUN_ID, fact_type: 'student.level', classification: 'OBSERVABLE', value: 'LICENCIATURA', source_ref: { evidenceId: 'ev-1' }, confidence: 0.9, created_at: CREATED_AT });
}

describe('POST /api/audits/[auditId]/fact-runs', () => {
  beforeEach(() => { seed('DRAFT'); });

  it('con la migración aplicada sella por freeze_fact_run_v1 y redirige', async () => {
    database.onRpc('freeze_fact_run_v1', () => ({
      data: [{ out_snapshot_id: 'snapshot-1', out_fact_run_id: RUN_ID, out_audit_id: AUDIT_ID, out_canonical_facts_fingerprint: 'c'.repeat(64), out_effective_facts_fingerprint: 'e'.repeat(64), out_fact_count: 1, out_frozen_at: CREATED_AT }],
      error: null,
    }));

    const response = await POST(request({ action: 'FREEZE', factRunId: RUN_ID }) as never, context);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain(`/auditorias/${AUDIT_ID}`);
    expect(database.rpcCalls.map((call) => call.fn)).toEqual(['freeze_fact_run_v1']);
  });

  it('sin la migración congela por la máquina de estados legal y redirige', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const response = await POST(request({ action: 'FREEZE', factRunId: RUN_ID }) as never, context);

    expect(response.status).toBe(307);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('FREEZE_FACT_RUN_RPC_ABSENT'));
    expect(database.table('fact_extraction_runs')[0].state).toBe('FROZEN');
    expect(database.writesOn('fact_extraction_runs').map((write) => (write.values[0] as { state: string }).state)).toEqual(['PROCESSING', 'FROZEN']);
    warn.mockRestore();
  });

  it('un run ya FROZEN se reutiliza sin escribir (200, reused)', async () => {
    seed('FROZEN');

    const response = await POST(request({ action: 'FREEZE', factRunId: RUN_ID }) as never, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reused).toBe(true);
    expect(body.factRun.state).toBe('FROZEN');
    expect(database.rpcCalls).toEqual([]);
  });

  it('conserva los rechazos previos: input inválido, run inexistente, run ajeno y run sin facts', async () => {
    expect((await POST(request({ action: 'NOPE', factRunId: RUN_ID }) as never, context)).status).toBe(400);
    expect((await POST(request({ action: 'FREEZE', factRunId: 'no-existe' }) as never, context)).status).toBe(404);

    database.table('fact_extraction_runs').push({ id: 'run-ajeno', audit_id: 'audit-ajena', policy_code: 'GDM_GAM_PRD_MLG_003', policy_version: '5', extractor_version: 'x', artifact_set_fingerprint: 'y', state: 'DRAFT', frozen_at: null, created_at: CREATED_AT });
    expect((await POST(request({ action: 'FREEZE', factRunId: 'run-ajeno' }) as never, context)).status).toBe(404);

    database.table('facts').length = 0;
    const empty = await POST(request({ action: 'FREEZE', factRunId: RUN_ID }) as never, context);
    expect(empty.status).toBe(409);
    expect((await empty.json()).error).toBe('FACT_RUN_EMPTY');
  });

  it('GET sigue devolviendo factRuns, selectedRun y facts', async () => {
    const response = await GET({} as never, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.factRuns).toHaveLength(1);
    expect(body.selectedRun.id).toBe(RUN_ID);
    expect(body.facts).toHaveLength(1);
  });
});
