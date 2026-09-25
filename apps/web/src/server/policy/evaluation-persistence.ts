import { createHash } from 'node:crypto';
import type { DatabaseClient } from '@cancelaciones/db';
import { toAuditEvaluationEnvelopeV1, type PolicyEvaluation } from '@cancelaciones/policy-engine';
import { DEGRADATION_PERSIST_RPC_ABSENT, PERSIST_POLICY_EVALUATION_RPC } from '@/server/facts/fact-run-snapshot';
import { isFoundationObjectMissing, warnFoundationDegradation } from '@/server/facts/foundation-objects';

/**
 * ============================================================================
 * PERSISTENCIA ATÓMICA DE UNA EVALUACIÓN (Task 10, Steps 5 y 6 / C2)
 * ============================================================================
 *
 * EL PROBLEMA QUE RESUELVE (C2)
 * La migración revoca `INSERT` sobre `engine_runs` y `engine_rule_results` para
 * el rol de cliente: la única vía de escritura pasa a ser
 * `persist_policy_evaluation_v1`, que inserta engine_run + rule_results +
 * envelope + baseline AI_BASELINE en UNA transacción y con idempotencia en los
 * cuatro puntos. `evaluation.ts` insertaba directo en dos sentencias, así que
 * sin este módulo la migración rompería el registro de corridas del motor.
 *
 * DÓNDE VIVE Y POR QUÉ (el plan deja decidir: "persistPolicyEvaluationAtomically
 * wherever it belongs architecturally")
 * Vive en su propio módulo y no dentro de `evaluation.ts` por tres razones:
 *   1. UNA SOLA IMPLEMENTACIÓN POR CAPACIDAD (DO_NOT_DUPLICATE_IMPLEMENTATIONS):
 *      es una capacidad de escritura, no de orquestación. `evaluation.ts` la
 *      llama; si mañana otro camino del motor necesita persistir, la usa sin
 *      reimplementar la detección de disponibilidad.
 *   2. La superficie de degradación (qué es ausencia y qué es error de negocio)
 *      queda AISLADA y testeable sin levantar el motor normativo entero.
 *   3. `evaluation.ts` queda como lo que es: leer hechos sellados, evaluar con
 *      `evaluatePolicy` y pedir la persistencia. Sin know-how de RPC ni de
 *      PostgREST.
 *
 * DEGRADACIÓN (R-3)
 * Sin el RPC se conservan LITERALMENTE los dos INSERT de hoy, con la misma
 * consulta de idempotencia previa. Un error de negocio del RPC se propaga.
 */

export interface PersistPolicyEvaluationInput {
  database: DatabaseClient;
  auditId: string;
  factRunId: string;
  actorId: string;
  evaluation: PolicyEvaluation;
  /** `sha256(evaluation.factsFingerprint)`: la forma que va a `engine_runs`. */
  factsFingerprint: string;
  /** `sha256(evaluation.rulesFingerprint)`. */
  rulesFingerprint: string;
  policyCodeHash: string;
  ownerPrecedenceVersion?: string | null;
}

export interface PersistPolicyEvaluationResult {
  engineRun: Record<string, unknown>;
  created: boolean;
  envelopeId: string | null;
  baselineRunId: string | null;
  transport: 'RPC' | 'LEGACY_DIRECT_INSERT' | 'IDEMPOTENT_REUSE';
  degradation: string | null;
}

interface PersistRpcRow {
  out_engine_run_id?: unknown;
  out_created?: unknown;
  out_envelope_id?: unknown;
  out_baseline_run_id?: unknown;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * `envelope_hash` es SHA-256 del envelope serializado. El servidor exige
 * 64 hex minúsculas y valida que el `schemaVersion` sea
 * `audit-evaluation-envelope-v1` (migración §13), así que el hash se calcula
 * sobre el MISMO envelope que se envía, no sobre otra proyección.
 */
export function buildAuditEvaluationEnvelope(input: { evaluation: PolicyEvaluation }): { envelope: Record<string, unknown>; hash: string } {
  const envelope = toAuditEvaluationEnvelopeV1(input.evaluation) as unknown as Record<string, unknown>;
  return { envelope, hash: sha256(JSON.stringify(envelope)) };
}

/**
 * Reutilización del engine run ya registrado para la MISMA evaluación. Es la
 * consulta de `evaluation.ts` movida TAL CUAL (mismas columnas, mismo orden, mismo
 * límite 20, misma comparación de las dos huellas) para que la identidad del
 * engine run no dependa del transporte: el RPC tiene su propia idempotencia por
 * `unique_violation`, pero el camino legacy depende de esta, y ambos caminos
 * deben reutilizar la misma fila.
 */
async function findRegisteredEngineRun(input: PersistPolicyEvaluationInput): Promise<Record<string, unknown> | null> {
  const existing = await input.database.from('engine_runs').select('*')
    .eq('audit_id', input.auditId)
    .eq('policy_code_hash', input.policyCodeHash)
    .eq('policy_version', input.evaluation.policyVersion)
    .order('created_at', { ascending: false })
    .limit(20);
  if (existing.error) throw new Error(existing.error.message ?? 'ENGINE_RUN_READ_FAILED');
  const matching = (existing.data ?? []).find((row: { facts_fingerprint?: string; rules_fingerprint?: string }) => (
    row.facts_fingerprint === input.factsFingerprint && row.rules_fingerprint === input.rulesFingerprint
  ));
  return matching ? (matching as Record<string, unknown>) : null;
}

export async function persistPolicyEvaluationAtomically(input: PersistPolicyEvaluationInput): Promise<PersistPolicyEvaluationResult> {
  const { evaluation } = input;

  const registered = await findRegisteredEngineRun(input);
  if (registered) {
    return { engineRun: registered, created: false, envelopeId: null, baselineRunId: null, transport: 'IDEMPOTENT_REUSE', degradation: null };
  }

  if (typeof input.database.rpc === 'function') {
    const { envelope, hash } = buildAuditEvaluationEnvelope({ evaluation });
    const result = await input.database.rpc(PERSIST_POLICY_EVALUATION_RPC, {
      p_audit_id: input.auditId,
      p_fact_run_id: input.factRunId,
      p_policy_code: evaluation.policyCode,
      p_policy_version: evaluation.policyVersion,
      p_rules_fingerprint: input.rulesFingerprint,
      p_facts_fingerprint: input.factsFingerprint,
      p_suggested_outcome: evaluation.suggestedOutcome,
      p_outcome_status: evaluation.outcomeStatus,
      p_evaluation: evaluation,
      p_evaluated_rules: evaluation.evaluatedRules.map((rule) => ({ rule_id: rule.ruleId, status: rule.status, result: rule })),
      p_envelope: envelope,
      p_envelope_hash: hash,
      p_owner_precedence_version: input.ownerPrecedenceVersion ?? null,
      p_created_by: input.actorId,
    });
    if (result?.error) {
      if (!isFoundationObjectMissing(PERSIST_POLICY_EVALUATION_RPC, result.error)) {
        throw new Error(result.error.message ?? 'ENGINE_RUN_INSERT_FAILED');
      }
    } else {
      const row = ((result?.data ?? []) as PersistRpcRow[])[0];
      if (row?.out_engine_run_id) {
        const engineRunId = String(row.out_engine_run_id);
        const stored = await input.database.from('engine_runs').select('*').eq('id', engineRunId).limit(1);
        if (stored.error) throw new Error(stored.error.message ?? 'ENGINE_RUN_READ_FAILED');
        const engineRun = (stored.data ?? [])[0];
        if (!engineRun) throw new Error('ENGINE_RUN_NOT_FOUND');
        return {
          engineRun: engineRun as Record<string, unknown>,
          created: row.out_created === true,
          envelopeId: row.out_envelope_id ? String(row.out_envelope_id) : null,
          baselineRunId: row.out_baseline_run_id ? String(row.out_baseline_run_id) : null,
          transport: 'RPC',
          degradation: null,
        };
      }
    }
    warnFoundationDegradation(
      DEGRADATION_PERSIST_RPC_ABSENT,
      `${PERSIST_POLICY_EVALUATION_RPC} no está disponible: auditoría ${input.auditId}, Fact Run ${input.factRunId}. La evaluación se registra con INSERT directo en engine_runs/engine_rule_results, SIN envelope. Aplique la migración 20260925120000_policy-foundation-immutability.sql.`,
    );
  } else {
    warnFoundationDegradation(
      DEGRADATION_PERSIST_RPC_ABSENT,
      `${PERSIST_POLICY_EVALUATION_RPC} no está disponible (el cliente no expone rpc): auditoría ${input.auditId}, Fact Run ${input.factRunId}. La evaluación se registra con INSERT directo, SIN envelope.`,
    );
  }

  // ---- Degradación: exactamente los dos INSERT de evaluation.ts ----
  const inserted = await input.database.from('engine_runs').insert([{
    audit_id: input.auditId,
    fact_run_id: input.factRunId,
    policy_code: evaluation.policyCode,
    policy_code_hash: input.policyCodeHash,
    policy_version: evaluation.policyVersion,
    rules_fingerprint: input.rulesFingerprint,
    facts_fingerprint: input.factsFingerprint,
    status: 'COMPLETED',
    suggested_outcome: evaluation.suggestedOutcome,
    outcome_status: evaluation.outcomeStatus,
    evaluation,
  }]).select('*').single();
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message ?? 'ENGINE_RUN_INSERT_FAILED');

  const engineRunId = String(inserted.data.id);
  const ruleRows = evaluation.evaluatedRules.map((rule) => ({ engine_run_id: engineRunId, rule_id: rule.ruleId, status: rule.status, result: rule }));
  const ruleInsert = await input.database.from('engine_rule_results').insert(ruleRows);
  if (ruleInsert.error) throw new Error(ruleInsert.error.message ?? 'ENGINE_RULE_RESULTS_INSERT_FAILED');

  return { engineRun: inserted.data as Record<string, unknown>, created: true, envelopeId: null, baselineRunId: null, transport: 'LEGACY_DIRECT_INSERT', degradation: DEGRADATION_PERSIST_RPC_ABSENT };
}
