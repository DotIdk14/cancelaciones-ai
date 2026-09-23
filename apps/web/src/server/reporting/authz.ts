// Authz compartida para rutas de Phase 7 (server-only).
// Misma regla que las rutas previas: solo el creador de la auditoria puede operarla.
import { NextResponse, type NextRequest } from 'next/server';
import { createAuditRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';

export type AuthorizedContext = {
  user: { id: string };
  client: Awaited<ReturnType<typeof createInsForgeServerClient>>;
  auditId: string;
};

export type AuthorizedResult = { ok: true; auth: AuthorizedContext } | { ok: false; response: NextResponse };

export async function authorizeAuditOperation(_request: NextRequest, auditId: string): Promise<AuthorizedResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 }) };
  }
  const client = await createInsForgeServerClient();
  const audit = await createAuditRepository(client.database).findById(auditId);
  if (!audit) {
    return { ok: false, response: NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 }) };
  }
  if (audit.createdBy !== user.id) {
    return { ok: false, response: NextResponse.json({ error: 'FORBIDDEN', message: 'No puede operar esta auditoria.' }, { status: 403 }) };
  }
  return { ok: true, auth: { user, client, auditId } };
}