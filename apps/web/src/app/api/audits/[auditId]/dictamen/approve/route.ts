import { NextResponse, type NextRequest } from 'next/server';
import { authorizeAuditOperation } from '@/server/reporting/authz';
import { approveSnapshot, isCode } from '@/server/dictamen/service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const authz = await authorizeAuditOperation(request, auditId);
  if (!authz.ok) return authz.response;

  try {
    const snapshot = await approveSnapshot(authz.auth);
    return NextResponse.json({ snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No fue posible aprobar el snapshot.';
    const status = isCode(error, 'SNAPSHOT_NOT_FOUND') || isCode(error, 'HUMAN_REVIEW_REQUIRED') ? 409 : 400;
    return NextResponse.json({ error: (error as Error & { code?: string }).code ?? 'SNAPSHOT_APPROVE_FAILED', message }, { status });
  }
}