import { NextResponse, type NextRequest } from 'next/server';
import { createAuditRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';
import { buildDecisionTrace } from '@/server/policy/decision-trace';
import { logPolicyEvent, startTimer } from '@/server/policy/operational-log';

export const dynamic = 'force-dynamic';

/**
 * GET /api/audits/[auditId]/decision-trace
 *
 * Read-only. NO evalúa, NO recalcula, NO escribe. Devuelve la proyección de lo
 * que ya está persistido.
 *
 * Autorización: idéntica a `policy/route.ts` y `policy/[engineRunId]/route.ts`.
 * `audit.createdBy !== user.id` -> 403. No hay excepción para "es debug": si se
 * abría una, el trace dejaría de ser un registro de auditoría y pasa a ser un
 * oráculo de datos de cualquier auditoría del sistema.
 *
 * Multiple corridas: `?engineRunId=` selecciona una. Sin el parámetro devuelve
 * la más reciente PERO declara en `availableRuns` cuántas hay y cuál se chose,
 * para que una ejecución anterior nunca quede oculta.
 *
 * Descarga: `?download=1` devuelve el MISMO contrato como
 * `decision-trace.json`. No existe un segundo formato.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const elapsed = startTimer();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });

  const { auditId } = await context.params;
  const client = await createInsForgeServerClient();
  const audit = await createAuditRepository(client.database).findById(auditId);
  if (!audit) return NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 });
  if (audit.createdBy !== user.id) return NextResponse.json({ error: 'FORBIDDEN', message: 'Acceso denegado.' }, { status: 403 });

  const engineRunId = request.nextUrl.searchParams.get('engineRunId');
  const download = request.nextUrl.searchParams.get('download') === '1';

  try {
    const trace = await buildDecisionTrace({ database: client.database, auditId, engineRunId });
    if (!trace) {
      return NextResponse.json(
        { error: 'NO_TRACE_AVAILABLE', message: 'Esta auditoria todavia no tiene una evaluacion del motor normativo registrada.' },
        { status: 404 },
      );
    }
    logPolicyEvent('DECISION_TRACE_BUILT', {
      auditId,
      engineRunId: trace.execution.engineRunId,
      factRunId: trace.execution.factRunId ?? undefined,
      policyVersion: trace.execution.policyVersion,
      decisionStatus: trace.aggregation.decisionStatus,
      outcomeStatus: trace.aggregation.outcomeStatus,
      factsFingerprint: trace.execution.factsFingerprint,
      rulesFingerprint: trace.execution.rulesFingerprint,
      factCount: trace.facts.length,
      durationMs: elapsed(),
    });
    if (download) {
      return new NextResponse(JSON.stringify(trace, null, 2), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="decision-trace.json"`,
          'cache-control': 'no-store',
        },
      });
    }
    return NextResponse.json(trace, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message.split(':')[0] : 'DECISION_TRACE_UNKNOWN';
    // Deliberadamente NO se registra el mensaje crudo: puede contener un id o un
    // fragmento de payload de la base. Se registra el código estable.
    logPolicyEvent('DECISION_TRACE_READ_FAILED', { auditId, code, stage: 'build', durationMs: elapsed() });
    return NextResponse.json({ error: 'TRACE_READ_FAILED', message: 'No fue posible construir el trace de esta auditoria.' }, { status: 500 });
  }
}
