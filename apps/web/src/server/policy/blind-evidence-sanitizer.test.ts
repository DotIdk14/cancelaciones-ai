import type { JobArtifact, StoredFact } from '@cancelaciones/db';
import { describe, expect, it } from 'vitest';
import {
  assertBlindManifestComplete,
  assertBlindReferencesValid,
  blindEvidenceSanitizer,
  buildBlindInputManifest,
  filterBlindArtifactsAndFacts,
  type BlindReferenceCandidate,
} from './blind-evidence-sanitizer';

const manifest = [{ artifactId: 'artifact-1', evidenceId: 'evidence-1' }] as const;

function artifact(overrides: Partial<JobArtifact> = {}): JobArtifact {
  return {
    id: 'artifact-1',
    jobId: 'job-1',
    evidenceId: 'evidence-1',
    artifactType: 'document-text',
    result: {},
    contentSha256: 'sha-1',
    createdAt: '2026-09-24T00:00:00Z',
    ...overrides,
  };
}

function fact(overrides: Partial<StoredFact['sourceRef']> = {}): Pick<StoredFact, 'sourceRef'> {
  return {
    sourceRef: {
      evidenceId: 'evidence-1',
      artifactId: 'artifact-1',
      sha256: 'sha-1',
      ...overrides,
    },
  };
}

function candidate(overrides: Partial<BlindReferenceCandidate> = {}): BlindReferenceCandidate {
  return {
    evidenceRefs: [{ evidenceId: 'evidence-1', artifactId: 'artifact-1' }],
    artifactRefs: [{ artifactId: 'artifact-1', sha256: 'sha-1' }],
    ...overrides,
  };
}

describe('blind evidence sanitizer', () => {
  it('no amplía el manifest desde storedFacts', () => {
    const input = {
      artifacts: [{ id: 'artifact-1', evidenceId: 'evidence-1' }],
      storedFacts: [fact({ evidenceId: 'evidence-unknown', artifactId: 'artifact-unknown' })],
      evidencesForSanitization: [{ evidenceId: 'evidence-1', document_role: 'EVIDENCE', artifactId: 'artifact-1' }],
    };
    const built = buildBlindInputManifest(input);

    expect(built).toEqual([{ artifactId: 'artifact-1', evidenceId: 'evidence-1' }]);
  });

  it('acepta referencias consistentes de artifacts, stored facts y candidates', () => {
    expect(() => assertBlindReferencesValid({
      manifest,
      artifacts: [artifact()],
      storedFacts: [fact()],
      candidates: [candidate()],
    })).not.toThrow();
  });

  it('rechaza referencias humanas en artifacts, stored facts y candidates', () => {
    const humanArtifact = artifact({ id: 'artifact-human', evidenceId: 'evidence-human' });
    const humanFact = fact({ evidenceId: 'evidence-human', artifactId: 'artifact-human', sha256: 'sha-1' });
    const humanCandidate = candidate({
      evidenceRefs: [{ evidenceId: 'evidence-human', artifactId: 'artifact-human' }],
      artifactRefs: [{ artifactId: 'artifact-human', sha256: 'sha-1' }],
    });

    for (const input of [
      { artifacts: [humanArtifact], storedFacts: [], candidates: [] },
      { artifacts: [artifact()], storedFacts: [humanFact], candidates: [] },
      { artifacts: [artifact()], storedFacts: [fact()], candidates: [humanCandidate] },
    ]) {
      expect(() => assertBlindReferencesValid({ manifest, ...input })).toThrow('BLIND_REFERENCE_INVALID');
    }
  });

  it('rechaza referencias desconocidas en artifacts, stored facts y candidates', () => {
    const unknownArtifact = artifact({ id: 'artifact-unknown', evidenceId: 'evidence-unknown' });
    const unknownFact = fact({ evidenceId: 'evidence-unknown' });
    const unknownCandidate = candidate({ evidenceRefs: [{ evidenceId: 'evidence-unknown' }], artifactRefs: [] });

    for (const input of [
      { artifacts: [unknownArtifact], storedFacts: [], candidates: [] },
      { artifacts: [artifact()], storedFacts: [unknownFact], candidates: [] },
      { artifacts: [artifact()], storedFacts: [fact()], candidates: [unknownCandidate] },
    ]) {
      expect(() => assertBlindReferencesValid({ manifest, ...input })).toThrow('BLIND_REFERENCE_INVALID');
    }
  });

  it('rechaza referencias inconsistentes en artifacts, stored facts y candidates', () => {
    const inconsistentArtifact = artifact({ evidenceId: 'evidence-other' });
    const inconsistentFact = fact({ sha256: 'sha-other' });
    const inconsistentCandidate = candidate({
      artifactRefs: [{ artifactId: 'artifact-1', sha256: 'sha-other' }],
    });

    for (const input of [
      { artifacts: [inconsistentArtifact], storedFacts: [], candidates: [] },
      { artifacts: [artifact()], storedFacts: [inconsistentFact], candidates: [] },
      { artifacts: [artifact()], storedFacts: [fact()], candidates: [inconsistentCandidate] },
      { artifacts: [artifact()], storedFacts: [fact({ artifactId: '' })], candidates: [] },
      {
        artifacts: [artifact()],
        storedFacts: [fact()],
        candidates: [candidate({ evidenceRefs: [{ evidenceId: 'evidence-1', artifactId: '' }] })],
      },
    ]) {
      expect(() => assertBlindReferencesValid({ manifest, ...input })).toThrow('BLIND_REFERENCE_INVALID');
    }
  });

  it('falla si un artifact no tiene evidencia permitida', () => {
    expect(() => assertBlindManifestComplete([{ artifactId: 'a1', evidenceId: '' }], new Set(['e1'])))
      .toThrow(/BLIND_MANIFEST_INCOMPLETE/);
  });

  it.each([
    ['desconocido', 'UNKNOWN_ROLE', 'UNKNOWN_ROLE'],
    ['vacío', '', ''],
    ['ausente', undefined, 'undefined'],
  ])('excluye role %s y su artifact del manifest', (_case, documentRole, roleSummaryKey) => {
    const unknownEvidence = {
      evidenceId: 'unknown',
      artifactId: 'a-unknown',
      ...(documentRole === undefined ? {} : { document_role: documentRole }),
    };
    const manifest = buildBlindInputManifest({
      artifacts: [
        { id: 'a-safe', evidenceId: 'safe' },
        { id: 'a-unknown', evidenceId: 'unknown' },
      ],
      evidencesForSanitization: [
        { evidenceId: 'safe', document_role: 'EVIDENCE', artifactId: 'a-safe' },
        unknownEvidence,
      ],
    });
    const result = blindEvidenceSanitizer([
      { evidenceId: 'safe', document_role: 'EVIDENCE', artifactId: 'a-safe' },
      unknownEvidence,
    ], new Map());

    expect(result.allowed).toEqual(['safe']);
    expect(result.excluded).toEqual([{
      evidenceId: 'unknown',
      reason: `document_role ${roleSummaryKey}: sólo EVIDENCE es permitido en BLIND_MACHINE_AUDIT`,
      artifactId: 'a-unknown',
    }]);
    expect(result.roleSummary).toEqual({ EVIDENCE: 1, [roleSummaryKey]: 1 });
    expect(manifest).toEqual([{ artifactId: 'a-safe', evidenceId: 'safe' }]);
    expect(() => assertBlindManifestComplete(manifest, new Set(result.allowed))).not.toThrow();
  });

  it('excluye roles humanos y no duplica exclusiones', () => {
    const result = blindEvidenceSanitizer([
      { evidenceId: 'human', document_role: 'HUMAN_DECISION_DOCUMENT', artifactId: 'a1' },
      { evidenceId: 'adjudication', document_role: 'ADJUDICATION_EVIDENCE', artifactId: 'a2' },
      { evidenceId: 'safe', document_role: 'EVIDENCE', artifactId: 'a3' },
    ], new Map([
      ['human', 'Dictamen humano Confirm_AI'],
      ['adjudication', 'Decisión humana'],
    ]));

    expect(result.allowed).toEqual(['safe']);
    expect(result.excluded.filter((item) => item.evidenceId === 'human')).toHaveLength(1);
    expect(result.excluded.filter((item) => item.evidenceId === 'adjudication')).toHaveLength(1);
  });

  it('consulta el texto por evidenceId y filtra por la relación artifactId-evidenceId', () => {
    const manifest = buildBlindInputManifest({
      artifacts: [
        { id: 'a1', evidenceId: 'e1' },
        { id: 'a2', evidenceId: 'e2' },
      ],
      evidencesForSanitization: [
        { evidenceId: 'e1', document_role: 'EVIDENCE', artifactId: 'a1' },
        { evidenceId: 'e2', document_role: 'EVIDENCE', artifactId: 'a2' },
      ],
    });
    const result = blindEvidenceSanitizer([
      { evidenceId: 'e1', document_role: 'EVIDENCE', artifactId: 'a1' },
      { evidenceId: 'e2', document_role: 'EVIDENCE', artifactId: 'a2' },
    ], new Map([
      ['e1', 'texto limpio'],
      ['e2', 'Dictamen: se determina un resultado humano'],
    ]));

    expect(result.allowed).toEqual(['e1']);
    expect(filterBlindArtifactsAndFacts([{ id: 'a1', evidenceId: 'e1' }, { id: 'a2', evidenceId: 'e2' }], manifest.slice(0, 1)))
      .toEqual([{ id: 'a1', evidenceId: 'e1' }]);
  });
});
