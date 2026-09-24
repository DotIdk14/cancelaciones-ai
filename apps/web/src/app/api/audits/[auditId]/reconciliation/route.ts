import { NextResponse, type NextRequest } from 'next/server';
import { createAuditRunRepository } from '@cancelaciones/db';
import { authorizeAuditOperation } from '@/server/reporting/authz';
import { runReconciliation, ReconciliationServiceError } from '@/server/reconciliation/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorizeAuditOperation(request, auditId);
  if (!auth.ok) return auth.response;
  const run = await createAuditRunRepository(auth.auth.client.database).findLatestByType(auditId, 'AI_RECONCILIATION');
  return NextResponse.json({ run });
}

export async function POST(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorizeAuditOperation(request, auditId);
  if (!auth.ok) return auth.response;

  try {
    const result = await runReconciliation({ database: auth.auth.client.database, auditId, actorId: auth.auth.user.id });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    if (error instanceof ReconciliationServiceError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: 'RECONCILIATION_FAILED', message: error instanceof Error ? error.message : 'No fue posible reconciliar.' }, { status: 500 });
  }
}