import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FoundationFakeDb } from '@/server/facts/foundation-fake-db';

/**
 * Step 4: `POST /fact-reviews` sigue siendo backward compatible.
 *
 * - La review se guarda SIEMPRE igual que antes (append-only) y la respuesta
 *   conserva `{ review }` con status 201. No se elimina ni se renombra ningún
 *   campo existente.
 * - Si hay `correctedValue`, ADEMÁS se deriva un Fact Run nuevo. El padre no se
 *   toca.
 * - Si la derivación falla, la respuesta lo dice con un código estable en vez de
 *   tragarse el error: la review ya está guardada y no se puede borrar, así que
 *   un 500 invitaría al cliente a reintentar y duplicaría la evidencia.
 */

const AUDIT_ID = 'audit-1';
const FACT_ID = 'fact-grades';
const ACTOR_ID = 'actor-1';
const CREATED_AT = '2026-09-25T00:00:00.000Z';

const database = new FoundationFakeDb().withFoundationApplied();
const user = { id: ACTOR_ID };

vi.mock('@/server/auth/session', () => ({ getCurrentUser: async () => user }));
vi.mock('@/server/insforge/server', () => ({ createInsForgeServerClient: async () => ({ database }) }));

const { POST } = await import('./route');

function request(body: unknown) {
  return {
    json: async () => body,
    formData: async () => new Map(),
    url: 'http://localhost/api/audits/audit-1/fact-reviews',
  };
}

const context = { params: Promise.resolve({ auditId: AUDIT_ID }) };

function seed() {
  database.table('audits').length = 0;
  database.table('fact_extraction_runs').length = 0;
  database.table('facts').length = 0;
  database.table('fact_reviews').length = 0;
  database.table('fact_run_frozen_snapshots').length = 0;
  database.rpcCalls.length = 0;
  database.writes.length = 0;
  database.absentRpcs.add('create_derived_fact_run_v1');
  database.rpcHandlers.delete('create_derived_fact_run_v1');

  database.table('audits').push({ id: AUDIT_ID, display_name: 'Caso', status: 'PROCESSING', external_case_id: 'E2E-1', created_by: ACTOR_ID, created_at: CREATED_AT, updated_at: CREATED_AT });
  database.table('fact_extraction_runs').push({
    id: 'run-parent', audit_id: AUDIT_ID, policy_code: 'GDM_GAM_PRD_MLG_003', policy_version: '5',
    extractor_version: 'deterministic-facts-v1', artifact_set_fingerprint: 'artifact-fp', state: 'FROZEN',
    frozen_at: CREATED_AT, effective_facts_fingerprint: 'e'.repeat(64), created_at: CREATED_AT,
  });
  database.table('facts').push({ id: FACT_ID, audit_id: AUDIT_ID, run_id: 'run-parent', fact_type: 'classroom.hasGrades', classification: 'OBSERVABLE', value: false, source_ref: { evidenceId: 'ev-1' }, confidence: 0.6, created_at: CREATED_AT });
  database.table('fact_run_frozen_snapshots').push({
    id: 'snapshot-parent', audit_id: AUDIT_ID, fact_run_id: 'run-parent',
    facts: [{ id: FACT_ID, type: 'classroom.hasGrades', value: false, source: { evidenceId: 'ev-1' }, extractionConfidence: 0.6 }],
    provenance: { schemaVersion: 'fact-run-frozen-snapshot-provenance-v1', origin: 'EXTRACTED', entries: [] },
    fact_reviews_snapshot: [], extractor_version: 'deterministic-facts-v1', policy_source_id: 'gdm-local',
    canonical_facts_fingerprint: 'c'.repeat(64), effective_facts_fingerprint: 'e'.repeat(64), fact_count: 1,
    integrity_hash: 'a'.repeat(64), frozen_by: ACTOR_ID, frozen_at: CREATED_AT, created_at: CREATED_AT,
  });
}

describe('POST /api/audits/[auditId]/fact-reviews', () => {
  beforeEach(() => { seed(); });

  it('con correctedValue guarda la review y devuelve derivedFactRunId (201), sin tocar el padre', async () => {
    const response = await POST(request({ factId: FACT_ID, decision: 'VALID', correctedValue: true, note: ' hay calificaciones ' }) as never, context);
    const body = await response.json();

    expect(response.status).toBe(201);
    // Compatibilidad: el campo que ya existía sigue ahí, con la misma forma.
    expect(body.review).toMatchObject({ fact_id: FACT_ID, decision: 'VALID', corrected_value: true, status: 'ACCEPTED', note: 'hay calificaciones', reviewed_by: ACTOR_ID });
    // Y el campo nuevo.
    expect(typeof body.derivedFactRunId).toBe('string');

    const derived = database.rows('fact_extraction_runs').find((row) => row.id === body.derivedFactRunId);
    expect(derived).toMatchObject({ state: 'FROZEN', parent_fact_run_id: 'run-parent' });
    expect(database.rows('fact_extraction_runs').find((row) => row.id === 'run-parent')).toMatchObject({ state: 'FROZEN', extractor_version: 'deterministic-facts-v1' });
    expect(database.rows('fact_run_frozen_snapshots').find((row) => row.fact_run_id === 'run-parent')).toMatchObject({ integrity_hash: 'a'.repeat(64) });
  });

  it('sin correctedValue NO deriva nada y la respuesta conserva la forma anterior', async () => {
    const response = await POST(request({ factId: FACT_ID, decision: 'INVALID' }) as never, context);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.review).toMatchObject({ fact_id: FACT_ID, decision: 'INVALID', corrected_value: null });
    expect(body.derivedFactRunId).toBeNull();
    expect(database.rows('fact_extraction_runs')).toHaveLength(1);
  });

  it('si la derivación falla, la review sigue guardada y el fallo se declara con un código', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    database.onRpc('create_derived_fact_run_v1', () => ({ data: null, error: { message: 'POLICY_SOURCE_NOT_REGISTERED: gdm-x' } }));

    const response = await POST(request({ factId: FACT_ID, decision: 'VALID', correctedValue: true }) as never, context);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.review).toBeTruthy();
    expect(body.derivedFactRunId).toBeNull();
    expect(body.derivation).toMatchObject({ status: 'FAILED', code: 'DERIVED_FACT_RUN_FAILED' });
    expect(body.derivation.message).toMatch(/POLICY_SOURCE_NOT_REGISTERED/);
    expect(database.rows('fact_reviews')).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('HUMAN_CORRECTION_DERIVATION_FAILED'));
    vi.restoreAllMocks();
  });

  it('sigue rechazando lo que rechazaba antes: auditoría inexistente, ajena, body inválido y dato inexistente', async () => {
    expect((await POST(request({ factId: FACT_ID, decision: 'VALID' }) as never, { params: Promise.resolve({ auditId: 'no-existe' }) })).status).toBe(404);

    database.table('audits').push({ id: 'audit-ajena', display_name: 'Ajena', status: 'DRAFT', external_case_id: null, created_by: 'otro-actor', created_at: CREATED_AT, updated_at: CREATED_AT });
    expect((await POST(request({ factId: FACT_ID, decision: 'VALID' }) as never, { params: Promise.resolve({ auditId: 'audit-ajena' }) })).status).toBe(403);

    const invalid = await POST(request({ decision: 'VALID' }) as never, context);
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toBe('INVALID_INPUT');

    const missing = await POST(request({ factId: 'no-existe', decision: 'VALID' }) as never, context);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBe('FACT_NOT_FOUND');
  });
});
