import { NextResponse, type NextRequest } from 'next/server';
import { createDictamenDocumentRepository } from '@cancelaciones/db';
import { authorizeAuditOperation } from '@/server/reporting/authz';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const authz = await authorizeAuditOperation(_request, auditId);
  if (!authz.ok) return authz.response;
  const documents = await createDictamenDocumentRepository(authz.auth.client.database).listByAudit(auditId);
  return NextResponse.json({ documents });
}