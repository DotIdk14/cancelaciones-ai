import { NextResponse, type NextRequest } from 'next/server';
import { createAuditLogRepository } from '@cancelaciones/db';
import { authorizeAuditOperation } from '@/server/reporting/authz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Timeline de eventos del audit_log (append-only) para el panel de trazabilidad. */
export async function GET(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorizeAuditOperation(request, auditId);
  if (!auth.ok) return auth.response;
  const events = await createAuditLogRepository(auth.auth.client.database).listByAudit(auditId);
  return NextResponse.json({ events });
}