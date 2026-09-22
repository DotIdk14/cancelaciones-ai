import { NextResponse, type NextRequest } from 'next/server';
import { createAuditRepository, createFactRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';

async function authorized(auditId: string) {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 }) };
  const client = await createInsForgeServerClient();
  const audit = await createAuditRepository(client.database).findById(auditId);
  if (!audit) return { response: NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 }) };
  if (audit.createdBy !== user.id) return { response: NextResponse.json({ error: 'FORBIDDEN', message: 'No puede revisar esta auditoria.' }, { status: 403 }) };
  return { user, client };
}

export async function GET(_request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorized(auditId);
  if (auth.response) return auth.response;
  const result = await auth.client.database.from('fact_reviews').select('*').eq('audit_id', auditId).order('created_at', { ascending: false });
  if (result.error) return NextResponse.json({ error: 'DATABASE_ERROR', message: result.error.message }, { status: 500 });
  return NextResponse.json({ reviews: result.data ?? [] });
}

export async function POST(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorized(auditId);
  if (auth.response) return auth.response;
  let body: { factId?: string; decision?: 'VALID' | 'INVALID'; correctedValue?: unknown; note?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'INVALID_JSON', message: 'JSON invalido.' }, { status: 400 }); }
  if (!body.factId || !body.decision) return NextResponse.json({ error: 'INVALID_INPUT', message: 'factId y decision son obligatorios.' }, { status: 400 });
  const fact = await createFactRepository(auth.client.database).findFactById(body.factId);
  if (!fact || fact.auditId !== auditId) return NextResponse.json({ error: 'FACT_NOT_FOUND', message: 'Dato no encontrado.' }, { status: 404 });
  const inserted = await auth.client.database.from('fact_reviews').insert([{
    audit_id: auditId, fact_id: body.factId, decision: body.decision,
    status: body.decision === 'VALID' ? 'ACCEPTED' : 'REJECTED',
    corrected_value: body.correctedValue ?? null, note: body.note?.trim() || null,
    note_sanitized: body.note?.trim() || null, reviewed_by: auth.user.id,
  }]).select('*').single();
  if (inserted.error || !inserted.data) return NextResponse.json({ error: 'DATABASE_ERROR', message: inserted.error?.message ?? 'No fue posible guardar la revisión.' }, { status: 500 });
  return NextResponse.json({ review: inserted.data }, { status: 201 });
}
