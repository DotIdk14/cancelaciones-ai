import {
  createAuditLogRepository,
  createAuditRunRepository,
  createEvidenceRepository,
  type DatabaseClient,
} from '@cancelaciones/db';
import { prepareEvidenceFile } from '@/server/evidence/upload';

export class HumanDecisionServiceError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'HumanDecisionServiceError';
  }
}

interface UploadStorageClient {
  from(bucket: string): {
    upload(key: string, body: Blob): Promise<{ error?: { message?: string } | null }>;
  };
}

/**
 * Ingesta del dictamen humano como EVIDENCIA. Esto es infraestructura pura.
 *
 * El documento se almacena con hash y procedencia, y queda registrado su rol
 * `HUMAN_DECISION_DOCUMENT`. No se extraen claims, no se compara con una línea
 * base de la IA y no se produce ninguna decisión: el motor de auditoría no
 * está implementado (AI_EXTRACTS / POLICY_ENGINE_DECIDES).
 */
export async function uploadHumanDecisionDocument(input: {
  auditId: string;
  actorId: string;
  file: File;
  database: DatabaseClient;
  storage: UploadStorageClient;
}): Promise<{ evidenceId: string; runId: string }> {
  const prepared = await prepareEvidenceFile(input.auditId, input.file);
  const evidences = createEvidenceRepository(input.database);
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
    documentRole: 'HUMAN_DECISION_DOCUMENT',
  });

  const body = new ArrayBuffer(prepared.bytes.byteLength);
  new Uint8Array(body).set(prepared.bytes);
  const upload = await input.storage.from(prepared.storageBucket).upload(prepared.storageKey, new Blob([body], { type: prepared.detectedMimeType }));
  if (upload.error) throw new HumanDecisionServiceError(upload.error.message ?? 'Storage no pudo guardar el dictamen humano.', 'STORAGE_UPLOAD_FAILED');
  await evidences.markStored(prepared.evidenceId);

  const run = await createAuditRunRepository(input.database).create({
    auditId: input.auditId,
    runType: 'HUMAN_DECISION',
    status: 'PENDING',
    result: { evidenceId: prepared.evidenceId, sha256: prepared.sha256, filename: prepared.originalFilename },
    createdBy: input.actorId,
  });

  await createAuditLogRepository(input.database).record({
    auditId: input.auditId,
    eventType: 'HUMAN_DECISION_DOCUMENT_UPLOADED',
    actorId: input.actorId,
    metadata: { evidenceId: prepared.evidenceId, runId: run.id, sha256: prepared.sha256 },
  });

  return { evidenceId: prepared.evidenceId, runId: run.id };
}
