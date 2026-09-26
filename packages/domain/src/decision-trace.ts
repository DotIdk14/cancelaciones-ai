/**
 * Contrato del Decision Trace.
 *
 * Separación deliberada en dos bloques:
 *  - `normative` es la autoridad. Nunca se relaja para forzar un cierre.
 *  - `estimate` acompaña al resultado probable. Nunca se disfraza de dictamen.
 *
 * Invariante: cuando `normative.status === 'DETERMINED'`, `estimate` DEBE ser
 * `null`. Así es imposible que una estimación se lea como un dictamen, porque
 * los dos campos viven en bloques distintos y el motor es la autoridad.
 */
import type { Outcome, OutcomeStatus } from './policy-outcome';

export type ConfidenceLevel = 'ALTA' | 'MEDIA' | 'BAJA';
export type HumanReviewFlag = 'REQUIRED' | 'RECOMMENDED' | 'NOT_REQUIRED';

export interface PolicyBlock {
  code: string;
  version: string;
  rulesFingerprint: string;
  factsFingerprint: string;
}

export interface BlockingRuleTrace {
  ruleId: string;
  missingFacts: string[];
}

export interface NormativeBlock {
  status: OutcomeStatus;
  resolution: Outcome | null;
  decisiveRules: string[];
  blockingRules: BlockingRuleTrace[];
  conflicts: unknown[];
  softwareCoverageGaps: string[];
}

export interface ConfidenceBasis {
  ruleSupport: number;
  graphConsistency: number;
  sourceCoverage: number;
  factConfidence: number;
  evidenceCoverage: number;
}

export interface EstimateBlock {
  resolution: Outcome;
  /** Distribución sobre los outcomes reales del motor. Suma 1. */
  alternatives: Partial<Record<Outcome, number>>;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  basis: ConfidenceBasis;
  rationale: string[];
  missingEvidence: string[];
  humanReview: HumanReviewFlag;
}

export interface DecisionTrace {
  auditId: string;
  generatedAt: string;
  policy: PolicyBlock;
  normative: NormativeBlock;
  /**
   * Resultado probable. `null` cuando el procedimiento cerró normativamente:
   * en ese caso no hay nada que estimar y no se emite probabilidad.
   */
  estimate: EstimateBlock | null;
  explanation: string;
}
