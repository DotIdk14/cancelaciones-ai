import type { EvidenceRef, Fact, FactProvenance } from '../contracts';

export function mergeCanonicalFacts(facts: readonly Fact[]): readonly Fact[] {
  const buckets = new Map<string, Fact[]>();
  for (const fact of facts) {
    const bucket = buckets.get(fact.factId) ?? [];
    bucket.push(fact);
    buckets.set(fact.factId, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([factId, bucket]) => mergeBucket(factId, bucket));
}

function mergeBucket(factId: string, facts: readonly Fact[]): Fact {
  if (facts.length === 1) return facts[0];

  const provenance = facts.flatMap((fact) => fact.provenance).sort(byEvidenceId);
  const evidenceRefs = dedupeEvidenceRefs(facts.flatMap((fact) => fact.evidenceRefs));
  const known = facts.filter((fact) => fact.state === 'KNOWN');
  const contradicted = facts.some((fact) => fact.state === 'CONTRADICTED');

  if (contradicted || hasIncompatibleKnownValues(known)) {
    return {
      factId,
      value: null,
      state: 'CONTRADICTED',
      evidenceRefs,
      provenance,
      extractionMethod: 'IMPORTED',
      relevantTimestamp: firstTimestamp(facts),
      notes: 'Evidencias canónicas incompatibles preservadas; no se eligió una ganadora.',
    };
  }

  if (known.length > 0) {
    const winner = known[0];
    return {
      ...winner,
      evidenceRefs,
      provenance,
      relevantTimestamp: winner.relevantTimestamp ?? firstTimestamp(facts),
    };
  }

  return {
    ...facts[0],
    evidenceRefs,
    provenance,
    value: null,
    state: facts.some((fact) => fact.state === 'NOT_APPLICABLE') ? 'NOT_APPLICABLE' : 'UNKNOWN',
    unknownReason: facts.find((fact) => fact.unknownReason)?.unknownReason ?? 'No se pudo determinar el hecho con la evidencia disponible.',
  };
}

function hasIncompatibleKnownValues(facts: readonly Fact[]): boolean {
  if (facts.length < 2) return false;
  const canonical = stableValue(facts[0].value);
  return facts.some((fact) => stableValue(fact.value) !== canonical);
}

function stableValue(value: unknown): string {
  return JSON.stringify(value, Object.keys(Object(value)).sort());
}

function dedupeEvidenceRefs(refs: readonly EvidenceRef[]): readonly EvidenceRef[] {
  const seen = new Set<string>();
  const result: EvidenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.evidenceId}:${ref.hash ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result.sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
}

function byEvidenceId(a: FactProvenance, b: FactProvenance): number {
  return (a.evidenceId ?? '').localeCompare(b.evidenceId ?? '');
}

function firstTimestamp(facts: readonly Fact[]): string | null {
  return facts.map((fact) => fact.relevantTimestamp).find((timestamp): timestamp is string => timestamp !== null) ?? null;
}
