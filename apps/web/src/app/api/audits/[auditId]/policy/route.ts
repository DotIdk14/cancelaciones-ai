import { NextResponse, type NextRequest } from 'next/server';
import { createAuditRepository, createFactRepository } from '@cancelaciones/db';
import { evaluatePolicy } from '@cancelaciones/policy-engine';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';
import { mapStoredFactsToPolicyFacts, validateFrozenFactRun } from '@/server/policy/frozen-fact-run';

export const dynamic = 'force-dynamic';

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
  return NextResponse.json({ engineRun: result.data?.[0] ?? null });
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
  const facts = mapStoredFactsToPolicyFacts(storedFacts);
  if (facts.length === 0) return NextResponse.json({ error: 'FACT_RUN_EMPTY', message: 'El Fact Run congelado no contiene facts efectivos.' }, { status: 409 });
  let evaluation;
  try { evaluation = evaluatePolicy({ policyCode: body.policyCode, policyVersion: body.policyVersion, facts }); }
  catch (error) { return NextResponse.json({ error: 'UNSUPPORTED_POLICY', message: error instanceof Error ? error.message : 'Policy no soportada.' }, { status: 422 }); }
  const existing = await auth.client.database.from('engine_runs').select('*').eq('audit_id', auditId).eq('facts_fingerprint', evaluation.factsFingerprint).eq('policy_code', evaluation.policyCode).eq('policy_version', evaluation.policyVersion).eq('rules_fingerprint', evaluation.rulesFingerprint).limit(1);
  if (existing.error) return NextResponse.json({ error: 'DATABASE_ERROR', message: existing.error.message }, { status: 500 });
  if (existing.data?.[0]) return NextResponse.json({ engineRun: existing.data[0], evaluation, factsUsed: facts.length }, { status: 200 });
  const inserted = await auth.client.database.from('engine_runs').insert([{
    audit_id: auditId, fact_run_id: validation.run.id, policy_code: evaluation.policyCode, policy_version: evaluation.policyVersion,
    rules_fingerprint: evaluation.rulesFingerprint, facts_fingerprint: evaluation.factsFingerprint, status: 'COMPLETED',
    suggested_outcome: evaluation.suggestedOutcome, outcome_status: evaluation.outcomeStatus, evaluation,
  }]).select('*').single();
  if (inserted.error || !inserted.data) return NextResponse.json({ error: 'DATABASE_ERROR', message: inserted.error?.message ?? 'No fue posible persistir la corrida.' }, { status: 500 });
  const ruleRows = evaluation.evaluatedRules.map((rule) => ({ engine_run_id: inserted.data.id, rule_id: rule.ruleId, status: rule.status, result: rule }));
  const ruleInsert = await auth.client.database.from('engine_rule_results').insert(ruleRows);
  if (ruleInsert.error) return NextResponse.json({ error: 'DATABASE_ERROR', message: ruleInsert.error.message }, { status: 500 });
  return NextResponse.json({ engineRun: inserted.data, evaluation, factsUsed: facts.length }, { status: 201 });
}
