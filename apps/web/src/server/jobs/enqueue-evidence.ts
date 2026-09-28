import { createEvidenceRepository, createJobRepository, type DatabaseClient } from '@cancelaciones/db';
import { sha256Hex } from '@cancelaciones/shared';

export interface EnqueuedEvidenceJob {
  evidenceId: string;
  jobId: string;
}

/**
 * Encola un job EVIDENCE_PROCESSING por evidencia STORED, con version de
 * extractor segun el tipo de archivo. Fuente: flujo de cola durablero
 * (jobs + job_artifacts) del workspace; misma logica que el endpoint
 * POST /api/audits/:auditId/jobs (PROCESS_EVIDENCES / RERUN_EVIDENCES),
 * centralizada para no duplicar la implementacion.
 */
export async function enqueueEvidenceProcessingJobs(input: {
  database: DatabaseClient;
  auditId: string;
  actorId: string;
}): Promise<EnqueuedEvidenceJob[]> {
  const repository = createJobRepository(input.database);
  const evidences = await createEvidenceRepository(input.database).listByAudit(input.auditId);
  const stored = evidences.filter((evidence) => evidence.status === 'STORED');
  const jobs: EnqueuedEvidenceJob[] = [];

  for (const evidence of stored) {
    const payload = { auditId: input.auditId, evidenceId: evidence.id, sha256: evidence.sha256, kind: evidence.kind, actorId: input.actorId };
    const job = await repository.enqueue({
      auditId: input.auditId,
      jobType: 'EVIDENCE_PROCESSING',
      operationScope: `evidence:${evidence.id}:process`,
      idempotencyKey: `evidence:${evidence.id}:process:${evidence.sha256 ?? 'nohash'}`,
      inputFingerprint: sha256Hex(JSON.stringify(payload)),
      payload,
      evidenceId: evidence.id,
      maxAttempts: 2,
      actorId: input.actorId,
    });
    jobs.push({ evidenceId: evidence.id, jobId: job.id });
  }

  return jobs;
}
