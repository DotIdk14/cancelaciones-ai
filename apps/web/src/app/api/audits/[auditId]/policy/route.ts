import { NextResponse, type NextRequest } from 'next/server';
import { createAuditRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';
import { recordBaselineRun } from '@/server/comparison/baseline';
import { runPolicyEngineForAudit } from '@/server/policy/evaluation';

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
  try {
    const result = await runPolicyEngineForAudit({ database: auth.client.database, auditId, actorId: auth.user.id, policyCode: body.policyCode, policyVersion: body.policyVersion, factRunId: body.factRunId });
    return NextResponse.json({ engineRun: result.engineRun, evaluation: result.evaluation, factsUsed: result.factsUsed }, { status: result.created ? 201 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No fue posible ejecutar el motor.';
    const status = message === 'FACT_RUN_EMPTY' || message === 'FACT_RUN_NOT_FROZEN' ? 409 : message === 'FACT_RUN_NOT_FOUND' ? 404 : message === 'UNSUPPORTED_POLICY' ? 422 : 500;
    return NextResponse.json({ error: status === 500 ? 'DATABASE_ERROR' : message, message }, { status });
  }
}
