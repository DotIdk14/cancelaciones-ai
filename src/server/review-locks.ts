import type { InsForgeClient } from './insforge.js';
import { ApiError } from './http.js';
import { getCaseOr404, latestAudit, latestCompletedAudit, listEvidenceRows } from './cases.js';
import { fingerprintForAuditVersion, getActiveAuditVersion } from './audit-versions.js';
import { listAreaComments } from './area-comments.js';
import { getCaseReviewForAudit, listCaseReviewsForCase } from './reviews.js';

async function fingerprintNow(client: InsForgeClient, caseId: string): Promise<string> {
  const [row, evidences, comments] = await Promise.all([
    getCaseOr404(client, caseId),
    listEvidenceRows(client, caseId),
    listAreaComments(client, caseId),
  ]);
  const activeVersion = await getActiveAuditVersion(client);
  return fingerprintForAuditVersion(evidences, row.cycle_start_date ?? null, comments, row.flokzu_data, activeVersion);
}

function isMissingEvidenceResolution(result: string): boolean {
  return result === 'EVIDENCIA_INSUFICIENTE';
}

export async function assertAuditMayRun(client: InsForgeClient, caseId: string): Promise<void> {
  const [latest, reviews, fingerprint] = await Promise.all([
    latestCompletedAudit(client, caseId),
    listCaseReviewsForCase(client, caseId),
    fingerprintNow(client, caseId),
  ]);
  const mostRecentReview = reviews[0] ?? null;
  if (!mostRecentReview) return;
  if (!isMissingEvidenceResolution(mostRecentReview.result)) {
    throw new ApiError(409, 'VALIDATION_ERROR', 'La auditoría ya tiene resolución del Asesor. Solo puedes volver a auditar después de una resolución de evidencia insuficiente.');
  }
  if (latest?.evidence_fingerprint === fingerprint) {
    throw new ApiError(409, 'VALIDATION_ERROR', 'Agrega la evidencia faltante antes de volver a auditar.');
  }
}

export async function assertEvidenceMayBeAdded(client: InsForgeClient, caseId: string): Promise<void> {
  const [latest, running, reviews, fingerprint] = await Promise.all([
    latestCompletedAudit(client, caseId),
    latestAudit(client, caseId),
    listCaseReviewsForCase(client, caseId),
    fingerprintNow(client, caseId),
  ]);
  if (running?.status === 'RUNNING') {
    throw new ApiError(409, 'VALIDATION_ERROR', 'Espera a que termine la auditoría antes de agregar evidencia.');
  }
  const mostRecentReview = reviews[0] ?? null;
  if (!mostRecentReview || isMissingEvidenceResolution(mostRecentReview.result)) return;
  const latestReview = latest ? await getCaseReviewForAudit(client, latest.id) : null;
  if (latest && latestReview === null && latest.evidence_fingerprint === fingerprint) return;
  throw new ApiError(409, 'VALIDATION_ERROR', 'La resolución del Asesor ya está registrada. Solo se admite evidencia adicional cuando resolvió evidencia insuficiente.');
}

export async function assertEvidenceMayBeDeleted(client: InsForgeClient, caseId: string): Promise<void> {
  const [latest, reviews, fingerprint] = await Promise.all([
    latestCompletedAudit(client, caseId),
    listCaseReviewsForCase(client, caseId),
    fingerprintNow(client, caseId),
  ]);
  if (reviews.length === 0) return;
  const latestReview = latest ? await getCaseReviewForAudit(client, latest.id) : null;
  if (latest && latestReview === null && latest.evidence_fingerprint === fingerprint) return;
  throw new ApiError(409, 'VALIDATION_ERROR', 'No se puede eliminar evidencia después de registrar la resolución del Asesor.');
}

export async function assertCaseHasNoAdvisorReview(client: InsForgeClient, caseId: string): Promise<void> {
  if ((await listCaseReviewsForCase(client, caseId)).length > 0) {
    throw new ApiError(409, 'VALIDATION_ERROR', 'El contexto del expediente ya fue revisado por el Asesor y no se puede modificar.');
  }
}
