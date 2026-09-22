import { NextResponse, type NextRequest } from 'next/server';
import { createAuditRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ auditId: string; engineRunId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });
  const { auditId, engineRunId } = await context.params;
  const client = await createInsForgeServerClient();
  const audit = await createAuditRepository(client.database).findById(auditId);
  if (!audit) return NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 });
  if (audit.createdBy !== user.id) return NextResponse.json({ error: 'FORBIDDEN', message: 'Acceso denegado.' }, { status: 403 });
  const result = await client.database.from('engine_runs').select('*').eq('id', engineRunId).eq('audit_id', auditId).limit(1);
  if (result.error) return NextResponse.json({ error: 'DATABASE_ERROR', message: result.error.message }, { status: 500 });
  if (!result.data?.[0]) return NextResponse.json({ error: 'NOT_FOUND', message: 'Corrida no encontrada.' }, { status: 404 });
  return NextResponse.json({ engineRun: result.data[0] });
}
