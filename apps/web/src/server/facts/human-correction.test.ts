import { describe, expect, it, vi } from 'vitest';
import { FoundationFakeDb } from './foundation-fake-db';
import { deriveFactRunFromReviews, type FrozenFactReviewRecord } from './human-correction';

const AUDIT_ID = 'audit-1';
const PARENT_RUN_ID = 'run-parent';
const ACTOR_ID = 'actor-1';
const POLICY_SOURCE_ID = 'gdm-gam-prd-mlg-003-local-unverified';
const CREATED_AT = '2026-09-25T00:00:00.000Z';
const PARENT_EXTRACTOR = 'deterministic-facts-v1';

function seed(db: FoundationFakeDb) {
  db.table('audits').push({ id: AUDIT_ID, display_name: 'Caso', status: 'PROCESSING', external_case_id: 'E2E-1', created_by: ACTOR_ID, created_at: CREATED_AT, updated_at: CREATED_AT });
  db.table('fact_extraction_runs').push({
    id: PARENT_RUN_ID, audit_id: AUDIT_ID, policy_code: 'GDM_GAM_PRD_MLG_003', policy_version: '5',
    extractor_version: PARENT_EXTRACTOR, artifact_set_fingerprint: 'artifact-fp-padre',
    state: 'FROZEN', frozen_at: CREATED_AT, effective_facts_fingerprint: 'e'.repeat(64), created_at: CREATED_AT,
  });
  db.table('facts').push(
    { id: 'fact-grades', audit_id: AUDIT_ID, run_id: PARENT_RUN_ID, fact_type: 'classroom.hasGrades', classification: 'OBSERVABLE', value: false, source_ref: { evidenceId: 'ev-1', artifactId: 'art-1' }, confidence: 0.6, created_at: CREATED_AT },
    { id: 'fact-level', audit_id: AUDIT_ID, run_id: PARENT_RUN_ID, fact_type: 'student.level', classification: 'OBSERVABLE', value: 'LICENCIATURA', source_ref: { evidenceId: 'ev-1', artifactId: 'art-1' }, confidence: 0.9, created_at: CREATED_AT },
  );
  db.table('fact_run_frozen_snapshots').push({
    id: 'snapshot-parent', audit_id: AUDIT_ID, fact_run_id: PARENT_RUN_ID,
    facts: [
      { id: 'fact-grades', type: 'classroom.hasGrades', value: false, source: { evidenceId: 'ev-1', artifactId: 'art-1' }, extractionConfidence: 0.6 },
      { id: 'fact-level', type: 'student.level', value: 'LICENCIATURA', source: { evidenceId: 'ev-1', artifactId: 'art-1' }, extractionConfidence: 0.9 },
    ],
    provenance: { schemaVersion: 'fact-run-frozen-snapshot-provenance-v1', origin: 'EXTRACTED', entries: [] },
    fact_reviews_snapshot: [], extractor_version: PARENT_EXTRACTOR, policy_source_id: POLICY_SOURCE_ID,
    canonical_facts_fingerprint: 'c'.repeat(64), effective_facts_fingerprint: 'e'.repeat(64), fact_count: 2,
    integrity_hash: 'a'.repeat(64), frozen_by: ACTOR_ID, frozen_at: CREATED_AT, created_at: CREATED_AT,
  });
}

function correctionReview(overrides: Partial<FrozenFactReviewRecord> = {}): FrozenFactReviewRecord {
  return {
    reviewId: 'review-1',
    factId: 'fact-grades',
    decision: 'VALID',
    correctedValue: true,
    reviewedBy: ACTOR_ID,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function parentRow(db: FoundationFakeDb): Record<string, unknown> {
  return db.rows('fact_extraction_runs').find((row) => row.id === PARENT_RUN_ID)!;
}

function parentSnapshotRow(db: FoundationFakeDb): Record<string, unknown> {
  return db.rows('fact_run_frozen_snapshots').find((row) => row.fact_run_id === PARENT_RUN_ID)!;
}

describe('deriveFactRunFromReviews — corrección humana crea un run NUEVO (Step 3)', () => {
  it('deriva un run FROZEN hijo, deja el padre intacto y marca la procedencia humana', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    seed(db);
    db.onRpc('create_derived_fact_run_v1', (args) => {
      const derived = db.insert('fact_extraction_runs', {
        audit_id: AUDIT_ID, policy_code: 'GDM_GAM_PRD_MLG_003', policy_version: '5',
        extractor_version: args.p_extractor_version, artifact_set_fingerprint: 'artifact-fp-padre',
        state: 'FROZEN', frozen_at: CREATED_AT, parent_fact_run_id: PARENT_RUN_ID,
        derivation_reason: args.p_derivation_reason, created_by: ACTOR_ID, created_at: CREATED_AT,
      });
      return {
        data: [{
          out_derived_fact_run_id: derived.id, out_derived_snapshot_id: 'snapshot-derived',
          out_parent_fact_run_id: PARENT_RUN_ID, out_parent_fingerprint_before: 'e'.repeat(64), out_parent_fingerprint_after: 'e'.repeat(64),
        }],
        error: null,
      };
    });

    const result = await deriveFactRunFromReviews({
      database: db, auditId: AUDIT_ID, factId: 'fact-grades', correctedValue: true,
      review: correctionReview(), actorId: ACTOR_ID, policySourceId: POLICY_SOURCE_ID,
    });

    // --- El padre NO se toca: ni una columna ---
    expect(parentRow(db)).toMatchObject({ state: 'FROZEN', extractor_version: PARENT_EXTRACTOR, artifact_set_fingerprint: 'artifact-fp-padre' });
    expect(parentSnapshotRow(db)).toMatchObject({ integrity_hash: 'a'.repeat(64), effective_facts_fingerprint: 'e'.repeat(64) });
    expect(result.parentFingerprintBefore).toBe('e'.repeat(64));
    expect(result.parentFingerprintAfter).toBe('e'.repeat(64));
    expect(result.parentFingerprintUnchanged).toBe(true);

    // --- El hijo es un run nuevo, FROZEN, con su padre y su motivo ---
    expect(result.derivedRun.parentFactRunId).toBe(PARENT_RUN_ID);
    expect(result.derivedRun.state).toBe('FROZEN');
    expect(result.derivedRun.derivationReason).toBe('HUMAN_CORRECTION: classroom.hasGrades');
    expect(result.derivedRun.createdBy).toBe(ACTOR_ID);
    expect(result.derivedRun.createdAt).toBeTruthy();
    expect(result.derivedRun.id).not.toBe(PARENT_RUN_ID);
    // El índice único de idempotencia de fact runs sólo deja libre
    // `extractor_version`: tiene que diferir de la del padre o el INSERT choca.
    expect(result.derivedRun.extractorVersion).not.toBe(PARENT_EXTRACTOR);

    // --- El hecho corregido viaja como HUMAN_CORRECTED y la procedencia lo dice ---
    const corrected = result.derivedFacts.find((fact) => fact.id === 'fact-grades');
    expect(corrected).toMatchObject({ factType: 'classroom.hasGrades', classification: 'HUMAN_CORRECTED', value: true });
    expect(result.provenance.some((entry) => entry.extractionMethod === 'HUMAN' && entry.factId === 'fact-grades')).toBe(true);
    // El resto de hechos se hereda del snapshot del padre, sin inventar.
    expect(result.derivedFacts.find((fact) => fact.id === 'fact-level')).toMatchObject({ factType: 'student.level', value: 'LICENCIATURA' });
    expect(result.transport).toBe('RPC');
  });

  it('el RPC recibe razón, provenance, fingerprints y una extractor_version distinta', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    seed(db);
    db.onRpc('create_derived_fact_run_v1', () => ({
      data: [{ out_derived_fact_run_id: 'run-derived', out_derived_snapshot_id: 'snap-derived', out_parent_fact_run_id: PARENT_RUN_ID, out_parent_fingerprint_before: 'e'.repeat(64), out_parent_fingerprint_after: 'e'.repeat(64) }],
      error: null,
    }));

    await deriveFactRunFromReviews({
      database: db, auditId: AUDIT_ID, factId: 'fact-grades', correctedValue: true,
      review: correctionReview(), actorId: ACTOR_ID, policySourceId: POLICY_SOURCE_ID,
    });

    const call = db.rpcCalls.find((entry) => entry.fn === 'create_derived_fact_run_v1');
    expect(call).toBeDefined();
    expect(call!.args.p_parent_fact_run_id).toBe(PARENT_RUN_ID);
    expect(String(call!.args.p_derivation_reason)).toMatch(/HUMAN_CORRECTION/);
    expect(String(call!.args.p_extractor_version)).not.toBe(PARENT_EXTRACTOR);
    expect(String(call!.args.p_canonical_facts_fingerprint)).toMatch(/^[a-f0-9]{64}$/);
    expect(String(call!.args.p_effective_facts_fingerprint)).toMatch(/^[a-f0-9]{64}$/);
    expect(Array.isArray(call!.args.p_facts)).toBe(true);
    const provenance = call!.args.p_provenance as { origin: string; entries: Array<{ extractionMethod: string }> };
    expect(provenance.origin).toBe('HUMAN_CORRECTION');
    expect(provenance.entries.some((entry) => entry.extractionMethod === 'HUMAN')).toBe(true);
  });

  it('sin RPC crea el run derivado localmente recorriendo DRAFT -> PROCESSING -> FROZEN y avisa', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = new FoundationFakeDb();
    seed(db);

    const result = await deriveFactRunFromReviews({
      database: db, auditId: AUDIT_ID, factId: 'fact-grades', correctedValue: true,
      review: correctionReview(), actorId: ACTOR_ID, policySourceId: POLICY_SOURCE_ID,
    });

    expect(result.transport).toBe('LOCAL_FALLBACK');
    expect(result.degradation).toBe('DERIVE_FACT_RUN_RPC_ABSENT');
    expect(result.derivedRun.state).toBe('FROZEN');
    expect(result.derivedRun.parentFactRunId).toBe(PARENT_RUN_ID);
    expect(parentRow(db)).toMatchObject({ state: 'FROZEN', extractor_version: PARENT_EXTRACTOR });
    expect(db.writesOn('fact_extraction_runs').map((write) => (write.values[0] as { state?: string }).state).filter(Boolean)).toEqual(['DRAFT', 'PROCESSING', 'FROZEN']);
    expect(db.rows('facts').filter((row) => row.run_id === result.derivedRun.id)).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('DERIVE_FACT_RUN_RPC_ABSENT'));
    warn.mockRestore();
  });

  it('sin RPC y SIN la columna effective_facts_fingerprint igual deja el run derivado FROZEN', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Mundo real de HOY: la migración no está aplicada, así que
    // `fact_extraction_runs.effective_facts_fingerprint` NO existe y
    // `fact_run_frozen_snapshots` tampoco. Un write que la mencione falla con
    // PGRST204 y el pipeline NO puede romperse por eso.
    const db = new FoundationFakeDb();
    seed(db);

    const result = await deriveFactRunFromReviews({
      database: db, auditId: AUDIT_ID, factId: 'fact-grades', correctedValue: true,
      review: correctionReview(), actorId: ACTOR_ID, policySourceId: POLICY_SOURCE_ID,
    });

    expect(result.transport).toBe('LOCAL_FALLBACK');
    expect(result.derivedRun.state).toBe('FROZEN');
    expect(result.derivedRun.parentFactRunId).toBe(PARENT_RUN_ID);
    expect(db.rows('fact_extraction_runs').find((row) => row.id === result.derivedRun.id)?.effective_facts_fingerprint).toBeUndefined();
    expect(db.rows('facts').filter((row) => row.run_id === result.derivedRun.id)).toHaveLength(2);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('DERIVED_FACT_RUN_FINGERPRINT_COLUMN_ABSENT'));
    vi.restoreAllMocks();
  });

  it('un error REAL del RPC se propaga y no crea ningún run derivado', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    seed(db);
    db.onRpc('create_derived_fact_run_v1', () => ({ data: null, error: { message: 'POLICY_SOURCE_NOT_REGISTERED: gdm-x' } }));

    await expect(deriveFactRunFromReviews({
      database: db, auditId: AUDIT_ID, factId: 'fact-grades', correctedValue: true,
      review: correctionReview(), actorId: ACTOR_ID, policySourceId: POLICY_SOURCE_ID,
    })).rejects.toThrow('POLICY_SOURCE_NOT_REGISTERED');
    expect(db.rows('fact_extraction_runs')).toHaveLength(1);
  });

  it('rechaza entradas que no pueden producir una corrección trazable', async () => {
    const db = new FoundationFakeDb();
    seed(db);
    const base = { database: db, auditId: AUDIT_ID, correctedValue: true, review: correctionReview(), actorId: ACTOR_ID, policySourceId: POLICY_SOURCE_ID };

    await expect(deriveFactRunFromReviews({ ...base, factId: 'no-existe' })).rejects.toThrow('HUMAN_CORRECTION_FACT_NOT_FOUND');
    await expect(deriveFactRunFromReviews({ ...base, factId: 'fact-grades', correctedValue: null })).rejects.toThrow('HUMAN_CORRECTION_CORRECTED_VALUE_REQUIRED');
    await expect(deriveFactRunFromReviews({ ...base, factId: 'fact-grades', correctedValue: undefined })).rejects.toThrow('HUMAN_CORRECTION_CORRECTED_VALUE_REQUIRED');
  });

  it('rechaza corregir un hecho de otro Fact Run sin freeze: no hay snapshot del cual derivar', async () => {
    const db = new FoundationFakeDb();
    seed(db);
    db.table('fact_extraction_runs').push({
      id: 'run-draft', audit_id: AUDIT_ID, policy_code: 'GDM_GAM_PRD_MLG_003', policy_version: '5',
      extractor_version: PARENT_EXTRACTOR, artifact_set_fingerprint: 'otro', state: 'DRAFT', frozen_at: null, created_at: CREATED_AT,
    });
    db.table('facts').push({ id: 'fact-draft', audit_id: AUDIT_ID, run_id: 'run-draft', fact_type: 'student.level', classification: 'OBSERVABLE', value: 'POSTGRADO', source_ref: { evidenceId: 'ev-9' }, confidence: 0.5, created_at: CREATED_AT });

    await expect(deriveFactRunFromReviews({
      database: db, auditId: AUDIT_ID, factId: 'fact-draft', correctedValue: 'LICENCIATURA',
      review: correctionReview({ factId: 'fact-draft' }), actorId: ACTOR_ID, policySourceId: POLICY_SOURCE_ID,
    })).rejects.toThrow('HUMAN_CORRECTION_PARENT_NOT_FROZEN');
  });
});
