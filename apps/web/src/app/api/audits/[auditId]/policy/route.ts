import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createAuditRepository, createFactRepository } from '@cancelaciones/db';
import { evaluatePolicy } from '@cancelaciones/policy-engine';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';
import { mapStoredFactsToPolicyFacts, validateFrozenFactRun } from '@/server/policy/frozen-fact-run';
import { recordBaselineRun } from '@/server/comparison/baseline';

export const dynamic = 'force-dynamic';

function fingerprintHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function policyCodeHash(value: string): string {
  return fingerprintHash(value);
}

async function authorizedAudit(auditId: string) {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 }) };
  const client = await createInsForgeServerClient();
  const audit = await createAuditRepository(client.database).findById(auditId);
  if (!audit) return { response: NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 }) };
  if (audit.createdBy !== user.id) return { response: NextResponse.json({ error: 'FORBIDDEN', message: 'No puede evaluar esta auditoria.' }, { status: 403 }) };
  return { user, client, audit };
}

export async function GET(_request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorizedAudit(auditId);
  if (auth.response) return auth.response;
  const result = await auth.client.database.from('engine_runs').select('*').eq('audit_id', auditId).order('created_at', { ascending: false }).limit(1);
  if (result.error) return NextResponse.json({ error: 'DATABASE_ERROR', message: result.error.message }, { status: 500 });
  const engineRun = result.data?.[0] ?? null;
  // Backfill idempotente: si existe un engine_run pero aún no hay AI_BASELINE, se registra.
  if (engineRun && engineRun.evaluation) {
    await recordBaselineRun({
      database: auth.client.database,
      auditId,
      engineRunId: engineRun.id,
      factRunId: engineRun.fact_run_id ?? null,
      policyCode: engineRun.policy_code,
      policyVersion: engineRun.policy_version,
      evaluation: engineRun.evaluation,
      actorId: auth.user.id,
    });
  }
  return NextResponse.json({ engineRun });
}

export async function POST(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorizedAudit(auditId);
  if (auth.response) return auth.response;
  let body: { policyCode?: string; policyVersion?: string; factRunId?: string; humanOutcome?: string; humanPolicyVersion?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'INVALID_JSON', message: 'JSON invalido.' }, { status: 400 }); }
  if (!body.policyCode || !body.policyVersion || !body.factRunId) return NextResponse.json({ error: 'INVALID_INPUT', message: 'policyCode, policyVersion y factRunId son obligatorios.' }, { status: 400 });
  const factsRepo = createFactRepository(auth.client.database);
  const run = await factsRepo.findRunById(body.factRunId);
  const validation = validateFrozenFactRun({ auditId, policyCode: body.policyCode, policyVersion: body.policyVersion, run });
  if (!validation.ok) return NextResponse.json({ error: validation.code, message: validation.message }, { status: validation.status });
  const storedFacts = await factsRepo.listFactsByRun(validation.run.id);
  const reviewResult = await auth.client.database.from('fact_reviews').select('fact_id,decision,corrected_value,created_at').eq('audit_id', auditId).order('created_at', { ascending: false });
  if (reviewResult.error) return NextResponse.json({ error: 'DATABASE_ERROR', message: reviewResult.error.message }, { status: 500 });
  const latestReviews = new Map<string, { decision: string; corrected_value: unknown }>();
  for (const review of reviewResult.data ?? []) if (!latestReviews.has(review.fact_id)) latestReviews.set(review.fact_id, review);
  const facts = mapStoredFactsToPolicyFacts(storedFacts)
    .filter((fact) => latestReviews.get(fact.id)?.decision !== 'INVALID')
    .map((fact) => {
      const review = latestReviews.get(fact.id);
      if (!review || review.corrected_value === null || review.corrected_value === undefined) return fact;
      return { ...fact, value: review.corrected_value };
    });
  if (facts.length === 0) return NextResponse.json({ error: 'FACT_RUN_EMPTY', message: 'El Fact Run congelado no contiene facts efectivos.' }, { status: 409 });
  let evaluation;
  try { evaluation = evaluatePolicy({ policyCode: body.policyCode, policyVersion: body.policyVersion, facts }); }
  catch (error) { return NextResponse.json({ error: 'UNSUPPORTED_POLICY', message: error instanceof Error ? error.message : 'Policy no soportada.' }, { status: 422 }); }
  const factsFingerprint = fingerprintHash(evaluation.factsFingerprint);
  const rulesFingerprint = fingerprintHash(evaluation.rulesFingerprint);
  const policyHash = policyCodeHash(evaluation.policyCode);
  const existing = await auth.client.database.from('engine_runs').select('*').eq('audit_id', auditId).eq('policy_code_hash', policyHash).eq('policy_version', evaluation.policyVersion).order('created_at', { ascending: false }).limit(20);
  if (existing.error) return NextResponse.json({ error: 'DATABASE_ERROR', message: existing.error.message }, { status: 500 });
  const matchingRun = existing.data?.find((run: { facts_fingerprint?: string; rules_fingerprint?: string }) => run.facts_fingerprint === factsFingerprint && run.rules_fingerprint === rulesFingerprint);
  if (matchingRun) {
    // Registro de línea base idempotente: si aún no existe una AI_BASELINE para este engine_run, se crea.
    await recordBaselineRun({
      database: auth.client.database,
      auditId,
      engineRunId: matchingRun.id,
      factRunId: validation.run.id,
      policyCode: evaluation.policyCode,
      policyVersion: evaluation.policyVersion,
      evaluation,
      actorId: auth.user.id,
    });
    return NextResponse.json({ engineRun: matchingRun, evaluation, factsUsed: facts.length }, { status: 200 });
  }
  const inserted = await auth.client.database.from('engine_runs').insert([{
    audit_id: auditId, fact_run_id: validation.run.id, policy_code: evaluation.policyCode, policy_code_hash: policyCodeHash(evaluation.policyCode), policy_version: evaluation.policyVersion,
    rules_fingerprint: rulesFingerprint, facts_fingerprint: factsFingerprint, status: 'COMPLETED',
    suggested_outcome: evaluation.suggestedOutcome, outcome_status: evaluation.outcomeStatus, evaluation,
  }]).select('*').single();
  if (inserted.error || !inserted.data) return NextResponse.json({ error: 'DATABASE_ERROR', message: inserted.error?.message ?? 'No fue posible persistir la corrida.' }, { status: 500 });
  const ruleRows = evaluation.evaluatedRules.map((rule) => ({ engine_run_id: inserted.data.id, rule_id: rule.ruleId, status: rule.status, result: rule }));
  const ruleInsert = await auth.client.database.from('engine_rule_results').insert(ruleRows);
  if (ruleInsert.error) return NextResponse.json({ error: 'DATABASE_ERROR', message: ruleInsert.error.message }, { status: 500 });
  // Registro de línea base AI_BASELINE (audit_run) referenciando el engine_run nuevo.
  await recordBaselineRun({
    database: auth.client.database,
    auditId,
    engineRunId: inserted.data.id,
    factRunId: validation.run.id,
    policyCode: evaluation.policyCode,
    policyVersion: evaluation.policyVersion,
    evaluation,
    actorId: auth.user.id,
  });
  return NextResponse.json({ engineRun: inserted.data, evaluation, factsUsed: facts.length }, { status: 201 });
}
