import { NextResponse, type NextRequest } from 'next/server';
import { createAuditRepository, createEvidenceRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';
import { uploadEvidenceFilesForAudit } from '@/server/evidence/upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });

  const { auditId } = await context.params;
  const client = await createInsForgeServerClient();
  const audits = createAuditRepository(client.database);
  const audit = await audits.findById(auditId);
  if (!audit) return NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 });

  const evidences = createEvidenceRepository(client.database);
  return NextResponse.json({ evidences: await evidences.listByAudit(auditId) });
}

export async function POST(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });

  const { auditId } = await context.params;
  const client = await createInsForgeServerClient();
  const audits = createAuditRepository(client.database);
  const audit = await audits.findById(auditId);
  if (!audit) return NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 });

  const formData = await request.formData();
  const files = formData.getAll('files').filter((value): value is File => value instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: 'BAD_REQUEST', message: 'No se recibieron archivos.' }, { status: 400 });
  }

  const results = await uploadEvidenceFilesForAudit({ auditId, actorId: user.id, files, database: client.database, storage: client.storage });

  const ok = results.some((result) => result.status === 'STORED');
  return NextResponse.json({ results }, { status: ok ? 207 : 400 });
}
