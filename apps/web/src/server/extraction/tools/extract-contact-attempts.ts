import type { JobArtifact } from '@cancelaciones/db';
import type { ExtractedFactV1, ExtractionToolOutputV1, FactProvenanceV1 } from '@cancelaciones/domain';
import type { ExtractionTool } from '../contracts';
import { extractionToolArtifactInputSchema, extractionToolOutputSchema, validExtractionConfidence } from '../contracts';
import { validateExtractionArtifactInput, validateExtractionToolOutputReferences } from '../evidence-reference-validation';
import { extractFactsFromArtifacts } from '../../facts/extract';

const CONTACT_FACT_TYPES = new Set(['contact.callAttempts', 'contact.writtenInteractions']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasObservedCount(value: unknown): boolean {
  if (typeof value === 'number' && Number.isFinite(value)) return true;
  if (typeof value === 'string' && /^\d+$/.test(value)) return true;
  if (!isRecord(value)) return false;
  const observedCount = value.observedCount;
  return typeof observedCount === 'number' || (typeof observedCount === 'string' && /^\d+$/.test(observedCount));
}

function hasEvents(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return isRecord(value) && Array.isArray(value.events) && value.events.length > 0;
}

function sourceMatchesArtifact(sourceRef: Record<string, unknown>, artifact: JobArtifact): boolean {
  return sourceRef.evidenceId === artifact.evidenceId
    && sourceRef.artifactId === artifact.id
    && sourceRef.sha256 === artifact.contentSha256;
}

export const extractContactAttemptsTool: ExtractionTool<{ artifact: JobArtifact }> = {
  id: 'extract_contact_attempts',
  version: '1.0.0',
  inputSchemaVersion: '1.0.0',
  outputSchemaVersion: '1.0.0',
  deterministic: true,
  inputSchema: extractionToolArtifactInputSchema,
  outputSchema: extractionToolOutputSchema,
  async execute({ artifact }, context): Promise<ExtractionToolOutputV1> {
    validateExtractionArtifactInput(artifact, context);
    const extracted = extractFactsFromArtifacts({ auditId: context.auditId, runId: 'shadow', artifacts: [artifact] });
    const facts: ExtractedFactV1[] = [];

    for (const fact of extracted) {
      if (!CONTACT_FACT_TYPES.has(fact.factType)) continue;
      if (!sourceMatchesArtifact(fact.sourceRef, artifact)) throw new Error('EXTRACTION_REFERENCE_INVALID');
      const confidence = validExtractionConfidence(fact.confidence);
      const rawValue = Array.isArray(artifact.result.extractedFacts)
        ? artifact.result.extractedFacts.find((candidate) => isRecord(candidate) && candidate.factType === fact.factType)
        : undefined;
      const observed = !isRecord(rawValue) ? undefined : rawValue.value;
      const noEvidenceOfContact = !hasEvents(fact.value) && !hasObservedCount(observed);
      const value = noEvidenceOfContact && isRecord(fact.value)
        ? { ...fact.value, sourceCompleteness: 'UNKNOWN' }
        : fact.value;
      const provenance: FactProvenanceV1 = {
        evidenceId: artifact.evidenceId as string,
        artifactId: artifact.id,
        artifactHash: artifact.contentSha256 as string,
        extractionMethod: 'DETERMINISTIC',
        extractorId: 'extract_contact_attempts',
        extractorVersion: '1.0.0',
        ...(confidence === undefined ? {} : { confidence }),
      };
      facts.push({
        factType: fact.factType,
        value,
        state: noEvidenceOfContact ? 'UNKNOWN' : 'OBSERVED',
        ...(confidence === undefined ? {} : { confidence }),
        provenance: [provenance],
      });
    }

    const output = { facts };
    validateExtractionToolOutputReferences(output, context);
    return output;
  },
};
