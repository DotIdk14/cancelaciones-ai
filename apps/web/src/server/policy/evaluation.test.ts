import { describe, expect, it, vi } from 'vitest';
import { stableFingerprint } from '@cancelaciones/domain';
import { FoundationFakeDb } from '../facts/foundation-fake-db';
import { runPolicyEngineForAudit } from './evaluation';

/**
 * Step 5 del plan: "runPolicyEngineForAudit con el mismo Fact Run/snapshot debe
 * producir una evaluación idéntica, aunque fact_reviews cambie."
 *
 * Este archivo es la PRUEBA DE LA CONSTRAINT CENTRAL: la migración no puede
 * cambiar ningún outcome. Por eso hay dos escenarios y ambos deben pasar:
 *
 *  A) CON snapshot sellado (mundo migrado): una review nueva NO mueve la
 *     evaluación. Es el comportamiento que R-8 habilita.
 *  B) SIN la tabla (mundo real de hoy): el resultado tiene que ser EXACTAMENTE
 *     el mismo que daba `evaluation.ts` antes de esta tarea, reviews aplicadas.
 */

const AUDIT_ID = 'audit-1';
const RUN_ID = 'run-1';
const ACTOR_ID = 'actor-1';
const CREATED_AT = '2026-09-25T00:00:00.000Z';

const input = {
  auditId: AUDIT_ID,
  actorId: ACTOR_ID,
  policyCode: 'GDM_GAM_PRD_MLG_003',
  policyVersion: '5',
  factRunId: RUN_ID,
};

function seed(db: FoundationFakeDb) {
  db.table('audits').push({ id: AUDIT_ID, display_name: 'Caso', status: 'PROCESSING', external_case_id: 'E2E-1', created_by: ACTOR_ID, created_at: CREATED_AT, updated_at: CREATED_AT });
  db.table('fact_extraction_runs').push({
    id: RUN_ID, audit_id: AUDIT_ID, policy_code: 'GDM_GAM_PRD_MLG_003', policy_version: '5',
    extractor_version: 'deterministic-facts-v1', artifact_set_fingerprint: 'artifact-fp', state: 'FROZEN',
    frozen_at: CREATED_AT, created_at: CREATED_AT,
  });
  db.table('facts').push(
    { id: 'fact-level', audit_id: AUDIT_ID, run_id: RUN_ID, fact_type: 'student.level', classification: 'OBSERVABLE', value: 'LICENCIATURA', source_ref: { evidenceId: 'ev-1', artifactId: 'art-1', page: 1 }, confidence: 0.9, created_at: CREATED_AT },
    { id: 'fact-login', audit_id: AUDIT_ID, run_id: RUN_ID, fact_type: 'classroom.hasLogin', classification: 'OBSERVABLE', value: false, source_ref: { evidenceId: 'ev-1', artifactId: 'art-1', page: 2 }, confidence: 0.8, created_at: CREATED_AT },
    { id: 'fact-mode', audit_id: AUDIT_ID, run_id: RUN_ID, fact_type: 'classroom.hasEvaluationMode', classification: 'OBSERVABLE', value: false, source_ref: { evidenceId: 'ev-1', artifactId: 'art-1', page: 3 }, confidence: 0.8, created_at: CREATED_AT },
    { id: 'fact-contact', audit_id: AUDIT_ID, run_id: RUN_ID, fact_type: 'contact.effectiveContact', classification: 'OBSERVABLE', value: false, source_ref: { evidenceId: 'ev-2', artifactId: 'art-2' }, confidence: 0.7, created_at: CREATED_AT },
  );
}

function seedSnapshot(db: FoundationFakeDb) {
  db.table('fact_run_frozen_snapshots').push({
    id: 'snapshot-1', audit_id: AUDIT_ID, fact_run_id: RUN_ID,
    facts: [
      { id: 'fact-level', type: 'student.level', value: 'LICENCIATURA', source: { evidenceId: 'ev-1', artifactId: 'art-1', page: 1 }, extractionConfidence: 0.9 },
      { id: 'fact-login', type: 'classroom.hasLogin', value: false, source: { evidenceId: 'ev-1', artifactId: 'art-1', page: 2 }, extractionConfidence: 0.8 },
      { id: 'fact-mode', type: 'classroom.hasEvaluationMode', value: false, source: { evidenceId: 'ev-1', artifactId: 'art-1', page: 3 }, extractionConfidence: 0.8 },
      { id: 'fact-contact', type: 'contact.effectiveContact', value: false, source: { evidenceId: 'ev-2', artifactId: 'art-2' }, extractionConfidence: 0.7 },
    ],
    provenance: { schemaVersion: 'fact-run-frozen-snapshot-provenance-v1', origin: 'EXTRACTED', entries: [] },
    fact_reviews_snapshot: [], extractor_version: 'deterministic-facts-v1', policy_source_id: 'gdm-local',
    canonical_facts_fingerprint: 'c'.repeat(64), effective_facts_fingerprint: 'e'.repeat(64), fact_count: 4,
    integrity_hash: 'a'.repeat(64), frozen_by: ACTOR_ID, frozen_at: CREATED_AT, created_at: CREATED_AT,
  });
}

function review(factId: string, correctedValue: unknown, createdAt: string) {
  return { id: `review-${factId}-${createdAt}`, audit_id: AUDIT_ID, fact_id: factId, decision: 'VALID', status: 'ACCEPTED', corrected_value: correctedValue, reviewed_by: ACTOR_ID, created_at: createdAt };
}

describe('runPolicyEngineForAudit — evaluación estable (Step 5)', () => {
  it('CON snapshot: cambiar fact_reviews NO mueve la evaluación ni crea un segundo engine run', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    seed(db);
    seedSnapshot(db);

    const first = await runPolicyEngineForAudit({ ...input, database: db });
    db.table('fact_reviews').push(review('fact-contact', true, '2026-09-26T00:00:00.000Z'));
    const second = await runPolicyEngineForAudit({ ...input, database: db });

    expect(second.evaluation.suggestedOutcome).toBe(first.evaluation.suggestedOutcome);
    expect(second.evaluation.factsFingerprint).toBe(first.evaluation.factsFingerprint);
    expect(second.evaluation.outcomeStatus).toBe(first.evaluation.outcomeStatus);
    expect(second.evaluation.decisionStatus).toBe(first.evaluation.decisionStatus);
    expect(second.factsUsed).toBe(first.factsUsed);
    expect(second.created).toBe(false);
    expect(second.engineRun.id).toBe(first.engineRun.id);
    expect(db.rows('engine_runs')).toHaveLength(1);
    expect(stableFingerprint(second.evaluation.evaluatedRules)).toBe(stableFingerprint(first.evaluation.evaluatedRules));
  });

  it('CON snapshot: los hechos evaluados SON los del snapshot, no los de fact_reviews', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    seed(db);
    seedSnapshot(db);
    db.table('fact_reviews').push(review('fact-contact', true, CREATED_AT));

    const result = await runPolicyEngineForAudit({ ...input, database: db });

    const contact = result.evaluation.evaluatedRules.flatMap((rule) => rule.conditions).find((condition) => condition.id === 'no-effective-contact');
    expect(contact?.observedValue).toBe('Contacto efectivo: no');
  });

  it('SIN la tabla (mundo real de hoy): el resultado es el de siempre, con la review aplicada', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = new FoundationFakeDb();
    seed(db);
    db.table('fact_reviews').push(review('fact-contact', true, CREATED_AT));

    const result = await runPolicyEngineForAudit({ ...input, database: db });

    // La review dice que SÍ hubo contacto efectivo: la condición
    // `no-effective-contact` pasa a FALSE, así que no hay outcome de
    // cancelación de venta. Lo que importa aquí es que el ARRAY de hechos sea
    // exactamente el de antes de esta tarea.
    expect(result.evaluation.suggestedOutcome).toBeNull();
    expect(result.evaluation.factsFingerprint).toBe(stableFingerprint([
      { id: 'fact-level', type: 'student.level', value: 'LICENCIATURA', source: { evidenceId: 'ev-1', artifactId: 'art-1', page: 1 }, extractionConfidence: 0.9 },
      { id: 'fact-login', type: 'classroom.hasLogin', value: false, source: { evidenceId: 'ev-1', artifactId: 'art-1', page: 2 }, extractionConfidence: 0.8 },
      { id: 'fact-mode', type: 'classroom.hasEvaluationMode', value: false, source: { evidenceId: 'ev-1', artifactId: 'art-1', page: 3 }, extractionConfidence: 0.8 },
      { id: 'fact-contact', type: 'contact.effectiveContact', value: true, source: { evidenceId: 'ev-2', artifactId: 'art-2' }, extractionConfidence: 0.7 },
    ]));
    expect(result.factsUsed).toBe(4);
    expect(result.created).toBe(true);
    expect(db.rows('engine_runs')).toHaveLength(1);
    expect(db.rows('audit_runs')).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('SIN la tabla: registrar una review nueva cambia el outcome (comportamiento previo, sin congelar)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = new FoundationFakeDb();
    seed(db);

    const before = await runPolicyEngineForAudit({ ...input, database: db });
    // Sin contacto efectivo + sin login + sin modalidad => CANCELACION_VENTA.
    expect(before.evaluation.suggestedOutcome).toBe('CANCELACION_VENTA');

    // La review declara que SÍ hubo contacto efectivo: la condición
    // `no-effective-contact` pasa a FALSE y el outcome se va.
    db.table('fact_reviews').push(review('fact-contact', true, '2026-09-26T00:00:00.000Z'));
    const after = await runPolicyEngineForAudit({ ...input, database: db });

    expect(after.evaluation.suggestedOutcome).not.toBe(before.evaluation.suggestedOutcome);
    expect(after.evaluation.factsFingerprint).not.toBe(before.evaluation.factsFingerprint);
    expect(db.rows('engine_runs')).toHaveLength(2);
    vi.restoreAllMocks();
  });

  it('rechaza un Fact Run que no está FROZEN, con el mismo código que antes', async () => {
    const db = new FoundationFakeDb();
    seed(db);
    db.table('fact_extraction_runs')[0].state = 'DRAFT';

    await expect(runPolicyEngineForAudit({ ...input, database: db })).rejects.toThrow('FACT_RUN_NOT_FROZEN');
  });

  it('rechaza una auditoría inexistente con AUDIT_NOT_FOUND', async () => {
    const db = new FoundationFakeDb();
    seed(db);

    await expect(runPolicyEngineForAudit({ ...input, auditId: 'no-existe', database: db })).rejects.toThrow('AUDIT_NOT_FOUND');
  });
});
