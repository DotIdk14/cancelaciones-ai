import { NextResponse, type NextRequest } from 'next/server';
import { createAuditLogRepository, createAuditRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Timeline de eventos del audit_log (append-only) para el panel de trazabilidad. */
export async function GET(_request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });
  const { auditId } = await context.params;
  const client = await createInsForgeServerClient();
  const audit = await createAuditRepository(client.database).findById(auditId);
  if (!audit) return NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 });
  const events = await createAuditLogRepository(client.database).listByAudit(auditId);
  return NextResponse.json({ events });
}
