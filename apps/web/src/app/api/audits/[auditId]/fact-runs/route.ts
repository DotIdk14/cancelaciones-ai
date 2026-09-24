import { NextResponse, type NextRequest } from 'next/server';
import { createAuditRepository, createFactRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

async function authorized(auditId: string) {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 }) };
  const client = await createInsForgeServerClient();
  const audit = await createAuditRepository(client.database).findById(auditId);
  if (!audit) return { response: NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 }) };
  if (audit.createdBy !== user.id) return { response: NextResponse.json({ error: 'FORBIDDEN', message: 'No puede operar esta auditoria.' }, { status: 403 }) };
  return { user, client, audit };
}

export async function GET(_request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorized(auditId);
  if (auth.response) return auth.response;
  const repo = createFactRepository(auth.client.database);
  const runs = await repo.listRunsByAudit(auditId);
  const selectedRun = runs.find((run) => run.state === 'FROZEN') ?? runs[0] ?? null;
  const facts = selectedRun ? await repo.listFactsByRun(selectedRun.id) : [];
  return NextResponse.json({ factRuns: runs, selectedRun, facts });
}

export async function POST(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorized(auditId);
  if (auth.response) return auth.response;
  const form = await request.formData().catch(() => null);
  const action = String(form?.get('action') ?? 'FREEZE');
  const factRunId = String(form?.get('factRunId') ?? '');
  if (action !== 'FREEZE' || !factRunId) return NextResponse.json({ error: 'INVALID_INPUT', message: 'action=FREEZE y factRunId son obligatorios.' }, { status: 400 });
  const repo = createFactRepository(auth.client.database);
  const run = await repo.findRunById(factRunId);
  if (!run || run.auditId !== auditId) return NextResponse.json({ error: 'FACT_RUN_NOT_FOUND', message: 'Fact Run no encontrado para esta auditoria.' }, { status: 404 });
  if (run.state === 'FROZEN') return NextResponse.json({ factRun: run, reused: true }, { status: 200 });
  const facts = await repo.listFactsByRun(run.id);
  if (facts.length === 0) return NextResponse.json({ error: 'FACT_RUN_EMPTY', message: 'No se puede congelar un Fact Run sin facts.' }, { status: 409 });
  await repo.freezeRun(run.id);
  return NextResponse.redirect(new URL(`/auditorias/${auditId}`, request.url));
}
