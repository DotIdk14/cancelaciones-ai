import { NextResponse, type NextRequest } from 'next/server';
import { authorizeAuditOperation } from '@/server/reporting/authz';
import { isCode, listEvidenceSelection, saveEvidenceSelection } from '@/server/dictamen/service';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const authz = await authorizeAuditOperation(_request, auditId);
  if (!authz.ok) return authz.response;
  const selection = await listEvidenceSelection(authz.auth);
  return NextResponse.json({ selection });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const authz = await authorizeAuditOperation(request, auditId);
  if (!authz.ok) return authz.response;

  let body: { evidenceIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON', message: 'JSON invalido.' }, { status: 400 });
  }
  const evidenceIds = Array.isArray(body.evidenceIds) ? body.evidenceIds : null;
  if (!evidenceIds) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'evidenceIds es obligatorio.' }, { status: 400 });
  }

  try {
    const selection = await saveEvidenceSelection(
      authz.auth,
      evidenceIds.map((evidenceId) => ({ evidenceId })),
    );
    return NextResponse.json({ selection });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No fue posible guardar la seleccion.';
    const status = isCode(error, 'EVIDENCE_NOT_IN_AUDIT') ? 403 : 400;
    return NextResponse.json({ error: (error as Error & { code?: string }).code ?? 'EVIDENCE_SELECTION_FAILED', message }, { status });
  }
}