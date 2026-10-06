import { describe, expect, it } from 'vitest';
import {
  AUDIT_PIPELINE_VERSION,
  computeEvidenceFingerprint,
  computeEvidenceFingerprintFor,
} from '../src/server/audit-service';
import type { EvidenceRow } from '../src/server/cases';

const evidence = (id: string): EvidenceRow =>
  ({ id, hash: `hash-${id}`, transcript_json: null }) as unknown as EvidenceRow;

describe('huella del expediente', () => {
  it('la misma evidencia con el mismo pipeline da la misma huella', () => {
    const rows = [evidence('ev-1'), evidence('ev-2')];

    expect(computeEvidenceFingerprint(rows)).toBe(computeEvidenceFingerprint(rows));
  });

  it('la versión del pipeline forma parte de la huella', () => {
    const rows = [evidence('ev-1')];

    const anterior = computeEvidenceFingerprintFor('audit-v5-pipeline-1', rows);
    const vigente = computeEvidenceFingerprintFor('audit-v5-pipeline-2', rows);

    expect(anterior).not.toBe(vigente);
    expect(computeEvidenceFingerprint(rows)).toBe(computeEvidenceFingerprintFor(AUDIT_PIPELINE_VERSION, rows));
  });

  it('un byte distinto en una evidencia cambia la huella', () => {
    const base = [{ ...evidence('ev-1'), hash: 'hash-a' } as unknown as EvidenceRow];
    const cambiado = [{ ...evidence('ev-1'), hash: 'hash-b' } as unknown as EvidenceRow];

    expect(computeEvidenceFingerprint(base)).not.toBe(computeEvidenceFingerprint(cambiado));
  });
});