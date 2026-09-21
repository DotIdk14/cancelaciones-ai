import { NextResponse, type NextRequest } from 'next/server';
import { createAuditRepository, createJobRepository } from '@cancelaciones/db';
import { stableFingerprint } from '@cancelaciones/domain';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });
  const { auditId } = await context.params;
  const client = await createInsForgeServerClient();
  const audit = await createAuditRepository(client.database).findById(auditId);
  if (!audit) return NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 });
  return NextResponse.json({ jobs: await createJobRepository(client.database).listByAudit(auditId) });
}

export async function POST(_request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });
  const { auditId } = await context.params;
  const client = await createInsForgeServerClient();
  const audit = await createAuditRepository(client.database).findById(auditId);
  if (!audit) return NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 });

  const payload = { auditId, version: 'metadata-probe-v1' };
  const job = await createJobRepository(client.database).enqueue({
    auditId,
    jobType: 'METADATA_PROBE',
    operationScope: `audit:${auditId}:metadata-probe`,
    idempotencyKey: `metadata-probe:${auditId}:v1`,
    inputFingerprint: stableFingerprint(payload),
    payload,
    actorId: user.id,
  });

  return NextResponse.json({ job }, { status: 202 });
}
