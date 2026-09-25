import { createHash } from 'node:crypto';
import { createAuditRepository, createFactRepository, type DatabaseClient } from '@cancelaciones/db';
import { evaluatePolicy, type PolicyEvaluation } from '@cancelaciones/policy-engine';
import { recordBaselineRun } from '@/server/comparison/baseline';
import { getFrozenEffectiveFacts } from '@/server/facts/fact-run-snapshot';
import { validateFrozenFactRun } from './frozen-fact-run';
import { persistPolicyEvaluationAtomically } from './evaluation-persistence';

function fingerprintHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function policyCodeHash(value: string): string {
  return fingerprintHash(value);
}

/**
 * ============================================================================
 * ORQUESTACIÓN DE LA EVALUACIÓN NORMATIVA
 * ============================================================================
 *
 * Este archivo hace TRES cosas y ninguna más:
 *   1. Valida que el Fact Run esté FROZEN y pertenezca a esta auditoría y a esta
 *      versión de política.
 *   2. Pide los HECHOS EFECTIVOS y se los entrega a `evaluatePolicy`.
 *   3. Pide la persistencia atómica y registra la corrida AI_BASELINE.
 *
 * ============================================================================
 * POR QUÉ LOS OUTCOMES NO CAMBIAN (Step 6 con la puerta de R-8)
 * ============================================================================
 * `evaluatePolicy` es la única fuente de outcomes y no se toca. Lo único que
 * puede mover un outcome es el array `facts` que recibe, porque
 * `evaluation.factsFingerprint = stableFingerprint(facts)`. Así que la garantía
 * se apoya en una sola pregunta: ¿el array es el mismo que antes?
 *
 *   - El array lo produce `getFrozenEffectiveFacts`. Sin snapshot, su rama
 *     legacy ejecuta LITERALMENTE la operación anterior: `mapStoredFactsToPolicyFacts`
 *     sobre `listFactsByRun`, filtro de la review más reciente con decisión
 *     `INVALID`, y sustitución de `value` por `corrected_value`. Mismo orden,
 *     misma consulta, mismo filtro.
 *   - Con snapshot, el array es el que se selló. Y como la migración aún no
 *     está aplicada, esa rama es inalcanzable hoy: no hay ningún entorno donde
 *     pueda cambiar un outcome.
 *
 * La aplicación retrospectiva de reviews NO se elimina a secas (eso sí cambiaría
 * outcomes): se elimina SÓLO en la rama del snapshot, que es exactamente lo que
 * R-8 manda.
 *
 * ============================================================================
 * C2: la escritura pasa por `persistPolicyEvaluationAtomically`
 * ============================================================================
 * La migración revoca `INSERT` sobre `engine_runs` y `engine_rule_results`: el
 * módulo de persistencia usa `persist_policy_evaluation_v1` cuando existe y cae
 * a los dos INSERT de hoy cuando no. Aquí ya no hay ni una escritura de motor.
 */
export async function runPolicyEngineForAudit(input: {
  database: DatabaseClient;
  auditId: string;
  actorId: string;
  policyCode: string;
  policyVersion: string;
  factRunId: string;
}): Promise<{ engineRun: Record<string, unknown>; evaluation: PolicyEvaluation; factsUsed: number; created: boolean }> {
  const audit = await createAuditRepository(input.database).findById(input.auditId);
  if (!audit) throw new Error('AUDIT_NOT_FOUND');

  const factsRepo = createFactRepository(input.database);
  const run = await factsRepo.findRunById(input.factRunId);
  const validation = validateFrozenFactRun({ auditId: input.auditId, policyCode: input.policyCode, policyVersion: input.policyVersion, run });
  if (!validation.ok) throw new Error(validation.code);

  const effective = await getFrozenEffectiveFacts({
    database: input.database,
    auditId: input.auditId,
    factRunId: validation.run.id,
    run: validation.run,
  });
  const facts = effective.facts;
  if (facts.length === 0) throw new Error('FACT_RUN_EMPTY');

  const evaluation = evaluatePolicy({ policyCode: input.policyCode, policyVersion: input.policyVersion, facts });
  const factsFingerprint = fingerprintHash(evaluation.factsFingerprint);
  const rulesFingerprint = fingerprintHash(evaluation.rulesFingerprint);
  const policyHash = policyCodeHash(evaluation.policyCode);

  const persisted = await persistPolicyEvaluationAtomically({
    database: input.database,
    auditId: input.auditId,
    factRunId: validation.run.id,
    actorId: input.actorId,
    evaluation,
    factsFingerprint,
    rulesFingerprint,
    policyCodeHash: policyHash,
  });

  await recordBaselineRun({
    database: input.database,
    auditId: input.auditId,
    engineRunId: String(persisted.engineRun.id),
    factRunId: validation.run.id,
    policyCode: evaluation.policyCode,
    policyVersion: evaluation.policyVersion,
    evaluation,
    actorId: input.actorId,
  });

  return { engineRun: persisted.engineRun, evaluation, factsUsed: facts.length, created: persisted.created };
}
