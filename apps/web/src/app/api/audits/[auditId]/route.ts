import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createAuditRepository, createDictamenDocumentRepository, createEvidenceRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/audits/:auditId
 *
 * Elimina una auditoría de forma irreversible a través de la función RPC
 * public.delete_audit() (creador de la auditoría o rol OWNER). La función
 * registra SIEMPRE en audit_log quién la eliminó, cuándo y sobre qué
 * expediente. Además se limpian (best-effort) los archivos de storage
 * asociados a evidencias y dictámenes.
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });
  }

  const reason = await readReason(request);

  const client = await createInsForgeServerClient();
  const repo = createAuditRepository(client.database);

  const audit = await repo.findById(auditId);
  if (!audit) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 });
  }

  // Misma regla que la función de base de datos: creador u OWNER.
  const role = await currentUserRole(client, user.id);
  if (audit.createdBy !== user.id && role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN', message: 'No puede eliminar esta auditoria.' }, { status: 403 });
  }

  // Juntamos las llaves de storage antes del borrado en DB (ya no existirán después).
  const storageKeys = await collectStorageKeys(client, auditId);

  const deleted = await repo.deleteAudit(auditId, reason);

  // Limpieza best-effort de objetos de storage: si falla, la auditoría ya está
  // eliminada y la trazabilidad quedó registrada; no bloqueamos la respuesta.
  await removeStorageObjects(client, storageKeys);

  revalidatePath('/auditorias');
  return NextResponse.json({ deleted: deleted ?? { auditId } }, { status: 200 });
}

async function readReason(request: NextRequest): Promise<string | null> {
  try {
    const body = await request.json();
    if (body && typeof body === 'object' && typeof (body as Record<string, unknown>).reason === 'string') {
      const reason = (body as Record<string, unknown>).reason as string;
      const trimmed = reason.trim();
      return trimmed.length > 0 ? trimmed.slice(0, 500) : null;
    }
    return null;
  } catch {
    return null;
  }
}

async function currentUserRole(client: Awaited<ReturnType<typeof createInsForgeServerClient>>, userId: string): Promise<string | null> {
  try {
    const { data, error } = await client.database
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .limit(1);
    if (error) return null;
    return (data?.[0]?.role as string | undefined) ?? null;
  } catch {
    return null;
  }
}

async function collectStorageKeys(client: Awaited<ReturnType<typeof createInsForgeServerClient>>, auditId: string) {
  const keys: Array<{ bucket: string; key: string }> = [];
  try {
    const evidences = await createEvidenceRepository(client.database).listByAudit(auditId);
    for (const evidence of evidences) {
      if (evidence.storageBucket && evidence.storageKey) {
        keys.push({ bucket: evidence.storageBucket, key: evidence.storageKey });
      }
    }
  } catch {
    // Si no se pueden leer evidencias, el borrado principal continúa igual.
  }
  try {
    const documents = await createDictamenDocumentRepository(client.database).listByAudit(auditId);
    for (const doc of documents) {
      if (doc.storageBucket && doc.storageKey) {
        keys.push({ bucket: doc.storageBucket, key: doc.storageKey });
      }
    }
  } catch {
    // Ídem: la limpieza de storage es best-effort.
  }
  return keys;
}

async function removeStorageObjects(client: Awaited<ReturnType<typeof createInsForgeServerClient>>, keys: Array<{ bucket: string; key: string }>) {
  if (keys.length === 0) return;
  const byBucket = new Map<string, string[]>();
  for (const { bucket, key } of keys) {
    const list = byBucket.get(bucket) ?? [];
    list.push(key);
    byBucket.set(bucket, list);
  }
  await Promise.allSettled(
    Array.from(byBucket.entries()).map(async ([bucket, objectKeys]) => {
      await client.storage.from(bucket).remove(objectKeys);
    }),
  );
}