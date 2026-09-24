import { NextResponse, type NextRequest } from 'next/server';
import { createComparisonRepository } from '@cancelaciones/db';
import { authorizeAuditOperation } from '@/server/reporting/authz';
import { runComparison, ComparisonServiceError } from '@/server/comparison/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorizeAuditOperation(request, auditId);
  if (!auth.ok) return auth.response;
  const comparison = await createComparisonRepository(auth.auth.client.database).findLatestByAudit(auditId);
  return NextResponse.json({ comparison });
}

export async function POST(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorizeAuditOperation(request, auditId);
  if (!auth.ok) return auth.response;

  try {
    const result = await runComparison({ database: auth.auth.client.database, auditId, actorId: auth.auth.user.id });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ComparisonServiceError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: 'COMPARISON_FAILED', message: error instanceof Error ? error.message : 'No fue posible comparar.' }, { status: 500 });
  }
}