import { NextResponse, type NextRequest } from 'next/server';
import { createAuditLogRepository, createAuditRepository, createEvidenceRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';
import { prepareEvidenceFile } from '@/server/evidence/upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });

  const { auditId } = await context.params;
  const client = await createInsForgeServerClient();
  const audits = createAuditRepository(client.database);
  const audit = await audits.findById(auditId);
  if (!audit) return NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 });

  const evidences = createEvidenceRepository(client.database);
  return NextResponse.json({ evidences: await evidences.listByAudit(auditId) });
}

export async function POST(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });

  const { auditId } = await context.params;
  const client = await createInsForgeServerClient();
  const audits = createAuditRepository(client.database);
  const audit = await audits.findById(auditId);
  if (!audit) return NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 });

  const formData = await request.formData();
  const files = formData.getAll('files').filter((value): value is File => value instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: 'BAD_REQUEST', message: 'No se recibieron archivos.' }, { status: 400 });
  }

  const evidences = createEvidenceRepository(client.database);
  const auditLog = createAuditLogRepository(client.database);
  const results = [];

  for (const file of files) {
    let evidenceId: string | null = null;
    try {
      const prepared = await prepareEvidenceFile(auditId, file);
      evidenceId = prepared.evidenceId;

      await evidences.createPending({
        id: prepared.evidenceId,
        auditId,
        originalFilename: prepared.originalFilename,
        safeFilename: prepared.safeFilename,
        mimeType: prepared.declaredMimeType,
        detectedMimeType: prepared.detectedMimeType,
        sizeBytes: prepared.sizeBytes,
        sha256: prepared.sha256,
        storageBucket: prepared.storageBucket,
        storageKey: prepared.storageKey,
        uploadedBy: user.id,
      });

      await auditLog.record({ auditId, eventType: 'EVIDENCE_UPLOAD_STARTED', actorId: user.id, metadata: { evidenceId } });

      const body = new ArrayBuffer(prepared.bytes.byteLength);
      new Uint8Array(body).set(prepared.bytes);
      const blob = new Blob([body], { type: prepared.detectedMimeType });
      const upload = await client.storage.from(prepared.storageBucket).upload(prepared.storageKey, blob);
      if (upload.error) throw new Error(upload.error.message ?? 'Storage no pudo guardar el archivo.');

      await evidences.markStored(prepared.evidenceId);
      await auditLog.record({ auditId, eventType: 'EVIDENCE_UPLOADED', actorId: user.id, metadata: { evidenceId, sha256: prepared.sha256 } });
      results.push({ filename: prepared.originalFilename, evidenceId, status: 'STORED' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No fue posible subir el archivo.';
      if (evidenceId) {
        try {
          await evidences.markFailed(evidenceId, message);
          await auditLog.record({ auditId, eventType: 'EVIDENCE_UPLOAD_FAILED', actorId: user.id, metadata: { evidenceId } });
        } catch {
          // Do not mask the user-facing upload failure with cleanup/logging errors.
        }
      }
      results.push({ filename: file.name, evidenceId, status: 'FAILED', message });
    }
  }

  const ok = results.some((result) => result.status === 'STORED');
  return NextResponse.json({ results }, { status: ok ? 207 : 400 });
}
