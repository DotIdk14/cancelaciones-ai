import type { JobArtifact } from '@cancelaciones/db';
import type { ExtractedFactV1, ExtractionToolOutputV1, FactProvenanceV1 } from '@cancelaciones/domain';
import type { ExtractionTool } from '../contracts';
import { extractionToolArtifactInputSchema, extractionToolOutputSchema, validExtractionConfidence } from '../contracts';
import { validateExtractionArtifactInput, validateExtractionToolOutputReferences } from '../evidence-reference-validation';
import { z } from 'zod';

const isoDateTimeSchema = z.string().datetime({ offset: true });
const isoDateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return false;
  return isoDateTimeSchema.safeParse(value).success || isoDateOnlySchema.safeParse(value).success;
}

export const extractDatesTool: ExtractionTool<{ artifact: JobArtifact }> = {
  id: 'extract_dates',
  version: '1.0.0',
  inputSchemaVersion: '1.0.0',
  outputSchemaVersion: '1.0.0',
  deterministic: true,
  inputSchema: extractionToolArtifactInputSchema,
  outputSchema: extractionToolOutputSchema,
  async execute({ artifact }, context): Promise<ExtractionToolOutputV1> {
    validateExtractionArtifactInput(artifact, context);
    const evidenceId = artifact.evidenceId;
    const artifactHash = artifact.contentSha256;
    if (!evidenceId || !artifactHash) throw new Error('EXTRACTION_REFERENCE_INCOMPLETE');
    const extractedFacts = Array.isArray(artifact.result.extractedFacts) ? artifact.result.extractedFacts : [];
    const facts: ExtractedFactV1[] = [];

    for (const extracted of extractedFacts) {
      if (!extracted || typeof extracted !== 'object') continue;
      const candidate = extracted as { factType?: unknown; value?: unknown; confidence?: unknown };
      if (candidate.factType !== 'evidence.date' && candidate.factType !== 'date') continue;
      if (!isIsoDate(candidate.value)) continue;

      const confidence = validExtractionConfidence(candidate.confidence);
      const provenance: FactProvenanceV1 = {
        evidenceId,
        artifactId: artifact.id,
        artifactHash,
        extractionMethod: 'DETERMINISTIC',
        extractorId: 'extract_dates',
        extractorVersion: '1.0.0',
        ...(confidence === undefined ? {} : { confidence }),
      };
      facts.push({
        factType: candidate.factType,
        value: candidate.value,
        state: 'OBSERVED',
        ...(confidence === undefined ? {} : { confidence }),
        provenance: [provenance],
      });
    }

    const output = { facts };
    validateExtractionToolOutputReferences(output, context);
    return output;
  },
};
