import { describe, expect, it, vi } from 'vitest';
import type { FactExtractionRun } from '@cancelaciones/db';
import { stableFingerprint } from '@cancelaciones/domain';
import { FoundationFakeDb, missingFunctionError, type FakeRow } from './foundation-fake-db';
import { freezeFactRunWithSnapshot, getFrozenEffectiveFacts, isFoundationObjectMissing } from './fact-run-snapshot';

const AUDIT_ID = 'audit-1';
const RUN_ID = 'run-1';
const ACTOR_ID = 'actor-1';
const POLICY_SOURCE_ID = 'gdm-gam-prd-mlg-003-local-unverified';
const CREATED_AT = '2026-09-25T00:00:00.000Z';

const frozenRun: FactExtractionRun = {
  id: RUN_ID,
  auditId: AUDIT_ID,
  policyCode: 'GDM_GAM_PRD_MLG_003',
  policyVersion: '5',
  extractorVersion: 'deterministic-facts-v1',
  artifactSetFingerprint: 'artifact-fp',
  state: 'FROZEN',
  frozenAt: CREATED_AT,
  createdAt: CREATED_AT,
};

function seedRun(db: FoundationFakeDb, state: 'DRAFT' | 'PROCESSING' | 'FROZEN' = 'FROZEN') {
  db.table('audits').push({ id: AUDIT_ID, display_name: 'Caso', status: 'PROCESSING', external_case_id: 'E2E-1', created_by: ACTOR_ID, created_at: CREATED_AT, updated_at: CREATED_AT });
  db.table('fact_extraction_runs').push({ id: RUN_ID, audit_id: AUDIT_ID, policy_code: 'GDM_GAM_PRD_MLG_003', policy_version: '5', extractor_version: 'deterministic-facts-v1', artifact_set_fingerprint: 'artifact-fp', state, frozen_at: state === 'FROZEN' ? CREATED_AT : null, created_at: CREATED_AT });
}

function seedFacts(db: FoundationFakeDb) {
  db.table('facts').push(
    { id: 'fact-level', audit_id: AUDIT_ID, run_id: RUN_ID, fact_type: 'student.level', classification: 'OBSERVABLE', value: 'LICENCIATURA', source_ref: { evidenceId: 'ev-1', artifactId: 'art-1', page: 1 }, confidence: 0.9, created_at: CREATED_AT },
    { id: 'fact-login', audit_id: AUDIT_ID, run_id: RUN_ID, fact_type: 'classroom.hasLogin', classification: 'OBSERVABLE', value: false, source_ref: { evidenceId: 'ev-1', artifactId: 'art-1', page: 2 }, confidence: 0.8, created_at: CREATED_AT },
    { id: 'fact-contact', audit_id: AUDIT_ID, run_id: RUN_ID, fact_type: 'contact.effectiveContact', classification: 'OBSERVABLE', value: false, source_ref: { evidenceId: 'ev-2', artifactId: 'art-2' }, confidence: 0.7, created_at: CREATED_AT },
  );
}

function review(row: FakeRow): FakeRow {
  return { id: `review-${row.fact_id}`, audit_id: AUDIT_ID, fact_id: 'fact-contact', decision: 'VALID', status: 'ACCEPTED', corrected_value: true, reviewed_by: ACTOR_ID, created_at: CREATED_AT, ...row };
}

function seedFrozenSnapshotRow(db: FoundationFakeDb, facts: unknown[]) {
  db.table('fact_run_frozen_snapshots').push({
    id: 'snapshot-1',
    audit_id: AUDIT_ID,
    fact_run_id: RUN_ID,
    facts,
    provenance: { schemaVersion: 'fact-run-frozen-snapshot-provenance-v1', origin: 'EXTRACTED', entries: [] },
    fact_reviews_snapshot: [],
    extractor_version: 'deterministic-facts-v1',
    policy_source_id: POLICY_SOURCE_ID,
    canonical_facts_fingerprint: 'c'.repeat(64),
    effective_facts_fingerprint: 'e'.repeat(64),
    fact_count: facts.length,
    integrity_hash: 'a'.repeat(64),
    frozen_by: ACTOR_ID,
    frozen_at: CREATED_AT,
    created_at: CREATED_AT,
  });
}

describe('detección de disponibilidad de la fundación de política', () => {
  it('reconoce AUSENCIA de objeto (PGRST202/205, 42P01, 42883, fake local) y no confunde negocio', () => {
    expect(isFoundationObjectMissing('freeze_fact_run_v1', { message: 'Unsupported rpc freeze_fact_run_v1' })).toBe(true);
    expect(isFoundationObjectMissing('freeze_fact_run_v1', missingFunctionError('freeze_fact_run_v1'))).toBe(true);
    expect(isFoundationObjectMissing('x', { message: `Could not find the table 'public.fact_run_frozen_snapshots' in the schema cache`, code: 'PGRST205' })).toBe(true);
    expect(isFoundationObjectMissing('x', { message: 'ERROR: relation "public.fact_run_frozen_snapshots" does not exist', code: '42P01' })).toBe(true);
    expect(isFoundationObjectMissing('x', { message: 'ERROR: column "x" does not exist', code: '42703' })).toBe(true);
    // Errores de NEGOCIO: no son ausencia. Confundirlos haría que un fallo de
    // autorización pareciera "funciona porque cayó al camino viejo".
    expect(isFoundationObjectMissing('freeze_fact_run_v1', { message: 'AUTH_REQUIRED' })).toBe(false);
    expect(isFoundationObjectMissing('freeze_fact_run_v1', { message: 'FACT_RUN_EMPTY' })).toBe(false);
    expect(isFoundationObjectMissing('freeze_fact_run_v1', { message: 'FORBIDDEN' })).toBe(false);
    expect(isFoundationObjectMissing('freeze_fact_run_v1', { message: 'POLICY_SOURCE_NOT_REGISTERED: x' })).toBe(false);
    expect(isFoundationObjectMissing('freeze_fact_run_v1', { message: 'JWT expired' })).toBe(false);
    expect(isFoundationObjectMissing('freeze_fact_run_v1', null)).toBe(false);
  });
});

describe('getFrozenEffectiveFacts — snapshot congelado (R-8)', () => {
  it('lee los hechos del snapshot y NO vuelve a consultar fact_reviews', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    seedRun(db);
    seedFacts(db);
    db.table('fact_reviews').push(review({ fact_id: 'fact-contact' }));
    seedFrozenSnapshotRow(db, [
      { id: 'fact-level', type: 'student.level', value: 'LICENCIATURA', source: { evidenceId: 'ev-1', artifactId: 'art-1', page: 1 }, extractionConfidence: 0.9 },
      { id: 'fact-login', type: 'classroom.hasLogin', value: false, source: { evidenceId: 'ev-1', artifactId: 'art-1', page: 2 }, extractionConfidence: 0.8 },
      { id: 'fact-contact', type: 'contact.effectiveContact', value: false, source: { evidenceId: 'ev-2', artifactId: 'art-2' }, extractionConfidence: 0.7 },
    ]);

    const result = await getFrozenEffectiveFacts({ database: db, auditId: AUDIT_ID, factRunId: RUN_ID, run: frozenRun });

    expect(result.source).toBe('SNAPSHOT');
    expect(result.persisted).toBe(true);
    expect(result.snapshotId).toBe('snapshot-1');
    // La revisión humana existe en la base y NO se aplicó retrospectivamente:
    // ése es exactamente el corte de R-8.
    expect(db.readCount('fact_reviews')).toBe(0);
    expect(result.facts.map((fact) => [fact.id, fact.value])).toEqual([
      ['fact-level', 'LICENCIATURA'],
      ['fact-login', false],
      ['fact-contact', false],
    ]);
    expect(result.effectiveFactsFingerprint).toBe('e'.repeat(64));
  });

  it('segunda lectura con snapshot y con review nueva devuelve el MISMO hecho y la MISMA huella', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    seedRun(db);
    seedFrozenSnapshotRow(db, [{ id: 'fact-contact', type: 'contact.effectiveContact', value: false, source: { evidenceId: 'ev-2' } }]);

    const first = await getFrozenEffectiveFacts({ database: db, auditId: AUDIT_ID, factRunId: RUN_ID, run: frozenRun });
    db.table('fact_reviews').push(review({ fact_id: 'fact-contact', corrected_value: true, created_at: '2026-09-26T00:00:00.000Z' }));
    const second = await getFrozenEffectiveFacts({ database: db, auditId: AUDIT_ID, factRunId: RUN_ID, run: frozenRun });

    expect(second.facts).toEqual(first.facts);
    expect(second.effectiveFactsFingerprint).toBe(first.effectiveFactsFingerprint);
  });

  it('rechaza un snapshot con forma inválida en vez de producir hechos silenciosamente distintos', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    seedRun(db);
    seedFrozenSnapshotRow(db, 'no-es-un-array' as unknown as unknown[]);

    await expect(getFrozenEffectiveFacts({ database: db, auditId: AUDIT_ID, factRunId: RUN_ID, run: frozenRun })).rejects.toThrow('FROZEN_SNAPSHOT_PAYLOAD_INVALID');
  });
});

describe('getFrozenEffectiveFacts — captura única del run legacy (Step 1/2)', () => {
  it('captura UNA vez, marca IMPORTED/HUMAN, persiste y la segunda llamada no cambia', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    seedRun(db);
    seedFacts(db);
    db.table('fact_reviews').push(review({ fact_id: 'fact-contact' }));

    const first = await getFrozenEffectiveFacts({ database: db, auditId: AUDIT_ID, factRunId: RUN_ID, run: frozenRun });

    expect(first.source).toBe('LEGACY_CAPTURED');
    expect(first.persisted).toBe(true);
    expect(first.snapshotId).not.toBeNull();
    // provenance: objeto (CHECK del servidor) con `entries` (el array que el
    // plan inspecciona con .some()).
    const provenance = first.provenance;
    expect(provenance).not.toBeNull();
    expect(provenance!.origin).toBe('IMPORTED');
    expect(provenance!.entries.some((entry) => entry.extractionMethod === 'HUMAN' && entry.factId === 'fact-contact')).toBe(true);
    expect(provenance!.entries.every((entry) => entry.factId !== 'fact-level' || entry.extractionMethod === 'IMPORTED')).toBe(true);
    expect(db.rows('fact_run_frozen_snapshots')).toHaveLength(1);
    expect(String(db.rows('fact_run_frozen_snapshots')[0].integrity_hash)).toMatch(/^[a-f0-9]{64}$/);

    // Se añade una review nueva: la captura ya sellada no se toca.
    db.table('fact_reviews').push(review({ fact_id: 'fact-login', corrected_value: true, created_at: '2026-09-26T00:00:00.000Z' }));
    const second = await getFrozenEffectiveFacts({ database: db, auditId: AUDIT_ID, factRunId: RUN_ID, run: frozenRun });

    expect(second.source).toBe('SNAPSHOT');
    expect(second.facts).toEqual(first.facts);
    expect(stableFingerprint(second.facts)).toBe(stableFingerprint(first.facts));
    expect(db.rows('fact_run_frozen_snapshots')).toHaveLength(1);
  });

  it('el primer cálculo es byte-equivalente al comportamiento de hoy (INVALID filtra, corrected_value sustituye)', async () => {
    const db = new FoundationFakeDb();
    seedRun(db);
    seedFacts(db);
    db.table('fact_reviews').push(
      review({ fact_id: 'fact-contact', corrected_value: true }),
      review({ fact_id: 'fact-login', decision: 'INVALID', corrected_value: null, created_at: '2026-09-25T01:00:00.000Z' }),
    );

    const result = await getFrozenEffectiveFacts({ database: db, auditId: AUDIT_ID, factRunId: RUN_ID, run: frozenRun });

    // Orden y valores idénticos a `mapStoredFactsToPolicyFacts(facts)` + el map
    // de `corrected_value` que hacía evaluation.ts antes de esta tarea.
    expect(result.facts).toEqual([
      { id: 'fact-level', type: 'student.level', value: 'LICENCIATURA', source: { evidenceId: 'ev-1', artifactId: 'art-1', page: 1 }, extractionConfidence: 0.9 },
      { id: 'fact-contact', type: 'contact.effectiveContact', value: true, source: { evidenceId: 'ev-2', artifactId: 'art-2' }, extractionConfidence: 0.7 },
    ]);
  });

  it('con la tabla ausente degrada al cálculo de hoy, lo avisa y no escribe nada', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = new FoundationFakeDb();
    seedRun(db);
    seedFacts(db);
    db.table('fact_reviews').push(review({ fact_id: 'fact-contact' }));

    const result = await getFrozenEffectiveFacts({ database: db, auditId: AUDIT_ID, factRunId: RUN_ID, run: frozenRun });

    expect(result.source).toBe('LEGACY_REVIEW_APPLIED');
    expect(result.persisted).toBe(false);
    expect(result.snapshotId).toBeNull();
    expect(result.degradation).toBe('FROZEN_SNAPSHOT_TABLE_ABSENT');
    expect(result.facts.map((fact) => fact.id)).toEqual(['fact-level', 'fact-login', 'fact-contact']);
    expect(result.facts.find((fact) => fact.id === 'fact-contact')?.value).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('FROZEN_SNAPSHOT_TABLE_ABSENT'));
    expect(db.writesOn('fact_run_frozen_snapshots')).toEqual([]);
    warn.mockRestore();
  });

  it('si la captura no se puede persistir lo dice con un código estable y devuelve el cálculo de hoy', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Mundo "con migración": la tabla existe pero su INSERT está revocado. El
    // error 42501 NO es ausencia de objeto, así que no puede degradarse en
    // silencio: se avisa y se devuelve el cálculo correcto de todos modos.
    const db = new FoundationFakeDb().withFoundationApplied().withSnapshotInsertRevoked();
    seedRun(db);
    seedFacts(db);

    const result = await getFrozenEffectiveFacts({ database: db, auditId: AUDIT_ID, factRunId: RUN_ID, run: frozenRun });

    expect(result.source).toBe('LEGACY_CAPTURED');
    expect(result.persisted).toBe(false);
    expect(result.degradation).toBe('FROZEN_SNAPSHOT_CAPTURE_NOT_PERSISTED');
    expect(result.persistenceError).toMatch(/permission denied/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('FROZEN_SNAPSHOT_CAPTURE_NOT_PERSISTED'));
    expect(result.facts).toHaveLength(3);
    warn.mockRestore();
  });
});

describe('freezeFactRunWithSnapshot — RPC y degradación (C1 / Step 7)', () => {
  it('con el RPC disponible sella por freeze_fact_run_v1 y NO hace UPDATE directo del estado', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    seedRun(db, 'PROCESSING');
    seedFacts(db);
    db.onRpc('freeze_fact_run_v1', () => ({
      data: [{ out_snapshot_id: 'snapshot-1', out_fact_run_id: RUN_ID, out_audit_id: AUDIT_ID, out_canonical_facts_fingerprint: 'c'.repeat(64), out_effective_facts_fingerprint: 'e'.repeat(64), out_fact_count: 3, out_frozen_at: CREATED_AT }],
      error: null,
    }));

    const result = await freezeFactRunWithSnapshot({ database: db, factRunId: RUN_ID, actorId: ACTOR_ID, policySourceId: POLICY_SOURCE_ID });

    expect(result.transport).toBe('RPC');
    expect(result.state).toBe('FROZEN');
    expect(result.snapshotId).toBe('snapshot-1');
    expect(result.factCount).toBe(3);
    const call = db.rpcCalls.find((entry) => entry.fn === 'freeze_fact_run_v1');
    expect(call).toBeDefined();
    const args = call!.args;
    expect(args.p_fact_run_id).toBe(RUN_ID);
    expect(args.p_policy_source_id).toBe(POLICY_SOURCE_ID);
    expect(Array.isArray(args.p_facts)).toBe(true);
    expect(String(args.p_canonical_facts_fingerprint)).toMatch(/^[a-f0-9]{64}$/);
    expect(String(args.p_effective_facts_fingerprint)).toMatch(/^[a-f0-9]{64}$/);
    expect((args.p_provenance as { origin: string }).origin).toBe('EXTRACTED');
    expect(Array.isArray(args.p_fact_reviews_snapshot)).toBe(true);
    expect(db.writesOn('fact_extraction_runs')).toEqual([]);
  });

  it('sin RPC recorre la máquina de estados legal (PROCESSING -> FROZEN) y avisa con código estable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = new FoundationFakeDb();
    seedRun(db, 'PROCESSING');
    seedFacts(db);

    const result = await freezeFactRunWithSnapshot({ database: db, factRunId: RUN_ID, actorId: ACTOR_ID, policySourceId: POLICY_SOURCE_ID });

    expect(result.transport).toBe('LEGACY_STATE_WALK');
    expect(result.state).toBe('FROZEN');
    expect(result.snapshotId).toBeNull();
    expect(result.degradation).toBe('FREEZE_FACT_RUN_RPC_ABSENT');
    expect(db.rows('fact_extraction_runs')[0]).toMatchObject({ state: 'FROZEN' });
    expect(db.writesOn('fact_extraction_runs').map((write) => (write.values[0] as { state: string }).state)).toEqual(['FROZEN']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('FREEZE_FACT_RUN_RPC_ABSENT'));
    warn.mockRestore();
  });

  it('sin RPC y con el run en DRAFT camina DRAFT -> PROCESSING -> FROZEN (transición simple prohibida por el guard)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = new FoundationFakeDb();
    seedRun(db, 'DRAFT');
    seedFacts(db);

    const result = await freezeFactRunWithSnapshot({ database: db, factRunId: RUN_ID, actorId: ACTOR_ID, policySourceId: POLICY_SOURCE_ID });

    expect(result.transport).toBe('LEGACY_STATE_WALK');
    expect(db.writesOn('fact_extraction_runs').map((write) => (write.values[0] as { state: string }).state)).toEqual(['PROCESSING', 'FROZEN']);
    vi.restoreAllMocks();
  });

  it('un error REAL del RPC se propaga: no degrada a un update que sí escribiría', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    seedRun(db, 'PROCESSING');
    seedFacts(db);
    db.onRpc('freeze_fact_run_v1', () => ({ data: null, error: { message: 'FACT_RUN_EMPTY' } }));

    await expect(freezeFactRunWithSnapshot({ database: db, factRunId: RUN_ID, actorId: ACTOR_ID, policySourceId: POLICY_SOURCE_ID })).rejects.toThrow('FACT_RUN_EMPTY');
    expect(db.writesOn('fact_extraction_runs')).toEqual([]);
  });

  it('rechaza congelar un run sin hechos en vez de sellar un snapshot vacío', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    seedRun(db, 'PROCESSING');

    await expect(freezeFactRunWithSnapshot({ database: db, factRunId: RUN_ID, actorId: ACTOR_ID, policySourceId: POLICY_SOURCE_ID })).rejects.toThrow('FACT_RUN_EMPTY');
  });
});
