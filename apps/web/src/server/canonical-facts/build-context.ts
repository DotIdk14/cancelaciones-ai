import {
  buildCanonicalEvaluateAuditInput,
  candidateToFact,
  mergeCanonicalFacts,
  type Campus,
  type EvaluateAuditInput,
  type EvidenceRef,
  type NivelAcademico,
  type TemporalContext,
} from '@cancelaciones/rule-engine-v2';

import { legacyFactToCanonicalCandidate, type LegacyObservableFactRow } from './legacy-mappings';

export interface BuildCanonicalContextFromLegacyFactsInput {
  readonly legacyFacts: readonly LegacyObservableFactRow[];
  readonly evidences: readonly EvidenceRef[];
  readonly temporal: TemporalContext;
  readonly nivelAcademico: NivelAcademico | null;
  readonly campus: Campus | null;
}

export function buildCanonicalContextFromLegacyFacts(
  input: BuildCanonicalContextFromLegacyFactsInput,
): EvaluateAuditInput {
  const candidates = input.legacyFacts.flatMap((row) => {
    const candidate = legacyFactToCanonicalCandidate(row);
    return candidate === null ? [] : [candidate];
  });
  const facts = mergeCanonicalFacts(candidates.map(candidateToFact));
  return buildCanonicalEvaluateAuditInput({
    facts,
    evidences: input.evidences,
    temporal: input.temporal,
    nivelAcademico: input.nivelAcademico,
    campus: input.campus,
  });
}
