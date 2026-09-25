export type FactState = 'OBSERVED' | 'INFERRED' | 'UNKNOWN' | 'CONTRADICTORY';
export type ExtractionMethod = 'DETERMINISTIC' | 'LLM' | 'HUMAN' | 'IMPORTED';

export interface FactProvenanceV1 {
  evidenceId: string;
  artifactId?: string;
  artifactHash?: string;
  page?: number;
  startTimestamp?: number;
  endTimestamp?: number;
  sourceText?: string;
  extractionMethod: ExtractionMethod;
  extractorId: string;
  extractorVersion: string;
  confidence?: number;
}

export interface ExtractedFactV1<T = unknown> {
  factType: string;
  value: T | null;
  state: FactState;
  confidence?: number;
  provenance: FactProvenanceV1[];
}

export interface ExtractionToolOutputV1 {
  facts: ExtractedFactV1[];
}

export interface ShadowPolicyResult {
  authoritative: false;
  source: 'DECLARATIVE_SHADOW';
  evaluation: unknown;
}

const OPERATIONAL_FINGERPRINT_FIELDS = ['createdAt', 'updatedAt', 'completedAt', 'executionId', 'runId'] as const;
export const CANONICALIZATION_VERSION = 'canonicalization-v1';

export function canonicalizeV1(value: unknown): unknown {
  return canonicalizeValue(value, false);
}

export function canonicalFingerprintV1(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value, true)) ?? 'null';
}

function isOperationalFingerprintField(key: string): boolean {
  return OPERATIONAL_FINGERPRINT_FIELDS.some((field) => field === key);
}

function compareCodePoints(left: string, right: string): number {
  const leftCodePoints = Array.from(left);
  const rightCodePoints = Array.from(right);
  const commonLength = Math.min(leftCodePoints.length, rightCodePoints.length);

  for (let index = 0; index < commonLength; index += 1) {
    const leftCodePoint = leftCodePoints[index].codePointAt(0) ?? 0;
    const rightCodePoint = rightCodePoints[index].codePointAt(0) ?? 0;
    if (leftCodePoint !== rightCodePoint) return leftCodePoint - rightCodePoint;
  }

  return leftCodePoints.length - rightCodePoints.length;
}

function canonicalizeValue(value: unknown, omitOperationalFields: boolean): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeValue(entry, omitOperationalFields));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key, entry]) => entry !== undefined && !(omitOperationalFields && isOperationalFingerprintField(key)))
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([key, entry]) => [key, canonicalizeValue(entry, omitOperationalFields)]),
    );
  }

  return value;
}
