import { describe, expect, it, vi } from 'vitest';
import { evaluatePolicy, toAuditEvaluationEnvelopeV1 } from '@cancelaciones/policy-engine';
import { createHash } from 'node:crypto';
import { FoundationFakeDb } from '../facts/foundation-fake-db';
import { persistPolicyEvaluationAtomically } from './evaluation-persistence';

const AUDIT_ID = 'audit-1';
const RUN_ID = 'run-1';
const ACTOR_ID = 'actor-1';

const facts = [
  { id: 'f-1', type: 'student.level', value: 'LICENCIATURA', source: { evidenceId: 'ev-1', artifactId: 'art-1' } },
  { id: 'f-2', type: 'classroom.hasLogin', value: false, source: { evidenceId: 'ev-1', artifactId: 'art-1' } },
  { id: 'f-3', type: 'classroom.hasEvaluationMode', value: false, source: { evidenceId: 'ev-1', artifactId: 'art-1' } },
  { id: 'f-4', type: 'contact.effectiveContact', value: false, source: { evidenceId: 'ev-1', artifactId: 'art-1' } },
];

const evaluation = evaluatePolicy({ policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', facts });
const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');

const input = {
  database: undefined as unknown as FoundationFakeDb,
  auditId: AUDIT_ID,
  factRunId: RUN_ID,
  actorId: ACTOR_ID,
  evaluation,
  factsFingerprint: fingerprint(evaluation.factsFingerprint),
  rulesFingerprint: fingerprint(evaluation.rulesFingerprint),
  policyCodeHash: fingerprint(evaluation.policyCode),
};

function rpcPayload(db: FoundationFakeDb) {
  const created = db.rows('engine_runs').length === 0;
  const id = created ? db.insert('engine_runs', {
    audit_id: AUDIT_ID, fact_run_id: RUN_ID, policy_code: evaluation.policyCode,
    policy_code_hash: fingerprint(evaluation.policyCode), policy_version: evaluation.policyVersion,
    rules_fingerprint: input.rulesFingerprint, facts_fingerprint: input.factsFingerprint,
    status: 'COMPLETED', suggested_outcome: evaluation.suggestedOutcome,
    outcome_status: evaluation.outcomeStatus, evaluation, created_at: '2026-09-25T00:00:00.000Z',
  }).id : db.rows('engine_runs')[0].id;
  for (const rule of evaluation.evaluatedRules) {
    if (!db.rows('engine_rule_results').some((row) => row.engine_run_id === id && row.rule_id === rule.ruleId)) {
      db.insert('engine_rule_results', { engine_run_id: id, rule_id: rule.ruleId, status: rule.status, result: rule });
    }
  }
  return { data: [{ out_engine_run_id: id, out_created: created, out_envelope_id: 'env-1', out_baseline_run_id: 'run-baseline' }], error: null };
}

describe('persistPolicyEvaluationAtomically — RPC con degradación (C2)', () => {
  it('con el RPC disponible escribe por persist_policy_evaluation_v1 y NO inserta directo', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    db.onRpc('persist_policy_evaluation_v1', () => rpcPayload(db));
    const result = await persistPolicyEvaluationAtomically({ ...input, database: db });

    expect(result.transport).toBe('RPC');
    expect(result.created).toBe(true);
    expect(result.engineRun.id).toBeTruthy();
    expect(db.rpcCalls.map((call) => call.fn)).toEqual(['persist_policy_evaluation_v1']);
    const args = db.rpcCalls[0].args;
    expect(args.p_audit_id).toBe(AUDIT_ID);
    expect(args.p_fact_run_id).toBe(RUN_ID);
    expect(args.p_facts_fingerprint).toBe(input.factsFingerprint);
    expect(args.p_rules_fingerprint).toBe(input.rulesFingerprint);
    const envelope = args.p_envelope as { schemaVersion: string };
    expect(envelope.schemaVersion).toBe('audit-evaluation-envelope-v1');
    expect(String(args.p_envelope_hash)).toMatch(/^[a-f0-9]{64}$/);
    expect(Array.isArray(args.p_evaluated_rules)).toBe(true);
    expect((args.p_evaluated_rules as Array<{ rule_id: string }>).every((rule) => rule.rule_id.length > 0)).toBe(true);
    expect(db.writesOn('engine_runs')).toEqual([]);
    expect(db.writesOn('engine_rule_results')).toEqual([]);
  });

  it('la segunda persistencia del MISMO engine run es idempotente: created=false, cero resultados nuevos', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    db.onRpc('persist_policy_evaluation_v1', () => rpcPayload(db));
    const first = await persistPolicyEvaluationAtomically({ ...input, database: db });
    const rulesAfterFirst = db.rows('engine_rule_results').length;
    const second = await persistPolicyEvaluationAtomically({ ...input, database: db });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.engineRun.id).toBe(first.engineRun.id);
    expect(db.rows('engine_runs')).toHaveLength(1);
    expect(db.rows('engine_rule_results')).toHaveLength(rulesAfterFirst);
  });

  it('sin RPC degrada a los DOS inserts directos de hoy y lo avisa', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = new FoundationFakeDb();
    const result = await persistPolicyEvaluationAtomically({ ...input, database: db });

    expect(result.transport).toBe('LEGACY_DIRECT_INSERT');
    expect(result.degradation).toBe('PERSIST_POLICY_EVALUATION_RPC_ABSENT');
    expect(result.created).toBe(true);
    expect(db.rows('engine_runs')).toHaveLength(1);
    expect(db.rows('engine_runs')[0]).toMatchObject({ facts_fingerprint: input.factsFingerprint, status: 'COMPLETED', suggested_outcome: evaluation.suggestedOutcome });
    expect(db.rows('engine_rule_results').length).toBe(evaluation.evaluatedRules.length);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('PERSIST_POLICY_EVALUATION_RPC_ABSENT'));
    warn.mockRestore();
  });

  it('sin RPC, repetir la evaluación NO duplica engine_runs (misma idempotencia que hoy)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = new FoundationFakeDb();
    const first = await persistPolicyEvaluationAtomically({ ...input, database: db });
    const second = await persistPolicyEvaluationAtomically({ ...input, database: db });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(db.rows('engine_runs')).toHaveLength(1);
    warn.mockRestore();
  });

  it('un error REAL del RPC se propaga y no inserta nada', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    db.onRpc('persist_policy_evaluation_v1', () => ({ data: null, error: { message: 'FROZEN_SNAPSHOT_MISSING' } }));

    await expect(persistPolicyEvaluationAtomically({ ...input, database: db })).rejects.toThrow('FROZEN_SNAPSHOT_MISSING');
    expect(db.rows('engine_runs')).toEqual([]);
    expect(db.rows('engine_rule_results')).toEqual([]);
  });

  it('el hash del envelope cubre el envelope de policy-engine y no se puede alterar sin cambiar el hash', () => {
    const envelope = toAuditEvaluationEnvelopeV1(evaluation);
    const first = createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
    const altered = toAuditEvaluationEnvelopeV1({ ...evaluation, suggestedOutcome: 'BAJA' });
    const second = createHash('sha256').update(JSON.stringify(altered)).digest('hex');
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
  });
});
