import { createHash, randomUUID } from 'node:crypto';
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
