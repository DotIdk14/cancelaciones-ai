import type { JobArtifact, StoredFact } from '@cancelaciones/db';

export interface SanitizationResult {
  allowed: string[];
  excluded: Array<{ evidenceId: string; reason: string; chunk?: string; artifactId?: string }>;
  detectedHeuristics: string[];
  roleSummary: Record<string, number>;
}

export type BlindInputManifestV1 = ReadonlyArray<BlindInputManifestEntryV1>;

export interface BlindInputManifestEntryV1 {
  artifactId: string;
  evidenceId: string;
}

interface BlindSanitizationEvidence {
  evidenceId: string;
  document_role?: unknown;
  artifactId?: string;
}

interface BlindInputManifestSource {
  artifacts?: Array<Pick<JobArtifact, 'id' | 'evidenceId'>>;
  evidencesForSanitization?: BlindSanitizationEvidence[];
}

interface BlindFilterable {
  id?: unknown;
  evidenceId?: unknown;
  sourceRef?: unknown;
}

export interface BlindReferenceCandidate {
  evidenceRefs: Array<{ evidenceId: string; artifactId?: string; page?: number }>;
  artifactRefs: Array<{ artifactId: string; sha256: string; page?: number }>;
}

interface Heuristic {
  matches: (text: string) => boolean;
  tag: string;
}

type HeuristicFn = Heuristic[];

const humanDecisionHeuristics: Heuristic[] = [
  {
    matches: (text) => /dictamen\s+[a-z]/i.test(text.trim()) || /dictamen\s*:/i.test(text),
    tag: 'DETECTED_DICTAMEN_SYNTACTIC',
  },
  {
    matches: (text) => /CONFIRM_AI|CONFIRM_HUMAN|CONFIRM_BOTH_INCORRECT|BOTH_INCORRECT|INSUFFICIENT_INFORMATION|CUSTOM_FINAL_DECISION/.test(text),
    tag: 'DETECTED_FORMAL_OUTCOME',
  },
  {
    matches: (text) => /se\s+determina|se\s+declara|se\s+resuelve|se\s+aplica|Resultado humano|Resultado final/i.test(text),
    tag: 'DETECTED_RESOLUTION_PHRASE',
  },
  {
    matches: (text) => /página|page|sección|section\s+[0-9]/i.test(text) && /cancelaci|cancelation|dictamen|adjudication/i.test(text),
    tag: 'DETECTED_DICTAMEN_SECTION',
  },
  {
    matches: (text) => /decision[ahuman]?|resolución|resolution/i.test(text) && /human/i.test(text),
    tag: 'DETECTED_HUMAN_REFERENCE',
  },
];

const POTENTIAL_HUMAN_KEYWORDS = [
  'dictamen', 'determina', 'resuelve', 'resolución', 'confirm', 'human', 'humano',
  'Resultado', 'resultado', 'decision', 'resolución final',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function sourceString(source: Record<string, unknown> | undefined, key: string): string {
  const value = source?.[key];
  return typeof value === 'string' ? value : '';
}

function roleLabel(role: unknown): string {
  if (role === undefined) return 'undefined';
  if (role === null) return 'null';
  if (typeof role === 'string') return role;
  return typeof role;
}

function manifestMap(manifest: BlindInputManifestV1): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of manifest) {
    if (entry.artifactId && !map.has(entry.artifactId)) map.set(entry.artifactId, entry.evidenceId);
  }
  return map;
}

function manifestEvidenceIds(manifest: BlindInputManifestV1): Set<string> {
  return new Set(manifest.map((entry) => entry.evidenceId).filter(Boolean));
}

export function buildBlindInputManifest(input: BlindInputManifestSource): BlindInputManifestV1 {
  const entries: BlindInputManifestEntryV1[] = [];
  const artifactEntries = new Map<string, BlindInputManifestEntryV1[]>();
  const excludedArtifactIds = new Set<string>();
  const evidences = input.evidencesForSanitization ?? [];

  for (const evidence of evidences) {
    if (evidence.document_role !== 'EVIDENCE' && evidence.artifactId) {
      excludedArtifactIds.add(evidence.artifactId);
    }
  }

  for (const evidence of evidences) {
    if (evidence.document_role !== 'EVIDENCE' || !evidence.artifactId || excludedArtifactIds.has(evidence.artifactId)) continue;
    const entry = { artifactId: evidence.artifactId, evidenceId: evidence.evidenceId };
    const current = artifactEntries.get(evidence.artifactId) ?? [];
    if (!current.some((item) => item.evidenceId === entry.evidenceId)) {
      current.push(entry);
      artifactEntries.set(evidence.artifactId, current);
      entries.push(entry);
    }
  }

  for (const artifact of input.artifacts ?? []) {
    if (excludedArtifactIds.has(artifact.id) || artifactEntries.has(artifact.id)) continue;
    const entry = { artifactId: artifact.id, evidenceId: '' };
    artifactEntries.set(artifact.id, [entry]);
    entries.push(entry);
  }

  return entries;
}

export function assertBlindManifestComplete(
  manifest: BlindInputManifestV1,
  allowedEvidenceIds: ReadonlySet<string>
): void {
  const artifactEvidence = new Map<string, string>();
  for (const entry of manifest) {
    if (!entry || typeof entry.artifactId !== 'string' || typeof entry.evidenceId !== 'string' || !entry.evidenceId || !allowedEvidenceIds.has(entry.evidenceId)) {
      throw new Error('BLIND_MANIFEST_INCOMPLETE');
    }
    if (entry.artifactId) {
      const previous = artifactEvidence.get(entry.artifactId);
      if (previous && previous !== entry.evidenceId) throw new Error('BLIND_MANIFEST_INCOMPLETE');
      artifactEvidence.set(entry.artifactId, entry.evidenceId);
    }
  }
}

function failBlindReference(): never {
  throw new Error('BLIND_REFERENCE_INVALID');
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function assertBlindReferencesValid(input: {
  manifest: BlindInputManifestV1;
  artifacts: Array<Pick<JobArtifact, 'id' | 'evidenceId' | 'contentSha256'>>;
  storedFacts: Array<Pick<StoredFact, 'sourceRef'>>;
  candidates: ReadonlyArray<BlindReferenceCandidate>;
}): void {
  const artifactEvidence = new Map<string, string>();
  for (const entry of input.manifest) {
    if (!isNonBlankString(entry?.artifactId) || !isNonBlankString(entry?.evidenceId)) failBlindReference();
    const previous = artifactEvidence.get(entry.artifactId);
    if (previous && previous !== entry.evidenceId) failBlindReference();
    artifactEvidence.set(entry.artifactId, entry.evidenceId);
  }
  const evidenceIds = new Set(artifactEvidence.values());
  const artifactById = new Map(input.artifacts.map((artifact) => [artifact.id, artifact]));

  for (const artifact of input.artifacts) {
    if (
      !isNonBlankString(artifact.id)
      || !isNonBlankString(artifact.evidenceId)
      || !isNonBlankString(artifact.contentSha256)
      || artifactEvidence.get(artifact.id) !== artifact.evidenceId
    ) failBlindReference();
  }

  for (const fact of input.storedFacts) {
    const source = isRecord(fact.sourceRef) ? fact.sourceRef : undefined;
    const evidenceId = sourceString(source, 'evidenceId');
    const artifactId = sourceString(source, 'artifactId');
    const sha256 = sourceString(source, 'sha256');
    const artifactHash = sourceString(source, 'artifactHash');
    if (source && 'artifactId' in source && !isNonBlankString(artifactId)) failBlindReference();
    if (source && 'sha256' in source && !isNonBlankString(sha256)) failBlindReference();
    if (source && 'artifactHash' in source && !isNonBlankString(artifactHash)) failBlindReference();
    if (!isNonBlankString(evidenceId) || !evidenceIds.has(evidenceId)) failBlindReference();
    if (!artifactId) {
      if (sha256 || artifactHash) failBlindReference();
      continue;
    }
    const artifact = artifactById.get(artifactId);
    if (!artifact || artifactEvidence.get(artifactId) !== evidenceId) failBlindReference();
    if (sha256 && sha256 !== artifact.contentSha256) failBlindReference();
    if (artifactHash && artifactHash !== artifact.contentSha256) failBlindReference();
  }

  for (const candidate of input.candidates) {
    if (!Array.isArray(candidate?.evidenceRefs) || candidate.evidenceRefs.length === 0) failBlindReference();
    if (!Array.isArray(candidate.artifactRefs) || candidate.artifactRefs.length === 0) failBlindReference();
    const candidateEvidenceIds = new Set<string>();
    for (const reference of candidate.evidenceRefs) {
      if (!isRecord(reference) || !isNonBlankString(reference.evidenceId) || !evidenceIds.has(reference.evidenceId)) failBlindReference();
      candidateEvidenceIds.add(reference.evidenceId);
      const artifactId = sourceString(reference, 'artifactId');
      if ('artifactId' in reference && !isNonBlankString(artifactId)) failBlindReference();
      if (artifactId && artifactEvidence.get(artifactId) !== reference.evidenceId) failBlindReference();
      if (artifactId && !artifactById.has(artifactId)) failBlindReference();
    }
    for (const reference of candidate.artifactRefs) {
      if (!isRecord(reference) || !isNonBlankString(reference.artifactId) || !isNonBlankString(reference.sha256)) failBlindReference();
      const artifact = artifactById.get(reference.artifactId);
      const evidenceId = artifactEvidence.get(reference.artifactId);
      if (!artifact || !evidenceId || !candidateEvidenceIds.has(evidenceId)) failBlindReference();
      if (reference.sha256 !== artifact.contentSha256) failBlindReference();
    }
  }
}

export function filterBlindArtifactsAndFacts<T extends BlindFilterable>(items: T[], manifest: BlindInputManifestV1): T[] {
  const artifactEvidence = manifestMap(manifest);
  const evidenceIds = manifestEvidenceIds(manifest);

  return items.filter((item) => {
    if (isRecord(item.sourceRef)) {
      const evidenceId = sourceString(item.sourceRef, 'evidenceId');
      if (!evidenceId || !evidenceIds.has(evidenceId)) return false;
      const artifactId = sourceString(item.sourceRef, 'artifactId');
      return artifactId ? artifactEvidence.get(artifactId) === evidenceId : true;
    }

    if (typeof item.id === 'string' && typeof item.evidenceId === 'string') {
      return artifactEvidence.get(item.id) === item.evidenceId;
    }

    return false;
  });
}

export function blindEvidenceSanitizer(
  evidences: BlindSanitizationEvidence[],
  artifactTextMap: Map<string, string>
): SanitizationResult {
  const allowed: string[] = [];
  const excluded: Array<{ evidenceId: string; reason: string; chunk?: string; artifactId?: string }> = [];
  const detectedHeuristics: string[] = [];
  const roleSummary: Record<string, number> = Object.create(null) as Record<string, number>;
  const excludedIds = new Set<string>();
  const detectedHeuristicIds = new Set<string>();

  for (const evidence of evidences) {
    const evidenceId = evidence.evidenceId;
    const role = evidence.document_role;
    const currentRole = roleLabel(role);
    roleSummary[currentRole] = (roleSummary[currentRole] ?? 0) + 1;

    if (role === 'HUMAN_DECISION_DOCUMENT' || role === 'ADJUDICATION_EVIDENCE') {
      if (!excludedIds.has(evidenceId)) {
        excludedIds.add(evidenceId);
        excluded.push({
          evidenceId,
          reason: `document_role ${currentRole}: evidencia humana no permitida en BLIND_MACHINE_AUDIT`,
          artifactId: evidence.artifactId,
        });
      }
      continue;
    }

    if (role !== 'EVIDENCE') {
      if (!excludedIds.has(evidenceId)) {
        excludedIds.add(evidenceId);
        excluded.push({
          evidenceId,
          reason: `document_role ${currentRole}: sólo EVIDENCE es permitido en BLIND_MACHINE_AUDIT`,
          artifactId: evidence.artifactId,
        });
      }
      continue;
    }

    const text = artifactTextMap.get(evidenceId) ?? '';
    const heuristic = humanDecisionHeuristics.find((candidate) => candidate.matches(text));
    if (heuristic) {
      if (!detectedHeuristicIds.has(heuristic.tag)) {
        detectedHeuristicIds.add(heuristic.tag);
        detectedHeuristics.push(heuristic.tag);
      }
      if (!excludedIds.has(evidenceId)) {
        excludedIds.add(evidenceId);
        excluded.push({ evidenceId, reason: `Heurística ${heuristic.tag}: posible contenido de dictamen humano`, artifactId: evidence.artifactId });
      }
      continue;
    }

    const keywordCount = POTENTIAL_HUMAN_KEYWORDS.filter((keyword) => text.toLowerCase().includes(keyword.toLowerCase())).length;
    if (keywordCount >= 2 && !excludedIds.has(evidenceId)) {
      excludedIds.add(evidenceId);
      excluded.push({ evidenceId, reason: `Al ${keywordCount} keywords de outcome humano detectadas en el texto`, artifactId: evidence.artifactId });
      continue;
    }

  }

  for (const evidence of evidences) {
    if (!excludedIds.has(evidence.evidenceId) && !allowed.includes(evidence.evidenceId)) allowed.push(evidence.evidenceId);
  }

  return { allowed, excluded, detectedHeuristics, roleSummary };
}

export type { HeuristicFn };
export type { BlindInputManifestSource, BlindFilterable };
