import { createHash } from 'node:crypto';
import { canonicalFingerprintV1 } from '@cancelaciones/domain';
import type { StoredFact, JobArtifact } from '@cancelaciones/db';
import {
  adjudicate, evaluatePolicy, validateCandidateDecision,
  type AdjudicatedResult, type CandidateDecision, type PolicyValidation,
} from '@cancelaciones/policy-engine';
import { buildEvidenceGraph, graphStats, graphToPolicyFacts } from './evidence-graph';
import { runEvidenceInterpreter, type EvidenceInterpreterResult, type FactCandidate } from './evidence-interpreter';
import { runPolicyReasoner } from './reasoner';
import {
  assertBlindManifestComplete,
  assertBlindReferencesValid,
  blindEvidenceSanitizer,
  buildBlindInputManifest,
  filterBlindArtifactsAndFacts,
  type BlindInputManifestV1,
} from './blind-evidence-sanitizer';

export const AI_DECISION_V1 = 'AI_DECISION_V1' as const;
export const AI_DECISION_V2 = 'AI_DECISION_V2' as const;

export type AiDecisionVersion = typeof AI_DECISION_V1 | typeof AI_DECISION_V2;

export type BlindAuditFailureKind =
  | 'MODEL_ERROR'
  | 'PARSING_ERROR'
  | 'SCHEMA_INVALID'
  | 'POLICY_UNKNOWN'
  | 'POLICY_CONFLICT'
  | 'BLIND_INPUT_INVALID';

export interface SanitizationExclusion {
  evidenceId: string;
  reason: string;
  chunk?: string;
  artifactId?: string;
}

export interface BlindMachineAuditInput {
  auditId: string;
  factRunId: string;
  policyCode: string;
  policyVersion: string;
  storedFacts: StoredFact[];
  artifacts?: JobArtifact[];
  evidencesForSanitization?: { evidenceId: string; document_role?: unknown; artifactId?: string }[];
  model?: string;
  provider?: string;
}

export interface AiDecisionV1Record {
  decisionVersion: typeof AI_DECISION_V1;
  aiDecisionHash: string;
  inputFingerprint: string;
  promptVersion: string | null;
  model: string | null;
  provider: string | null;
  candidate: CandidateDecision;
  validation: PolicyValidation;
  adjudication: AdjudicatedResult;
  createdAt: string;
  exclusions: SanitizationExclusion[];
}

export interface BlindAuditFailure {
  decisionVersion: typeof AI_DECISION_V1;
  ok: false;
  kind: BlindAuditFailureKind;
  message: string;
  aiDecisionHash: string | null;
  inputFingerprint: string;
  createdAt: string;
  exclusions: SanitizationExclusion[];
}

export type BlindAuditResult = AiDecisionV1Record | BlindAuditFailure;

type CompletionFn = (input: { system: string; user: string; json: true }) => Promise<{ content: string; provider: string; model: string }>;
type InterpreterFetcher = (input: { auditId: string; artifacts: JobArtifact[]; storedFacts: StoredFact[] }) => Promise<EvidenceInterpreterResult>;

function hashOf(value: unknown): string {
  return createHash('sha256').update(canonicalFingerprintV1(value)).digest('hex');
}

function canonicalContentHash(value: unknown): string {
  return hashOf(value);
}

function compareCodePoints(left: string, right: string): number {
  let leftOffset = 0;
  let rightOffset = 0;

  while (leftOffset < left.length && rightOffset < right.length) {
    const leftCodePoint = left.codePointAt(leftOffset);
    const rightCodePoint = right.codePointAt(rightOffset);
    if (leftCodePoint !== rightCodePoint) return (leftCodePoint ?? 0) - (rightCodePoint ?? 0);
    leftOffset += leftCodePoint !== undefined && leftCodePoint > 0xffff ? 2 : 1;
    rightOffset += rightCodePoint !== undefined && rightCodePoint > 0xffff ? 2 : 1;
  }

  return left.length - right.length;
}

function sortCanonical<T>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const leftHash = canonicalContentHash(left);
    const rightHash = canonicalContentHash(right);
    if (leftHash !== rightHash) return compareCodePoints(leftHash, rightHash);
    return compareCodePoints(canonicalFingerprintV1(left), canonicalFingerprintV1(right));
  });
}

function sortArtifactsForInterpreter(artifacts: JobArtifact[]): JobArtifact[] {
  return [...artifacts].sort((left, right) => {
    const leftKey = canonicalFingerprintV1({
      evidenceId: left.evidenceId,
      contentSha256: left.contentSha256,
      result: left.result,
    });
    const rightKey = canonicalFingerprintV1({
      evidenceId: right.evidenceId,
      contentSha256: right.contentSha256,
      result: right.result,
    });
    if (leftKey !== rightKey) return compareCodePoints(leftKey, rightKey);
    return compareCodePoints(canonicalFingerprintV1(left), canonicalFingerprintV1(right));
  });
}

export function blindCanonicalInputV1(input: {
  policyCode: string;
  policyVersion: string;
  artifacts: JobArtifact[];
  storedFacts: StoredFact[];
  candidates?: FactCandidate[];
}) {
  const artifacts = sortCanonical(input.artifacts.map(({ evidenceId, contentSha256, result }) => ({
    evidenceId,
    contentSha256,
    result,
  })));
  const facts = sortCanonical(input.storedFacts.map(({ factType, value, confidence, sourceRef }) => ({
    factType,
    value,
    confidence,
    sourceRef,
  })));
  const candidates = sortCanonical((input.candidates ?? []).map(({
    factType,
    value,
    confidence,
    evidenceRefs,
    artifactRefs,
    extractionMethod,
    observedText,
    occurredAt,
    warnings,
  }) => ({
    factType,
    value,
    confidence,
    evidenceRefs: sortCanonical(evidenceRefs.map(({ evidenceId, artifactId, page }) => ({ evidenceId, artifactId, page }))),
    artifactRefs: sortCanonical(artifactRefs.map(({ artifactId, sha256, page }) => ({ artifactId, sha256, page }))),
    extractionMethod,
    observedText,
    occurredAt,
    warnings,
  })));

  return {
    policyCode: input.policyCode,
    policyVersion: input.policyVersion,
    extractorVersion: 'deterministic-v1' as const,
    artifacts,
    facts,
    candidates,
  };
}

function blindInputFingerprint(input: {
  policyCode: string;
  policyVersion: string;
  artifacts: JobArtifact[];
  storedFacts: StoredFact[];
  candidates?: FactCandidate[];
}): string {
  return hashOf(blindCanonicalInputV1(input));
}

function exclusionView(exclusions: ReturnType<typeof blindEvidenceSanitizer>['excluded']): SanitizationExclusion[] {
  return exclusions.map(({ evidenceId, reason, artifactId }) => ({ evidenceId, reason, artifactId }));
}

function blindInputFailure(
  kind: BlindAuditFailureKind,
  message: string,
  inputFingerprint: string,
  createdAt: string,
  exclusions: SanitizationExclusion[]
): BlindAuditFailure {
  return {
    decisionVersion: AI_DECISION_V1,
    ok: false,
    kind,
    message,
    aiDecisionHash: null,
    inputFingerprint,
    createdAt,
    exclusions,
  };
}

export function isBlindAuditResultV1(result: BlindAuditResult): result is AiDecisionV1Record {
  return result.decisionVersion === AI_DECISION_V1 && !('ok' in result);
}

export function isBlindAuditFailure(result: BlindAuditResult): result is BlindAuditFailure {
  return 'ok' in result && result.ok === false;
}

export async function runBlindMachineAudit(input: BlindMachineAuditInput & {
  candidateFetcher?: () => Promise<CandidateDecision>;
  interpreterFetcher?: InterpreterFetcher;
  graphFetcher?: typeof buildEvidenceGraph;
  complete?: CompletionFn;
  promptVersionOverride?: string | null;
}): Promise<BlindAuditResult> {
  const { auditId, factRunId, policyCode, policyVersion, storedFacts, artifacts, evidencesForSanitization } = input;
  const createdAt = new Date().toISOString();
  const manifest: BlindInputManifestV1 = buildBlindInputManifest(input);

  if (!evidencesForSanitization) {
    return blindInputFailure(
      'BLIND_INPUT_INVALID',
      'BLIND_MANIFEST_INCOMPLETE: evidencesForSanitization es obligatorio en modo BLIND.',
      blindInputFingerprint({ policyCode, policyVersion, artifacts: [], storedFacts: [] }),
      createdAt,
      []
    );
  }

  const artifactTextChunks = new Map<string, string[]>();
  for (const artifact of artifacts ?? []) {
    if (!artifact.evidenceId || !artifact.result || typeof artifact.result !== 'object') continue;
    const result = artifact.result as Record<string, unknown>;
    const extractedFacts = Array.isArray(result.extractedFacts) ? result.extractedFacts : [];
    const firstFact = extractedFacts.length > 0 ? String(extractedFacts[0]) : '';
    const text = typeof result.text === 'string' && result.text.trim().length > 0
      ? result.text
      : typeof result.transcript === 'string' && result.transcript.trim().length > 0
        ? result.transcript
        : firstFact;
    const chunks = artifactTextChunks.get(artifact.evidenceId) ?? [];
    chunks.push(text);
    artifactTextChunks.set(artifact.evidenceId, chunks);
  }
  const artifactTextMap = new Map<string, string>();
  for (const [evidenceId, chunks] of artifactTextChunks) artifactTextMap.set(evidenceId, chunks.join('\n'));

  const sanitizationResult = blindEvidenceSanitizer(evidencesForSanitization, artifactTextMap);
  const allowedEvidenceIds = new Set(sanitizationResult.allowed);
  try {
    assertBlindManifestComplete(manifest, allowedEvidenceIds);
    const manifestByArtifact = new Map(manifest.map((entry) => [entry.artifactId, entry.evidenceId]));
    for (const artifact of artifacts ?? []) {
      const expectedEvidence = manifestByArtifact.get(artifact.id);
      if (expectedEvidence !== undefined && allowedEvidenceIds.has(expectedEvidence) && artifact.evidenceId !== expectedEvidence) {
        throw new Error('BLIND_REFERENCE_INVALID');
      }
      if (expectedEvidence === undefined && artifact.evidenceId && allowedEvidenceIds.has(artifact.evidenceId)) {
        throw new Error('BLIND_REFERENCE_INVALID');
      }
    }
  } catch (error) {
    return blindInputFailure(
      'BLIND_INPUT_INVALID',
      error instanceof Error ? error.message : 'BLIND_MANIFEST_INCOMPLETE',
      blindInputFingerprint({ policyCode, policyVersion, artifacts: [], storedFacts: [] }),
      createdAt,
      exclusionView(sanitizationResult.excluded)
    );
  }

  const allowedArtifacts = filterBlindArtifactsAndFacts(artifacts ?? [], manifest);
  try {
    assertBlindReferencesValid({ manifest, artifacts: allowedArtifacts, storedFacts, candidates: [] });
  } catch (error) {
    return blindInputFailure(
      'BLIND_INPUT_INVALID',
      error instanceof Error ? error.message : 'BLIND_REFERENCE_INVALID',
      blindInputFingerprint({ policyCode, policyVersion, artifacts: allowedArtifacts, storedFacts: [] }),
      createdAt,
      exclusionView(sanitizationResult.excluded)
    );
  }
  const allowedStoredFacts = filterBlindArtifactsAndFacts(storedFacts, manifest);
  const graphBuilder = input.graphFetcher ?? buildEvidenceGraph;
  let extractedCandidates: FactCandidate[] = [];
  let graph: ReturnType<typeof buildEvidenceGraph>;

  if (allowedArtifacts.length > 0 && allowedStoredFacts.length === 0) {
    const interpreter = input.interpreterFetcher ?? runEvidenceInterpreter;
    const orderedAllowedArtifacts = sortArtifactsForInterpreter(allowedArtifacts);
    const interpResult = await interpreter({ auditId, artifacts: orderedAllowedArtifacts, storedFacts: [] });
    extractedCandidates = interpResult.candidates;
    const candidateFingerprint = blindInputFingerprint({ policyCode, policyVersion, artifacts: allowedArtifacts, storedFacts: [], candidates: extractedCandidates });
    try {
      assertBlindReferencesValid({ manifest, artifacts: allowedArtifacts, storedFacts: [], candidates: extractedCandidates });
    } catch (error) {
      return blindInputFailure(
        'BLIND_INPUT_INVALID',
        error instanceof Error ? error.message : 'BLIND_REFERENCE_INVALID',
        candidateFingerprint,
        createdAt,
        exclusionView(sanitizationResult.excluded)
      );
    }
    const syntheticFacts = extractedCandidates.map((candidate): StoredFact => {
      const evidenceRef = candidate.evidenceRefs[0];
      const artifactRef = candidate.artifactRefs[0];
      return {
        id: `blind_${hashOf({ factType: candidate.factType, value: candidate.value, confidence: candidate.confidence, evidenceRefs: candidate.evidenceRefs, artifactRefs: candidate.artifactRefs })}`,
        auditId,
        runId: factRunId,
        factType: candidate.factType,
        classification: 'OBSERVABLE',
        value: candidate.value,
        sourceRef: {
          evidenceId: evidenceRef?.evidenceId ?? '',
          artifactId: artifactRef?.artifactId,
          sha256: artifactRef?.sha256 ?? '',
        },
        confidence: candidate.confidence,
        createdAt: '1970-01-01T00:00:00.000Z',
      };
    });
    graph = graphBuilder({ auditId, runId: factRunId, storedFacts: syntheticFacts });
  } else {
    graph = graphBuilder({ auditId, runId: factRunId, storedFacts: allowedStoredFacts });
  }

  const inputFingerprint = blindInputFingerprint({
    policyCode,
    policyVersion,
    artifacts: allowedArtifacts,
    storedFacts: allowedStoredFacts,
    candidates: extractedCandidates,
  });

  let candidate: CandidateDecision;
  let promptVersion: string | null = input.promptVersionOverride ?? null;
  try {
    if (input.candidateFetcher) {
      candidate = await input.candidateFetcher();
    } else {
      const reasoned = await runPolicyReasoner({ graph, complete: input.complete });
      candidate = reasoned.candidate;
      promptVersion = reasoned.promptVersion;
    }
  } catch (error) {
    const kind: BlindAuditFailureKind = error && typeof error === 'object' && 'kind' in error
      ? (error as { kind: BlindAuditFailureKind }).kind
      : 'MODEL_ERROR';
    return blindInputFailure(kind, error instanceof Error ? error.message : 'El Policy Reasoner no produjo una decision candidata.', inputFingerprint, createdAt, exclusionView(sanitizationResult.excluded));
  }

  let evaluation;
  try {
    evaluation = evaluatePolicy({ policyCode, policyVersion, facts: graphToPolicyFacts(graph) });
  } catch (error) {
    return blindInputFailure('POLICY_UNKNOWN', error instanceof Error ? error.message : 'La politica no pudo evaluarse.', inputFingerprint, createdAt, exclusionView(sanitizationResult.excluded));
  }

  const validation = validateCandidateDecision({
    candidate,
    evaluation: {
      suggestedOutcome: evaluation.suggestedOutcome,
      outcomeStatus: evaluation.outcomeStatus,
      evaluatedRules: evaluation.evaluatedRules,
      rulesFingerprint: evaluation.rulesFingerprint,
      factsFingerprint: evaluation.factsFingerprint,
    },
    knownRuleIds: evaluation.evaluatedRules.map((rule) => rule.ruleId),
  });

  const adjudicated = adjudicate({
    candidate,
    validation,
    graph: graphStats(graph),
    evaluation,
  });

  const record: AiDecisionV1Record = {
    decisionVersion: AI_DECISION_V1,
    aiDecisionHash: hashOf({
      candidate: {
        ...candidate,
        ruleRefs: candidate.ruleRefs.map((rule) => ({ ...rule, justification: rule.justification.slice(0, 120) })),
      },
      validation: { verdict: validation.verdict, failures: validation.failures },
      adjudication: { probableOutcome: adjudicated.probableOutcome, status: adjudicated.status, confidence: adjudicated.confidence.value },
      promptVersion,
      model: allowedArtifacts.length > 0 ? 'artifact_fallback_mode' : (input.model ?? null),
    }),
    inputFingerprint,
    promptVersion,
    model: allowedArtifacts.length > 0 ? 'artifact_fallback_mode' : (input.model ?? null),
    provider: input.provider ?? null,
    candidate,
    validation,
    adjudication: adjudicated,
    createdAt,
    exclusions: exclusionView(sanitizationResult.excluded),
  };
  return record;
}
