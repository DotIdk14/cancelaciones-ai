import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAdminClient, createClient } from '@insforge/sdk';
import {
  AI_DECISION_V1_ALREADY_EXISTS,
  createAuditRepository,
  createPolicyFoundationRepository,
  type DatabaseClient,
} from '@cancelaciones/db';
import { buildAiDecisionV1Snapshot } from './ai-decision-snapshot';

/**
 * E2E de ESQUEMA y RLS de los fundamentos de política.
 *
 * Sin backend DEV configurado este archivo NO simula un PASS: `requireDevEnv()`
 * lanza `DEV_INFRA_NOT_CONFIGURED` y vitest sale con código distinto de cero.
 * Eso es el resultado correcto (DB VALIDATION: BLOCKED), no un fallo escondido.
 *
 * POR QUÉ NO HAY SQL CRUDO AQUÍ: el único acceso a base de datos del repo es
 * `@insforge/sdk`, que es un cliente PostgREST. PostgREST sólo expone `from()`
 * y `rpc()`: no hay forma de mandar `has_table_privilege(...)` ni de abrir una
 * transacción multi-sentido desde el test. Por eso la migración define dos sondas
 * acotadas (`policy_foundation_acl_probe`, sólo lectura de metadatos de ACL, y
 * `policy_foundation_immutability_probe`, con cada mutación dentro de una
 * subtransacción que se revierte). Los SONDEOS están en la base de datos; las
 * ASERCIONES están aquí.
 */

const DEV_BRANCH_APPKEY = '4pw4jdzv-cif';

const POLICY_CODE = 'GDM_GAM_PRD_MLG_003';
const POLICY_VERSION = '5';
const EXTRACTOR_VERSION = 'deterministic-facts-v1';
const POLICY_SOURCE_ID = 'gdm-gam-prd-mlg-003-local-unverified';
const EFFECTIVE_FINGERPRINT = 'e'.repeat(64);
const CANONICAL_FINGERPRINT = 'c'.repeat(64);

const NEW_TABLES = [
  'policy_source_registry',
  'fact_run_frozen_snapshots',
  'audit_evaluation_envelopes',
  'ai_decision_snapshots',
] as const;

interface AclRow {
  out_object_name: string;
  out_role_name: string;
  out_can_select: boolean;
  out_can_insert: boolean;
  out_can_update: boolean;
  out_can_delete: boolean;
}

interface ProbeRow {
  out_probe_name: string;
  out_probe_blocked: boolean;
  out_probe_detail: string;
}

function requireDevEnv() {
  const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const anonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
  const apiKey = process.env.INSFORGE_DEV_API_KEY;
  const actorId = process.env.INSFORGE_DEV_ACTOR_ID;
  if (!baseUrl || !anonKey || !apiKey || !actorId) throw new Error('DEV_INFRA_NOT_CONFIGURED: NEXT_PUBLIC_INSFORGE_URL, NEXT_PUBLIC_INSFORGE_ANON_KEY, INSFORGE_DEV_API_KEY e INSFORGE_DEV_ACTOR_ID son obligatorios. No hay fallback.');
  if (!baseUrl.includes(DEV_BRANCH_APPKEY)) throw new Error(`REFUSING_NON_DEV_INSFORGE_URL: esperado appkey DEV ${DEV_BRANCH_APPKEY}.`);
  return { baseUrl, anonKey, apiKey, actorId };
}

/** Invoca un RPC por el canal PostgREST y propaga el error del servidor. */
async function rpc<T>(database: DatabaseClient, fn: string, args?: Record<string, unknown>): Promise<T[]> {
  if (typeof database.rpc !== 'function') throw new Error(`RPC_UNAVAILABLE: ${fn}`);
  const { data, error } = await database.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message ?? 'error desconocido'}`);
  return (data ?? []) as T[];
}

function aclIndex(rows: AclRow[]): Map<string, AclRow> {
  return new Map(rows.map((row) => [`${row.out_role_name}|${row.out_object_name}`, row]));
}

describe('POLICY FOUNDATION SCHEMA + RLS DEV INFRA E2E', () => {
  it('rechaza SELECT anónimo, afirma la ACL y prueba que FROZEN/COMPLETED son irreversibles', async () => {
    const env = requireDevEnv();
    const admin = createAdminClient({ baseUrl: env.baseUrl, apiKey: env.apiKey });
    const database = admin.database as unknown as DatabaseClient;
    const actorId = env.actorId;

    await database.from('profiles').upsert([{ id: actorId, role: 'AUDITOR', display_name: 'POLICY FOUNDATION E2E' }]);
    const audit = await createAuditRepository(database).create({
      createdBy: actorId,
      displayName: 'POLICY FOUNDATION E2E',
      externalCaseId: `POLICY-FOUNDATION-E2E-${Date.now()}`,
    });

    // ---------------------------------------------------------------------
    // 1) SELECT anónimo rechazado. Un cliente sin sesión no tiene privilegio
    //    ni política que le devuelva una fila de estas tablas.
    // ---------------------------------------------------------------------
    const anonymous = createClient({ baseUrl: env.baseUrl, anonKey: env.anonKey });
    const anonymousDatabase = anonymous.database as unknown as DatabaseClient;
    for (const table of NEW_TABLES) {
      const read = await anonymousDatabase.from(table).select('*').limit(1);
      const leaked = (read.data ?? []).length;
      expect(read.error !== null || leaked === 0, `${table} filtró ${leaked} filas a anon`).toBe(true);
    }

    // ---------------------------------------------------------------------
    // 2) ACL real leída con has_table_privilege. Primera barrera: el rol de
    //    cliente no puede ni intentar la escritura.
    // ---------------------------------------------------------------------
    const acl = aclIndex(await rpc<AclRow>(database, 'policy_foundation_acl_probe'));

    const expectAcl = (role: string, object: string, expected: Partial<Omit<AclRow, 'out_object_name' | 'out_role_name'>>) => {
      const row = acl.get(`${role}|public.${object}`);
      expect(row, `noACL:${role}|${object}`).toBeDefined();
      for (const [key, value] of Object.entries(expected)) {
        expect(row![key as keyof AclRow], `${role}|${object}.${key}`).toBe(value);
      }
    };

    // anon no ve nada de la política fundacional.
    for (const object of NEW_TABLES) {
      expectAcl('anon', object, { out_can_select: false, out_can_insert: false, out_can_update: false, out_can_delete: false });
    }
    for (const object of ['facts', 'fact_extraction_runs', 'engine_runs', 'engine_rule_results', 'audit_runs']) {
      expectAcl('anon', object, { out_can_select: false, out_can_insert: false, out_can_update: false, out_can_delete: false });
    }

    // authenticated: lectura de catálogo y de snapshots; escritura sólo donde hace falta.
    expectAcl('authenticated', 'policy_source_registry', { out_can_select: true, out_can_insert: false, out_can_update: false, out_can_delete: false });
    expectAcl('authenticated', 'fact_run_frozen_snapshots', { out_can_select: true, out_can_insert: false, out_can_update: false, out_can_delete: false });
    expectAcl('authenticated', 'audit_evaluation_envelopes', { out_can_select: true, out_can_insert: false, out_can_update: false, out_can_delete: false });
    // ai_decision_snapshots conserva INSERT porque `appendAiDecisionV1` inserta
    // directo; UPDATE y DELETE están revocados y además hay trigger.
    expectAcl('authenticated', 'ai_decision_snapshots', { out_can_select: true, out_can_insert: true, out_can_update: false, out_can_delete: false });
    // La escritura del motor normativo pasa sólo por persist_policy_evaluation_v1.
    expectAcl('authenticated', 'engine_runs', { out_can_select: true, out_can_insert: false, out_can_update: false, out_can_delete: false });
    expectAcl('authenticated', 'engine_rule_results', { out_can_select: true, out_can_insert: false, out_can_update: false, out_can_delete: false });
    expectAcl('authenticated', 'facts', { out_can_update: false, out_can_delete: false });
    expectAcl('authenticated', 'fact_extraction_runs', { out_can_delete: false });

    // ---------------------------------------------------------------------
    // 3) Fixture: fact run FROZEN con snapshot sellado, decisión de máquina
    //    AI_DECISION_V1 y su corrida COMPLETED.
    // ---------------------------------------------------------------------
    const run = await database
      .from('fact_extraction_runs')
      .insert([{
        audit_id: audit.id,
        policy_code: POLICY_CODE,
        policy_version: POLICY_VERSION,
        extractor_version: EXTRACTOR_VERSION,
        artifact_set_fingerprint: 'policy-foundation-e2e-artifacts',
        state: 'DRAFT',
        created_by: actorId,
      }])
      .select('id,audit_id,state')
      .single();
    expect(run.error ?? null, run.error?.message ?? '').toBeNull();
    const factRunId = String(run.data.id);

    // DRAFT -> PROCESSING es la única transición legal de entrada al trabajo.
    const processing = await database
      .from('fact_extraction_runs')
      .update({ state: 'PROCESSING' })
      .eq('id', factRunId)
      .select('state')
      .single();
    expect(processing.error ?? null, processing.error?.message ?? '').toBeNull();
    expect(processing.data.state).toBe('PROCESSING');

    // DRAFT -> FROZEN directo debe quedar bloqueado por guard_fact_run_transition.
    const illegalTransition = await database
      .from('fact_extraction_runs')
      .update({ state: 'FROZEN' })
      .eq('id', factRunId);
    expect(String(illegalTransition.error?.message ?? '')).toMatch(/FACT_RUN_STATE_TRANSITION_FORBIDDEN/);

    const facts = await database
      .from('facts')
      .insert([{
        audit_id: audit.id,
        run_id: factRunId,
        fact_type: 'policy.foundation.probe',
        classification: 'OBSERVABLE',
        value: 'true',
        source_ref: { probe: true },
        confidence: 1,
      }])
      .select('id')
      .single();
    expect(facts.error ?? null, facts.error?.message ?? '').toBeNull();
    const factId = String(facts.data.id);

    const snapshot = await database
      .from('fact_run_frozen_snapshots')
      .insert([{
        audit_id: audit.id,
        fact_run_id: factRunId,
        facts: [{ id: factId, factType: 'policy.foundation.probe', value: 'true' }],
        provenance: { source: 'POLICY_FOUNDATION_E2E' },
        extractor_version: EXTRACTOR_VERSION,
        policy_source_id: POLICY_SOURCE_ID,
        canonical_facts_fingerprint: CANONICAL_FINGERPRINT,
        effective_facts_fingerprint: EFFECTIVE_FINGERPRINT,
        fact_count: 1,
        integrity_hash: createHash('sha256').update(`e2e:${factRunId}`).digest('hex'),
        frozen_by: actorId,
      }])
      .select('id')
      .single();
    expect(snapshot.error ?? null, snapshot.error?.message ?? '').toBeNull();

    const frozen = await database
      .from('fact_extraction_runs')
      .update({ state: 'FROZEN', frozen_at: new Date().toISOString(), effective_facts_fingerprint: EFFECTIVE_FINGERPRINT })
      .eq('id', factRunId)
      .select('state,effective_facts_fingerprint')
      .single();
    expect(frozen.error ?? null, frozen.error?.message ?? '').toBeNull();
    expect(frozen.data.state).toBe('FROZEN');
    expect(frozen.data.effective_facts_fingerprint).toBe(EFFECTIVE_FINGERPRINT);

    // La identidad (audit, version, input fingerprint) es única en el servidor:
    // el segundo append debe chocar con ai_decision_snapshots_identity (23505).
    const decisionSnapshot = buildAiDecisionV1Snapshot({
      auditId: audit.id,
      factRunId,
      policyCode: POLICY_CODE,
      policyVersion: POLICY_VERSION,
      policySourceId: POLICY_SOURCE_ID,
      engineVersion: 'policy-engine-test-v1',
      promptVersion: 'policy-reasoner-v1',
      extractorVersion: EXTRACTOR_VERSION,
      provider: 'LOCAL',
      model: 'fixture',
      inputFingerprint: 'a'.repeat(64),
      decisionSnapshot: { suggestedOutcome: 'CANCELACION_VENTA' },
      ruleTraceSnapshot: { evaluatedRules: [] },
      evidenceSnapshot: { evidenceRefs: [] },
      createdAt: new Date().toISOString(),
    });
    const decisions = createPolicyFoundationRepository(database);
    const persisted = await decisions.appendAiDecisionV1(decisionSnapshot);
    expect(persisted.hash).toBe(decisionSnapshot.hash);
    await expect(decisions.appendAiDecisionV1(decisionSnapshot)).rejects.toThrow(AI_DECISION_V1_ALREADY_EXISTS);

    const decisionRuns = await database
      .from('audit_runs')
      .insert([{
        audit_id: audit.id,
        run_type: 'AI_DECISION_V1',
        status: 'COMPLETED',
        fact_run_id: factRunId,
        policy_code: POLICY_CODE,
        policy_version: POLICY_VERSION,
        input_fingerprint: 'a'.repeat(64),
        result: {},
        created_by: actorId,
        completed_at: new Date().toISOString(),
      }])
      .select('id')
      .single();
    expect(decisionRuns.error ?? null, decisionRuns.error?.message ?? '').toBeNull();
    const aiDecisionRunId = String(decisionRuns.data.id);

    // ---------------------------------------------------------------------
    // 4) Sonda transaccional con rollback explícito. Cada mutación va dentro de
    //    una subtransacción que Postgres revierte; "bloqueado" significa que la
    //    sentencia no movió ninguna fila, no sólo que no saltó una excepción.
    // ---------------------------------------------------------------------
    const probes = await rpc<ProbeRow>(database, 'policy_foundation_immutability_probe', {
      p_audit_id: audit.id,
      p_actor_id: actorId,
      p_fact_run_id: factRunId,
      p_fact_id: factId,
      p_ai_decision_id: aiDecisionRunId,
    });
    const byName = new Map(probes.map((probe) => [probe.out_probe_name, probe]));

    const expectedProbes = [
      'UPDATE_FROZEN_FACT',
      'DELETE_FROZEN_SNAPSHOT',
      'UPDATE_COMPLETED_AI_DECISION_V1',
      'INSERT_FACT_INTO_FROZEN_RUN',
      'DERIVED_CORRECTION_PRESERVES_PARENT_FINGERPRINT',
    ];
    expect([...byName.keys()].sort()).toEqual([...expectedProbes].sort());
    for (const name of expectedProbes) {
      const probe = byName.get(name)!;
      expect(probe.out_probe_blocked, `${name}: ${probe.out_probe_detail}`).toBe(true);
    }

    // La corrección derivada no movió el fingerprint del padre, y el run
    // derivado se revirtió (rollback explícito, 0 runs derivados nuevos).
    expect(byName.get('DERIVED_CORRECTION_PRESERVES_PARENT_FINGERPRINT')!.out_probe_detail).toMatch(/rollback=true/);

    // ---------------------------------------------------------------------
    // 5) Los tres RPC de escritura no confían en un audit_id declarado: sin
    //    sesión (`auth.uid()` nulo) se niegan aunque los ids sean válidos.
    // ---------------------------------------------------------------------
    const rpcCalls: Array<[string, Record<string, unknown>]> = [
      ['freeze_fact_run_v1', {
        p_fact_run_id: factRunId,
        p_facts: [],
        p_provenance: {},
        p_policy_source_id: POLICY_SOURCE_ID,
        p_canonical_facts_fingerprint: CANONICAL_FINGERPRINT,
        p_effective_facts_fingerprint: EFFECTIVE_FINGERPRINT,
      }],
      ['create_derived_fact_run_v1', {
        p_parent_fact_run_id: factRunId,
        p_derivation_reason: 'e2e sin sesion',
        p_facts: [],
        p_provenance: {},
        p_policy_source_id: POLICY_SOURCE_ID,
        p_extractor_version: `${EXTRACTOR_VERSION}+e2e`,
        p_canonical_facts_fingerprint: CANONICAL_FINGERPRINT,
        p_effective_facts_fingerprint: EFFECTIVE_FINGERPRINT,
      }],
      ['persist_policy_evaluation_v1', {
        p_audit_id: audit.id,
        p_fact_run_id: factRunId,
        p_policy_code: POLICY_CODE,
        p_policy_version: POLICY_VERSION,
        p_rules_fingerprint: 'r'.repeat(64),
        p_facts_fingerprint: 'f'.repeat(64),
        p_suggested_outcome: 'CANCELACION_VENTA',
        p_outcome_status: 'DETERMINED',
        p_evaluation: {},
        p_evaluated_rules: [],
        p_envelope: { schemaVersion: 'audit-evaluation-envelope-v1' },
        p_envelope_hash: 'b'.repeat(64),
      }],
    ];
    for (const [fn, args] of rpcCalls) {
      const { error } = await database.rpc!(fn, args);
      expect(String(error?.message ?? ''), `${fn} no debe aceptar una llamada sin sesión`).toMatch(/AUTH_REQUIRED/);
    }

    // ---------------------------------------------------------------------
    // 6) Higiene en DEV: se intenta el borrado en cascada y se EXIGE que las
    //    filas inmutables lo rechacen. Lo que quede se registra para que una
    //    persona lo purgue con DDL; no se maquilla un PASS.
    // ---------------------------------------------------------------------
    const purgeAttempts: Array<[string, string | null]> = [];
    const refusesDelete = async (table: string, column: string, value: string) => {
      const { error } = await database.from(table).delete().eq(column, value);
      purgeAttempts.push([table, error?.message ?? null]);
    };
    await refusesDelete('ai_decision_snapshots', 'audit_id', audit.id);
    await refusesDelete('fact_run_frozen_snapshots', 'audit_id', audit.id);
    await refusesDelete('facts', 'audit_id', audit.id);
    await refusesDelete('audit_runs', 'audit_id', audit.id);

    const refusals = Object.fromEntries(purgeAttempts);
    expect(String(refusals.ai_decision_snapshots ?? '')).toMatch(/APPEND_ONLY_TABLE/);
    expect(String(refusals.fact_run_frozen_snapshots ?? '')).toMatch(/APPEND_ONLY_TABLE/);
    expect(String(refusals.facts ?? '')).toMatch(/FACT_RUN_APPEND_ONLY/);
    expect(String(refusals.audit_runs ?? '')).toMatch(/AUDIT_RUN_APPEND_ONLY/);

    console.warn(
      `[policy-foundation-e2e] RESIDUO EN DEV POR DISEÑO (inmutabilidad). Auditoría ${audit.id}, fact run ${factRunId}. Purga manual con DDL requerida. Intentos: ${JSON.stringify(purgeAttempts)}`,
    );
  }, 120_000);
});
