import { NextResponse, type NextRequest } from 'next/server';
import { authorizeAuditOperation } from '@/server/reporting/authz';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ auditId: string; docId: string }> }) {
  const { auditId, docId } = await context.params;
  const authz = await authorizeAuditOperation(_request, auditId);
  if (!authz.ok) return authz.response;

  const { data, error } = await authz.auth.client.database
    .from('dictamen_documents')
    .select('id,snapshot_id,audit_id,kind,storage_bucket,storage_key')
    .eq('id', docId)
    .eq('audit_id', auditId)
    .limit(1);
  if (error) return NextResponse.json({ error: 'DATABASE_ERROR', message: error.message }, { status: 500 });
  const doc = data?.[0] as
    | { id: string; snapshot_id: string; audit_id: string; kind: string; storage_bucket: string; storage_key: string }
    | undefined;
  if (!doc?.storage_key) return NextResponse.json({ error: 'NOT_FOUND', message: 'Documento no encontrado.' }, { status: 404 });

  const download = await authz.auth.client.storage.from(doc.storage_bucket).download(doc.storage_key);
  if (download.error || !download.data) {
    return NextResponse.json({ error: 'STORAGE_ERROR', message: 'No fue posible recuperar el PDF.' }, { status: 502 });
  }

  return new NextResponse(download.data, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="dictamen-${doc.kind.toLowerCase()}-${auditId}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
