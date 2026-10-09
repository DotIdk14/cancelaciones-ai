import { createHash } from 'node:crypto';
import { readTranscriptFromJson } from './evidence-prep.js';
import type { EvidenceRow } from './cases.js';

/** Versión del pipeline de preparación y evaluación que produce la huella. */
export const AUDIT_PIPELINE_VERSION = 'audit-v5-pipeline-2';

/** Huella canónica compartida por la ejecución y la proyección de vigencia. */
export function computeEvidenceFingerprint(evidences: EvidenceRow[], humanCycleStartDate?: string | null): string {
  return computeEvidenceFingerprintFor(AUDIT_PIPELINE_VERSION, evidences, humanCycleStartDate);
}

export function computeEvidenceFingerprintFor(
  version: string,
  evidences: EvidenceRow[],
  humanCycleStartDate?: string | null,
): string {
  const canonical = evidences
    .map((evidence) => {
      const derived = evidence.transcript_json ? readTranscriptFromJson(evidence.transcript_json) : null;
      const derivedText = derived?.transcript ?? '';
      return {
        id: evidence.id,
        hash: evidence.hash,
        derivedHash: derivedText ? createHash('sha256').update(derivedText).digest('hex') : null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const payload = humanCycleStartDate
    ? { pipeline: version, evidence: canonical, humanCycleStartDate }
    : { pipeline: version, evidence: canonical };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
