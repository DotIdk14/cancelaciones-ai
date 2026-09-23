import { createHash, randomUUID } from 'node:crypto';
import { createAuditLogRepository, createEvidenceRepository, type DatabaseClient } from '@cancelaciones/db';
import { buildEvidenceStorageKey, EVIDENCE_BUCKET, validateEvidenceFile } from '@cancelaciones/domain';

export interface PreparedEvidenceFile {
  evidenceId: string;
  originalFilename: string;
  safeFilename: string;
  declaredMimeType: string;
  detectedMimeType: string;
  sizeBytes: number;
  sha256: string;
  storageBucket: string;
  storageKey: string;
  bytes: Uint8Array;
}

export interface StoredEvidenceResult {
  filename: string;
  evidenceId: string | null;
  status: 'STORED' | 'FAILED';
  message?: string;
}

interface StorageClient {
  from(bucket: string): {
    upload(key: string, body: Blob): Promise<{ error?: { message?: string } | null }>;
  };
}

export async function prepareEvidenceFile(auditId: string, file: File): Promise<PreparedEvidenceFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateEvidenceFile({
    filename: file.name,
    declaredMimeType: file.type,
    sizeBytes: file.size,
    firstBytes: bytes.slice(0, 16),
  });

  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  const evidenceId = randomUUID();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const storageKey = buildEvidenceStorageKey({ auditId, evidenceId, safeFilename: validation.safeFilename });

  return {
    evidenceId,
    originalFilename: file.name,
    safeFilename: validation.safeFilename,
    declaredMimeType: file.type,
    detectedMimeType: validation.detectedMimeType,
    sizeBytes: file.size,
    sha256,
    storageBucket: EVIDENCE_BUCKET,
    storageKey,
    bytes,
  };
}

export async function uploadEvidenceFilesForAudit(input: {
  auditId: string;
  actorId: string;
  files: File[];
  database: DatabaseClient;
  storage: StorageClient;
}): Promise<StoredEvidenceResult[]> {
  const evidences = createEvidenceRepository(input.database);
  const auditLog = createAuditLogRepository(input.database);
  const results: StoredEvidenceResult[] = [];

  for (const file of input.files) {
    let evidenceId: string | null = null;
    try {
      const prepared = await prepareEvidenceFile(input.auditId, file);
      evidenceId = prepared.evidenceId;

      await evidences.createPending({
        id: prepared.evidenceId,
        auditId: input.auditId,
        originalFilename: prepared.originalFilename,
        safeFilename: prepared.safeFilename,
        mimeType: prepared.declaredMimeType,
        detectedMimeType: prepared.detectedMimeType,
        sizeBytes: prepared.sizeBytes,
        sha256: prepared.sha256,
        storageBucket: prepared.storageBucket,
        storageKey: prepared.storageKey,
        uploadedBy: input.actorId,
      });

      await auditLog.record({ auditId: input.auditId, eventType: 'EVIDENCE_UPLOAD_STARTED', actorId: input.actorId, metadata: { evidenceId } });

      const body = new ArrayBuffer(prepared.bytes.byteLength);
      new Uint8Array(body).set(prepared.bytes);
      const blob = new Blob([body], { type: prepared.detectedMimeType });
      const upload = await input.storage.from(prepared.storageBucket).upload(prepared.storageKey, blob);
      if (upload.error) throw new Error(upload.error.message ?? 'Storage no pudo guardar el archivo.');

      await evidences.markStored(prepared.evidenceId);
      await auditLog.record({ auditId: input.auditId, eventType: 'EVIDENCE_UPLOADED', actorId: input.actorId, metadata: { evidenceId, sha256: prepared.sha256 } });
      results.push({ filename: prepared.originalFilename, evidenceId, status: 'STORED' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No fue posible subir el archivo.';
      if (evidenceId) {
        try {
          await evidences.markFailed(evidenceId, message);
          await auditLog.record({ auditId: input.auditId, eventType: 'EVIDENCE_UPLOAD_FAILED', actorId: input.actorId, metadata: { evidenceId } });
        } catch {
          // No ocultar el error original de carga con errores de limpieza o bitacora.
        }
      }
      results.push({ filename: file.name, evidenceId, status: 'FAILED', message });
    }
  }

  return results;
}
