import { NextResponse, type NextRequest } from 'next/server';
import { createReportSnapshotRepository } from '@cancelaciones/db';
import { authorizeAuditOperation } from '@/server/reporting/authz';
import { buildSnapshot, isCode } from '@/server/dictamen/service';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const authz = await authorizeAuditOperation(_request, auditId);
  if (!authz.ok) return authz.response;
  const snapshot = await createReportSnapshotRepository(authz.auth.client.database).findLatestByAudit(auditId);
  return NextResponse.json({ snapshot });
}

export async function POST(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const authz = await authorizeAuditOperation(request, auditId);
  if (!authz.ok) return authz.response;

  try {
    const { snapshot, created } = await buildSnapshot(authz.auth);
    return NextResponse.json({ snapshot, created }, { status: created ? 201 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No fue posible crear el snapshot.';
    const status = isCode(error, 'ENGINE_RUN_NOT_FOUND') ? 409 : 400;
    return NextResponse.json({ error: (error as Error & { code?: string }).code ?? 'SNAPSHOT_FAILED', message }, { status });
  }
}