import type { EvidenceRef, Fact, FactProvenance } from '../contracts';
import { factDefinition } from '../facts/catalog';
import type { CanonicalFactCandidate } from './types';

export interface ValidatedCanonicalFactCandidate {
  readonly candidate: CanonicalFactCandidate;
  readonly extractionConfidence: number | null;
}

export function validateCanonicalFactCandidate(
  candidate: CanonicalFactCandidate,
): ValidatedCanonicalFactCandidate {
  const definition = definitionFor(candidate.factId);
  validateStateValue(candidate);
  validateConfidence(candidate.extractionConfidence);

  if (candidate.proposedState === 'KNOWN') {
    switch (definition.dataType) {
      case 'BOOLEAN':
        if (typeof candidate.value !== 'boolean') throw new Error(`${candidate.factId}: se esperaba booleano.`);
        break;
      case 'NUMBER':
        if (typeof candidate.value !== 'number' || !Number.isFinite(candidate.value)) {
          throw new Error(`${candidate.factId}: se esperaba número finito.`);
        }
        break;
      case 'DATE':
        if (typeof candidate.value !== 'string' || !isIsoDate(candidate.value)) {
          throw new Error(`${candidate.factId}: se esperaba fecha ISO YYYY-MM-DD.`);
        }
        break;
      case 'ENUM':
        if (!definition.domain?.includes(candidate.value)) {
          throw new Error(`${candidate.factId}: valor fuera de dominio.`);
        }
        break;
    }
  }

  return {
    candidate,
    extractionConfidence: candidate.extractionConfidence ?? null,
  };
}

export function candidateToFact(candidate: CanonicalFactCandidate): Fact {
  validateCanonicalFactCandidate(candidate);

  const evidenceRef: EvidenceRef = {
    evidenceId: candidate.evidenceId,
    kind: 'OTHER',
    label: candidate.evidenceId,
    ...(candidate.artifactHash === undefined ? {} : { hash: candidate.artifactHash }),
  };

  const provenance: FactProvenance = {
    derivation: candidate.extractionMethod === 'DERIVED' ? 'DERIVED' : 'EXTRACTED',
    evidenceId: candidate.evidenceId,
    ...(candidate.artifactId === undefined ? {} : { artifactId: candidate.artifactId }),
    ...(candidate.artifactHash === undefined ? {} : { artifactHash: candidate.artifactHash }),
    ...(candidate.page === undefined ? {} : { page: candidate.page }),
    extractionState: extractionStateFor(candidate.proposedState),
    extractionMethod: candidate.extractionMethod,
    extractorId: candidate.extractorId,
    extractorVersion: candidate.extractorVersion,
    ...(candidate.sourceText === undefined ? {} : { sourceText: candidate.sourceText }),
    ...(candidate.extractionConfidence === undefined ? {} : { extractionConfidence: candidate.extractionConfidence }),
  };

  return {
    factId: candidate.factId,
    value: candidate.proposedState === 'KNOWN' ? candidate.value : null,
    state: candidate.proposedState,
    evidenceRefs: [evidenceRef],
    provenance: [provenance],
    extractionMethod: candidate.extractionMethod,
    relevantTimestamp: candidate.relevantTimestamp ?? null,
    ...(candidate.proposedState === 'UNKNOWN'
      ? { unknownReason: `La evidencia ${candidate.evidenceId} no pudo determinar ${candidate.factId}.` }
      : {}),
  };
}

function definitionFor(factId: string) {
  try {
    return factDefinition(factId);
  } catch {
    throw new Error(`${factId}: no está en el catálogo de hechos canónicos.`);
  }
}

function validateStateValue(candidate: CanonicalFactCandidate): void {
  if (candidate.proposedState === 'KNOWN') {
    if (candidate.value === null || candidate.value === undefined) {
      throw new Error(`${candidate.factId}: KNOWN requiere value.`);
    }
    return;
  }

  if (candidate.value !== null) {
    throw new Error(`${candidate.factId}: ${candidate.proposedState} requiere value null.`);
  }
}

function validateConfidence(confidence: number | undefined): void {
  if (confidence === undefined) return;
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    throw new Error('extractionConfidence debe estar entre 0 y 1.');
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function extractionStateFor(state: CanonicalFactCandidate['proposedState']) {
  switch (state) {
    case 'KNOWN':
      return 'OBSERVED';
    case 'UNKNOWN':
      return 'UNKNOWN';
    case 'CONTRADICTED':
      return 'CONTRADICTORY';
    case 'NOT_APPLICABLE':
      return 'INFERRED';
  }
}
