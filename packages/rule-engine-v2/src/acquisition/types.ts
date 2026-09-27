import type { EvidenceKind, FactState, SourceRef } from '../contracts';

export const ACQUISITION_CATEGORIES = [
  'DIRECT_EXTRACTION',
  'DERIVED',
  'AUDIT_METADATA',
  'TEMPORAL_DERIVATION',
  'AUXILIARY_REFERENCE',
  'NOT_CURRENTLY_ACQUIRABLE',
  'OWNER_MAPPING_REQUIRED',
] as const;

export type AcquisitionCategory = (typeof ACQUISITION_CATEGORIES)[number];

export const LEGACY_MAPPING_CLASSIFICATIONS = [
  'EXACT',
  'DERIVABLE',
  'AMBIGUOUS',
  'NO_MAPPING',
] as const;

export type LegacyMappingClassification = (typeof LEGACY_MAPPING_CLASSIFICATIONS)[number];

export interface CanonicalFactAcquisitionEntry {
  readonly factId: string;
  readonly name: string;
  readonly meaning: string;
  readonly dataType: 'BOOLEAN' | 'ENUM' | 'NUMBER' | 'DATE';
  readonly expectedValueState: string;
  readonly sourceRuleIds: readonly string[];
  readonly possibleEvidenceSources: readonly EvidenceKind[];
  readonly extractionStrategy: string;
  readonly derivationStrategy: string | null;
  readonly aiExtractionPermitted: boolean;
  readonly deterministicValidationPossible: boolean;
  readonly criticalToDecisionBranch: boolean;
  readonly provenanceRequirements: string;
  readonly acquisitionCategory: AcquisitionCategory;
  readonly normativeInvariant: boolean;
  readonly undeclaredThreshold: boolean;
  readonly sourceRefs: readonly SourceRef[];
}

export interface CanonicalFactCandidate {
  readonly factId: string;
  readonly proposedState: FactState;
  readonly value: unknown;
  readonly evidenceId: string;
  readonly artifactId?: string;
  readonly artifactHash?: string;
  readonly page?: number;
  readonly sourceText?: string;
  readonly extractionMethod: 'DETERMINISTIC' | 'LLM' | 'HUMAN' | 'IMPORTED' | 'DERIVED';
  readonly extractionConfidence?: number;
  readonly extractorId: string;
  readonly extractorVersion: string;
  readonly relevantTimestamp?: string | null;
  readonly rawSupport?: unknown;
}
