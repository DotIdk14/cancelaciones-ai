import { NextResponse, type NextRequest } from 'next/server';
import { createAuditRunRepository, createEvidenceRepository, createHumanDecisionExtractRepository } from '@cancelaciones/db';
import { authorizeAuditOperation } from '@/server/reporting/authz';
import { uploadHumanDecisionDocument } from '@/server/human-decision/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorizeAuditOperation(_request, auditId);
  if (!auth.ok) return auth.response;

  const database = auth.auth.client.database;
  const evidence = await createEvidenceRepository(database).listByAudit(auditId);
  const document = evidence.find((item) => item.documentRole === 'HUMAN_DECISION_DOCUMENT') ?? null;
  const run = await createAuditRunRepository(database).findLatestByType(auditId, 'HUMAN_DECISION');
  const extract = await createHumanDecisionExtractRepository(database).findLatestByAudit(auditId);

  return NextResponse.json({ document, run, extract });
}

export async function POST(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorizeAuditOperation(request, auditId);
  if (!auth.ok) return auth.response;

  const formData = await request.formData();
  const file = formData.get('document');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'BAD_REQUEST', message: 'Falta el archivo del dictamen humano.' }, { status: 400 });
  }

  try {
    const result = await uploadHumanDecisionDocument({
      auditId,
      actorId: auth.auth.user.id,
      file,
      database: auth.auth.client.database,
      storage: auth.auth.client.storage,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'HUMAN_DECISION_UPLOAD_FAILED';
    return NextResponse.json({ error: code, message: error instanceof Error ? error.message : 'No fue posible subir el dictamen humano.' }, { status: 400 });
  }
}