import { NextResponse, type NextRequest } from 'next/server';
import { createAdjudicationRepository } from '@cancelaciones/db';
import type { FinalAdjudicationType } from '@cancelaciones/domain';
import { authorizeAuditOperation } from '@/server/reporting/authz';
import { recordFinalAdjudication, AdjudicationServiceError } from '@/server/adjudication/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorizeAuditOperation(request, auditId);
  if (!auth.ok) return auth.response;
  const adjudication = await createAdjudicationRepository(auth.auth.client.database).findLatestByAudit(auditId);
  return NextResponse.json({ adjudication });
}

export async function POST(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorizeAuditOperation(request, auditId);
  if (!auth.ok) return auth.response;

  let body: { adjudicationType?: string; finalOutcome?: string; comment?: string; evidenceIds?: string[] } = {};
  try { body = await request.json(); } catch { body = {}; }

  if (!body.adjudicationType) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'adjudicationType es obligatorio.' }, { status: 400 });
  }

  try {
    const result = await recordFinalAdjudication({
      database: auth.auth.client.database,
      auditId,
      actorId: auth.auth.user.id,
      adjudicationType: body.adjudicationType as FinalAdjudicationType,
      finalOutcome: body.finalOutcome ?? null,
      comment: body.comment ?? null,
      evidenceIds: body.evidenceIds ?? [],
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof AdjudicationServiceError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'ADJUDICATION_FAILED', message: error instanceof Error ? error.message : 'No fue posible adjudicar.' }, { status: 500 });
  }
}