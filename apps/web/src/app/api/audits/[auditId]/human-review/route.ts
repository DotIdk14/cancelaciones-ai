import { NextResponse, type NextRequest } from 'next/server';
import { createHumanReviewRepository } from '@cancelaciones/db';
import { authorizeAuditOperation } from '@/server/reporting/authz';
import { isCode, submitHumanReview } from '@/server/dictamen/service';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const authz = await authorizeAuditOperation(_request, auditId);
  if (!authz.ok) return authz.response;
  const review = await createHumanReviewRepository(authz.auth.client.database).findByAudit(auditId);
  return NextResponse.json({ review });
}

export async function POST(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const authz = await authorizeAuditOperation(request, auditId);
  if (!authz.ok) return authz.response;

  let body: { decisionType?: 'APPROVE' | 'CORRECT'; humanOutcome?: string | null; humanCause?: string | null; humanReason?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON', message: 'JSON invalido.' }, { status: 400 });
  }
  if (body.decisionType !== 'APPROVE' && body.decisionType !== 'CORRECT') {
    return NextResponse.json({ error: 'INVALID_DECISION_TYPE', message: 'decisionType debe ser APPROVE o CORRECT.' }, { status: 400 });
  }

  try {
    const { review } = await submitHumanReview(authz.auth, {
      decisionType: body.decisionType,
      humanOutcome: body.humanOutcome ?? null,
      humanCause: body.humanCause ?? null,
      humanReason: body.humanReason ?? null,
    });
    return NextResponse.json({ review }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No fue posible guardar la revision humana.';
    const status = isCode(error, 'ENGINE_RUN_NOT_FOUND') ? 409 : 400;
    return NextResponse.json({ error: (error as Error & { code?: string }).code ?? 'HUMAN_REVIEW_FAILED', message }, { status });
  }
}