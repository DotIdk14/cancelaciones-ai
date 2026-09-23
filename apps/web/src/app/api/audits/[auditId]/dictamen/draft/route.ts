import { NextResponse, type NextRequest } from 'next/server';
import { authorizeAuditOperation } from '@/server/reporting/authz';
import { generateDraft, isCode } from '@/server/dictamen/service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const authz = await authorizeAuditOperation(request, auditId);
  if (!authz.ok) return authz.response;

  try {
    const result = await generateDraft(authz.auth);
    return NextResponse.json(result, { status: result.generated ? 201 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No fue posible generar el borrador.';
    const status = isCode(error, 'SNAPSHOT_NOT_FOUND') ? 409 : isCode(error, 'SNAPSHOT_ALREADY_FINAL') ? 409 : 400;
    return NextResponse.json({ error: (error as Error & { code?: string }).code ?? 'DICTAMEN_DRAFT_FAILED', message }, { status });
  }
}