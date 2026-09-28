import { NextResponse, type NextRequest } from 'next/server';
import { createEvidenceRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Tipos que el navegador puede abrir directamente (imagen, PDF, texto). */
function isViewableInline(mimeType?: string | null) {
  const mime = mimeType?.toLowerCase() ?? '';
  return mime.startsWith('image/') || mime === 'application/pdf' || mime.startsWith('text/');
}

export async function GET(request: NextRequest, context: { params: Promise<{ evidenceId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });

  const { evidenceId } = await context.params;
  const client = await createInsForgeServerClient();
  const repo = createEvidenceRepository(client.database);
  const evidence = await repo.findStoredById(evidenceId);
  if (!evidence?.storageKey) return NextResponse.json({ error: 'NOT_FOUND', message: 'Evidencia no encontrada.' }, { status: 404 });

  const download = await client.storage.from(evidence.storageBucket).download(evidence.storageKey);
  if (download.error || !download.data) {
    return NextResponse.json({ error: 'STORAGE_ERROR', message: 'No fue posible recuperar el archivo.' }, { status: 502 });
  }

  const searchParams = request.nextUrl.searchParams;
  const forceDownload = searchParams.get('download') === '1';
  const forceInline = searchParams.get('inline') === '1';
  const viewable = isViewableInline(evidence.detectedMimeType);
  const disposition = forceDownload || (!forceInline && !viewable) ? 'attachment' : 'inline';
  const mimeType = evidence.detectedMimeType ?? evidence.mimeType ?? 'application/octet-stream';
  const filename = encodeURIComponent(evidence.safeFilename ?? evidence.originalFilename ?? evidence.filename);

  return new NextResponse(download.data, {
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': `${disposition}; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
