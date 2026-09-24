import { createHash } from 'node:crypto';
import { stableFingerprint } from '@cancelaciones/domain';
import type { StoredFact, JobArtifact } from '@cancelaciones/db';
import type { EvidenceInterpreterResult, FactCandidate } from './evidence-interpreter';
import {
  adjudicate, evaluatePolicy, validateCandidateDecision,
  type AdjudicatedResult, type CandidateDecision, type PolicyValidation,
} from '@cancelaciones/policy-engine';
import { buildEvidenceGraph, graphStats, graphToPolicyFacts } from './evidence-graph';
import { runEvidenceInterpreter } from './evidence-interpreter';
import { runPolicyReasoner } from './reasoner';
import { blindEvidenceSanitizer } from './blind-evidence-sanitizer';

export const AI_DECISION_V1 = 'AI_DECISION_V1' as const;
export const AI_DECISION_V2 = 'AI_DECISION_V2' as const;

export type AiDecisionVersion = typeof AI_DECISION_V1 | typeof AI_DECISION_V2;

export type BlindAuditFailureKind =
  | 'MODEL_ERROR'
  | 'PARSING_ERROR'
  | 'SCHEMA_INVALID'
  | 'POLICY_UNKNOWN'
  | 'POLICY_CONFLICT';

export interface SanitizationExclusion {
  evidenceId: string;
  reason: string;
  chunk?: string;
  artifactId?: string;
}

/** Entrada del circuito BLIND_MACHINE_AUDIT. */
export interface BlindMachineAuditInput {
  auditId: string;
  factRunId: string;
  policyCode: string;
  policyVersion: string;
  /** Hechos almacenados (desde corridas previas). */
  storedFacts: StoredFact[];
  /** Artifacts raw para fallback cuando storedFacts son insuficientes. */
  artifacts?: JobArtifact[];
  /** Evidencias con document_role para sanitización ciega (opcional). */
  evidencesForSanitization?: { evidenceId: string; document_role: string; artifactId?: string }[];
  /** Modelo a usar para el Policy Reasoner (opcional, usa default si no se provee). */
  model?: string;
  /** Proveedor a usar para el Policy Reasoner (opcional, usa default si no se provee). */
  provider?: string;
}

/** Resultado de la auditoría a ciegas (éxito V1). */
export interface AiDecisionV1Record {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  decisionVersion: typeof AI_DECISION_V1;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  aiDecisionHash: string;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  inputFingerprint: string;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  promptVersion: string | null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  model: string | null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  provider: string | null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  candidate: CandidateDecision;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  validation: PolicyValidation;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  adjudication: AdjudicatedResult;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  createdAt: string;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  exclusions: SanitizationExclusion[];
}

/** Resultado de auditoría a ciegas (fallo). */
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

/** Resultado de auditoría a ciegas (éxito o fallo). */
export type BlindAuditResult = AiDecisionV1Record | BlindAuditFailure;

type CompletionFn = (input: { system: string; user: string; json: true }) => Promise<{ content: string; provider: string; model: string }>;

function hashOf(value: unknown): string {
  return createHash('sha256').update(stableFingerprint(value)).digest('hex');
}

function sanitizedFactFingerprint(facts: StoredFact[]) {
  return facts.map((fact) => ({
    id: fact.id,
    factType: fact.factType,
    value: fact.value,
    confidence: fact.confidence,
    createdAt: fact.createdAt,
    sourceRef: {
      evidenceId: typeof fact.sourceRef.evidenceId === 'string' ? fact.sourceRef.evidenceId : '',
      artifactId: typeof fact.sourceRef.artifactId === 'string' ? fact.sourceRef.artifactId : undefined,
      sha256: typeof fact.sourceRef.sha256 === 'string' ? fact.sourceRef.sha256 : undefined,
      page: typeof fact.sourceRef.page === 'number' ? fact.sourceRef.page : undefined,
      timestampStart: typeof fact.sourceRef.timestampStart === 'number' ? fact.sourceRef.timestampStart : undefined,
      timestampEnd: typeof fact.sourceRef.timestampEnd === 'number' ? fact.sourceRef.timestampEnd : undefined,
    },
  }));
}

export function isBlindAuditResultV1(result: BlindAuditResult): result is AiDecisionV1Record {
  return result.decisionVersion === AI_DECISION_V1;
}

export function isBlindAuditFailure(result: BlindAuditResult): result is BlindAuditFailure {
  return 'ok' in result && result.ok === false;
}

/** Ejecuta la auditoría máquina a ciegas (BLIND_MACHINE_AUDIT). */
export async function runBlindMachineAudit(input: BlindMachineAuditInput & {
  candidateFetcher?: () => Promise<CandidateDecision>;
  complete?: CompletionFn;
  promptVersionOverride?: string | null;
}): Promise<BlindAuditResult> {
  const { auditId, factRunId, policyCode, policyVersion, storedFacts, artifacts, evidencesForSanitization } = input;
  const createdAt = new Date().toISOString();

  // ---------- PASO 1: Sanitización ciega ----------
  let sanitizationResult: ReturnType<typeof blindEvidenceSanitizer> | null = null;
  if (evidencesForSanitization) {
    const artifactTextMap = new Map<string, string>();
    if (artifacts) {
      for (const art of artifacts) {
        let txt = '';
        if (art.result && typeof art.result === 'object') {
          const r = art.result as Record<string, unknown>;
          const ef = r.extractedFacts;
          const firstFact = ef && Array.isArray(ef) && ef.length > 0 ? ef[0] : undefined;
          const textVal = typeof r.text === 'string' ? r.text : '';
          const transcriptVal = typeof r.transcript === 'string' ? r.transcript : '';
          const firstFactStr = firstFact !== undefined ? String(firstFact) : '';
          txt = textVal || transcriptVal || firstFactStr || '';
        }
        artifactTextMap.set(art.id, txt);
      }
    }
    sanitizationResult = blindEvidenceSanitizer(evidencesForSanitization, artifactTextMap);
  }

  // ---------- PASO 2: Construir grafo de evidencia ----------
  let graph: ReturnType<typeof buildEvidenceGraph>;
  let inputFingerprint: string;

  if (artifacts && artifacts.length > 0 && (!storedFacts || storedFacts.length === 0)) {
    // Modo blind puro: solo artifacts, sin storedFacts previos
    const interpResult = await runEvidenceInterpreter({
      auditId,
      artifacts,
      storedFacts: [],
    });
    // Convertir FactCandidate a storedFacts sintéticos para buildEvidenceGraph
    const syntheticFacts = interpResult.candidates.map((c): StoredFact => ({
      id: `cand_${c.factType}_${Date.now()}`,
      auditId,
      runId: factRunId,
      factType: c.factType,
      classification: 'OBSERVABLE',
      value: c.value,
      sourceRef: { evidenceId: c.evidenceRefs[0]?.evidenceId || '', artifactId: c.artifactRefs[0]?.artifactId || undefined, sha256: '' },
      confidence: c.confidence,
      createdAt: new Date().toISOString(),
    }));
    graph = buildEvidenceGraph({ auditId, runId: factRunId, storedFacts: syntheticFacts });
    inputFingerprint = stableFingerprint({
      runId: factRunId,
      resolvedFacts: sanitizedFactFingerprint(syntheticFacts),
      conflicts: interpResult.fallbacks.map((f) => ({ factType: f.factType, reason: f.reason })),
    });
  } else {
    // Modo normal: storedFacts + fallback opcional a artifacts
    graph = buildEvidenceGraph({ auditId, runId: factRunId, storedFacts });
    inputFingerprint = stableFingerprint({
      runId: factRunId,
      resolvedFacts: sanitizedFactFingerprint(graph.resolvedFacts),
      conflicts: graph.conflicts.map((conflict) => ({ factType: conflict.factType, reason: conflict.reason })),
    });
  }

  // ---------- PASO 3: Policy Reasoner (IA) ----------
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
    const exs = sanitizationResult?.excluded.map((e) => ({ evidenceId: e.evidenceId, reason: e.reason, artifactId: e.artifactId })) ?? [];
    return {
      decisionVersion: AI_DECISION_V1,
      ok: false,
      kind,
      message: error instanceof Error ? error.message : 'El Policy Reasoner no produjo una decision candidata.',
      aiDecisionHash: null,
      inputFingerprint,
      createdAt,
      exclusions: exs,
    };
  }

  // ---------- PASO 4: Rule Engine validador ----------
  let evaluation;
  try {
    evaluation = evaluatePolicy({
      policyCode: policyCode,
      policyVersion: policyVersion,
      facts: graphToPolicyFacts(graph),
    });
  } catch (error) {
    const exs = sanitizationResult?.excluded.map((e) => ({ evidenceId: e.evidenceId, reason: e.reason, artifactId: e.artifactId })) ?? [];
    return {
      decisionVersion: AI_DECISION_V1,
      ok: false,
      kind: 'POLICY_UNKNOWN',
      message: error instanceof Error ? error.message : 'La politica no pudo evaluarse.',
      aiDecisionHash: null,
      inputFingerprint,
      createdAt,
      exclusions: exs,
    };
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

  // ---------- PASO 5: Adjudicator ----------
  const adjudicated = adjudicate({
    candidate,
    validation,
    graph: graphStats(graph),
    evaluation,
  });

  // ---------- PASO 6: Construir registro AI_DECISION_V1 ----------
  const allExclusions = sanitizationResult?.excluded.map((e) => ({ evidenceId: e.evidenceId, reason: e.reason, artifactId: e.artifactId })) ?? [];

  const record: AiDecisionV1Record = {
    decisionVersion: AI_DECISION_V1,
    aiDecisionHash: hashOf({
      candidate: {
        ...candidate,
        ruleRefs: candidate.ruleRefs.map((r) => ({ ...r, justification: r.justification.slice(0, 120) })),
      },
      validation: { verdict: validation.verdict, failures: validation.failures },
      adjudication: { probableOutcome: adjudicated.probableOutcome, status: adjudicated.status, confidence: adjudicated.confidence.value },
      promptVersion,
      model: artifacts ? 'artifact_fallback_mode' : (input.model ?? null),
    }),
    inputFingerprint,
    promptVersion,
    model: artifacts ? 'artifact_fallback_mode' : (input.model ?? null),
    provider: input.provider ?? null,
    candidate,
    validation,
    adjudication: adjudicated,
    createdAt,
    exclusions: allExclusions,
  };
  return record;
}