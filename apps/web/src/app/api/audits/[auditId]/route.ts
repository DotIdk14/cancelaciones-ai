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

  // Preflight de inmutabilidad. NO define la política de archivado: esa decisión
  // sigue siendo del propietario (REQUIRES_OWNER_DECISION: AUDIT_ARCHIVAL_STATE).
  // Lo que hace aquí es evitar una operación que ya sabemos que va a fallar.
  //
  // Con la migración Policy Foundation aplicada, `delete_audit` borra la fila de
  // `audits` y deja que el FK arrastre en CASCADE. La cascada choca con los
  // triggers de append-only y aborta:
  //   fact_run_frozen_snapshots_append_only
  //     -> ai_decision_snapshots_append_only
  //     -> audit_evaluation_envelopes_append_only
  //     -> facts_guard_frozen_run_mutation
  // Medido contra el backend, no inferido.
  //
  // Sin este chequeo, el usuario recibiría un 500 sin explicación. Con él, recibe
  // un 409 que dice qué pasó y por qué. La diferencia no es cosmética: un 500
  // parece un fallo del sistema y un 409 es una respuesta.
  const immutability = await readImmutabilityBlock(client, auditId);
  if (immutability.blocked) {
    return NextResponse.json(
      {
        error: 'AUDIT_IMMUTABLE',
        message: 'Esta auditoria ya contiene una evaluacion inmutable y no puede eliminarse por esta via.',
        detail: immutability.reasons,
        ownerDecision: 'AUDIT_ARCHIVAL_STATE',
      },
      { status: 409 },
    );
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

/**
 * Detecta si la auditoría tiene algo que la hace indeletable por la vía actual.
 * Sólo LEE. No intenta el borrado para "ver si falla": probar un borrado real
 * para descubrir que falla sería precisamente el borrado.
 */
async function readImmutabilityBlock(
  client: Awaited<ReturnType<typeof createInsForgeServerClient>>,
  auditId: string,
): Promise<{ blocked: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  const count = async (table: string, column: string): Promise<number> => {
    try {
      const { data, error } = await client.database.from(table).select('id').eq(column, auditId).limit(1);
      if (error) return 0;
      return (data ?? []).length;
    } catch {
      return 0;
    }
  };
  if (await count('fact_run_frozen_snapshots', 'audit_id')) reasons.push('fact_run_frozen_snapshots');
  if (await count('ai_decision_snapshots', 'audit_id')) reasons.push('ai_decision_snapshots');
  if (await count('audit_evaluation_envelopes', 'audit_id')) reasons.push('audit_evaluation_envelopes');
  return { blocked: reasons.length > 0, reasons };
}

async function readReason(request: NextRequest): Promise<string | null> {  try {
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