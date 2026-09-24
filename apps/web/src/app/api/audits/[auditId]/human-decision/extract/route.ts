import { NextResponse, type NextRequest } from 'next/server';
import { authorizeAuditOperation } from '@/server/reporting/authz';
import { enqueueHumanDecisionExtraction } from '@/server/human-decision/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Encola el job HUMAN_DECISION_EXTRACTION. Rechazado hasta que exista baseline AI_BASELINE. */
export async function POST(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorizeAuditOperation(request, auditId);
  if (!auth.ok) return auth.response;

  let body: { evidenceId?: string; runId?: string } = {};
  try { body = await request.json(); } catch { body = {}; }

  try {
    const result = await enqueueHumanDecisionExtraction({
      auditId,
      actorId: auth.auth.user.id,
      database: auth.auth.client.database,
      evidenceId: body.evidenceId,
      runId: body.runId,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'HUMAN_DECISION_ENQUEUE_FAILED';
    const status = code === 'BASELINE_REQUIRED' ? 409 : 400;
    return NextResponse.json({ error: code, message: error instanceof Error ? error.message : 'No fue posible encolar la extracción.' }, { status });
  }
}