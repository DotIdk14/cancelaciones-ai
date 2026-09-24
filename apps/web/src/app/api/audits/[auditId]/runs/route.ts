import { NextResponse, type NextRequest } from 'next/server';
import { createAuditRunRepository } from '@cancelaciones/db';
import { authorizeAuditOperation } from '@/server/reporting/authz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Timeline append-only de ejecuciones del caso (AI_BASELINE → HUMAN_DECISION → AI_COMPARISON → AI_RECONCILIATION → FINAL_ADJUDICATION). */
export async function GET(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorizeAuditOperation(request, auditId);
  if (!auth.ok) return auth.response;
  const runs = await createAuditRunRepository(auth.auth.client.database).listByAudit(auditId);
  return NextResponse.json({ runs });
}