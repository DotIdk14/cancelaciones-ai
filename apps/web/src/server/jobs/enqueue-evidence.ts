import { createEvidenceRepository, createJobRepository, type DatabaseClient } from '@cancelaciones/db';
import { stableFingerprint } from '@cancelaciones/domain';

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
  rerun?: boolean;
}): Promise<EnqueuedEvidenceJob[]> {
  const repository = createJobRepository(input.database);
  const evidences = await createEvidenceRepository(input.database).listByAudit(input.auditId);
  // Aislamiento de baseline: solo los documentos con rol EVIDENCE entran al
  // pipeline de evidencias y, por lo tanto, al universo de hechos. El dictamen
  // humano (HUMAN_DECISION_DOCUMENT) y las evidencias de adjudicación se
  // procesan por jobs dedicados que nunca alimentan el hechario de la IA.
  const stored = evidences.filter((evidence) => evidence.status === 'STORED' && evidence.documentRole === 'EVIDENCE');
  const jobs: EnqueuedEvidenceJob[] = [];

  for (const evidence of stored) {
    const version = evidence.detectedMimeType.startsWith('image/')
      ? input.rerun
        ? 'vision-extraction-v4'
        : 'vision-extraction-v3'
      : input.rerun
        ? 'deterministic-text-v2'
        : 'deterministic-text-v1';
    const payload = { auditId: input.auditId, evidenceId: evidence.id, sha256: evidence.sha256, version, actorId: input.actorId };
    const job = await repository.enqueue({
      auditId: input.auditId,
      jobType: 'EVIDENCE_PROCESSING',
      operationScope: `evidence:${evidence.id}:process`,
      idempotencyKey: `evidence:${evidence.id}:process:${version}`,
      inputFingerprint: stableFingerprint(payload),
      payload,
      evidenceId: evidence.id,
      actorId: input.actorId,
    });
    jobs.push({ evidenceId: evidence.id, jobId: job.id });
  }

  return jobs;
}
