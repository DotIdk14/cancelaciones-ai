import { NextResponse, type NextRequest } from 'next/server';
import { createEvidenceRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ evidenceId: string }> }) {
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

  return new NextResponse(download.data, {
    headers: {
      'Content-Type': evidence.detectedMimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(evidence.safeFilename)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
