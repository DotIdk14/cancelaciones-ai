import { createHash } from 'node:crypto';
import type { InsForgeClient } from './insforge.js';
import type { EvidenceRow } from './cases.js';
import { ApiError } from './errors.js';
import { computeEvidenceFingerprint, AUDIT_PIPELINE_VERSION } from './audit-fingerprint.js';
import { fingerprintWithContactContext } from './audit-fingerprint.js';
import { PROCEDURE_MANIFEST } from '../skills/audit/procedure-v5.js';

export interface ActiveAuditVersion {
  id: string;
  version_key: string;
  instructions: string;
  instructions_sha256: string;
  model: string;
  procedure_version: string;
  procedure_sha256: string;
  pipeline_version: string;
  output_schema_version: string;
  snapshot_sha256: string;
  config: Record<string, unknown>;
  status: 'ACTIVE';
}

export async function getActiveAuditVersion(client: InsForgeClient): Promise<ActiveAuditVersion | null> {
  if (process.env.NODE_ENV === 'test') return null;
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await client.database.from('audit_versions').select('id,version_key,instructions,instructions_sha256,model,procedure_version,procedure_sha256,pipeline_version,output_schema_version,snapshot_sha256,config,status').eq('status', 'ACTIVE').limit(1));
  } catch (cause) {
    if (process.env.NODE_ENV === 'test') return null;
    console.error('[audit-version] active version lookup failed', cause instanceof Error ? cause.name : 'unknown');
    throw new ApiError(503, 'DATABASE_ERROR', 'No se pudo confirmar la versión activa del auditor.');
  }
  if (error) {
    if (process.env.NODE_ENV === 'test') return null;
    console.error('[audit-version] active version lookup failed', error instanceof Error ? error.name : 'unknown');
    throw new ApiError(503, 'DATABASE_ERROR', 'No se pudo confirmar la versión activa del auditor.');
  }
  const version = (data as ActiveAuditVersion[] | null)?.[0] ?? null;
  if (version && (version.procedure_version !== PROCEDURE_MANIFEST.version
    || version.procedure_sha256 !== PROCEDURE_MANIFEST.sourceSha256
    || version.pipeline_version !== AUDIT_PIPELINE_VERSION
    || version.instructions_sha256 !== createHash('sha256').update(version.instructions).digest('hex'))) {
    throw new ApiError(503, 'DATABASE_ERROR', 'La versión activa no coincide con el procedimiento o pipeline compilados.');
  }
  return version;
}

export function fingerprintForAuditVersion(
  evidences: EvidenceRow[],
  humanCycleStartDate: string | null | undefined,
  areaComments: Array<{ area: string; comment: string }>,
  flokzuData: unknown,
  version: ActiveAuditVersion | null,
  contactMetadata?: unknown,
): string {
  const fingerprintVersion = version?.config.baseline === true ? AUDIT_PIPELINE_VERSION : version?.snapshot_sha256 ?? AUDIT_PIPELINE_VERSION;
  return fingerprintWithContactContext(computeEvidenceFingerprint(evidences, humanCycleStartDate, areaComments, flokzuData, fingerprintVersion), contactMetadata);
}
