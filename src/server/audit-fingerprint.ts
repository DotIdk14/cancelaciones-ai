import { prepareFlokzuContext } from '../lib/flokzu-administrative.js';
import { createHash } from 'node:crypto';
import { readTranscriptFromJson } from './evidence-prep.js';
import type { EvidenceRow } from './cases.js';
import { readContactConfirmation } from '../shared/audit-contact.js';

/** Una confirmación solo vale para el expediente exacto que vio la persona. */
export function fingerprintWithContactContext(base: string, metadata: unknown): string {
  const confirmation = readContactConfirmation(metadata);
  return confirmation?.performed === true && confirmation.evidenceFingerprint === base
    ? createHash('sha256').update(JSON.stringify({ evidenceFingerprint: base, humanContactPerformed: true })).digest('hex')
    : base;
}

/** Versión del pipeline de preparación y evaluación que produce la huella. */
export const AUDIT_PIPELINE_VERSION = 'audit-v5-pipeline-4';

/** Huella canónica compartida por la ejecución y la proyección de vigencia. */
export function computeEvidenceFingerprint(evidences: EvidenceRow[], humanCycleStartDate?: string | null, areaComments: Array<{ area: string; comment: string }> = [], flokzuData?: unknown, pipelineVersion = AUDIT_PIPELINE_VERSION): string {
  return computeEvidenceFingerprintFor(pipelineVersion, evidences, humanCycleStartDate, areaComments, flokzuData);
}

export function computeEvidenceFingerprintFor(
  version: string,
  evidences: EvidenceRow[],
  humanCycleStartDate?: string | null,
  areaComments: Array<{ area: string; comment: string }> = [],
  flokzuData?: unknown,
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
  const context = areaComments.filter((row) => row.area === 'BACK_OFFICE' || row.area === 'HELPDESK').map(({ area, comment }) => ({ area, comment })).sort((a, b) => a.area.localeCompare(b.area));
  const base = context.length ? { ...payload, areaComments: context } : payload;
  const administrativeContext = prepareFlokzuContext(flokzuData).compact;
  return createHash('sha256').update(JSON.stringify(administrativeContext ? { ...base, administrativeContext } : base)).digest('hex');
}
