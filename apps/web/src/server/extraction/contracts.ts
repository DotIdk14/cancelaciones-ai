import type { JobArtifact } from '@cancelaciones/db';
import type { ExtractedFactV1, ExtractionToolOutputV1, FactProvenanceV1 } from '@cancelaciones/domain';
import type { EvidenceReferenceEvidence } from './evidence-reference-validation';
import { z } from 'zod';

export const extractionToolArtifactInputSchema: z.ZodType<{ artifact: JobArtifact }> = z.object({
  artifact: z.object({
    id: z.string().min(1),
    jobId: z.string().min(1),
    evidenceId: z.string().min(1).nullable(),
    artifactType: z.string().min(1),
    result: z.record(z.unknown()),
    contentSha256: z.string().min(1).nullable(),
    createdAt: z.string().min(1),
  }).strict().refine((artifact) => artifact.evidenceId !== null && artifact.contentSha256 !== null),
}).strict();

export const factProvenanceSchema: z.ZodType<FactProvenanceV1> = z.object({
  evidenceId: z.string().min(1),
  artifactId: z.string().min(1).optional(),
  artifactHash: z.string().min(1).optional(),
  page: z.number().int().positive().optional(),
  startTimestamp: z.number().nonnegative().optional(),
  endTimestamp: z.number().nonnegative().optional(),
  sourceText: z.string().optional(),
  extractionMethod: z.enum(['DETERMINISTIC', 'LLM', 'HUMAN', 'IMPORTED']),
  extractorId: z.string().min(1),
  extractorVersion: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
}).strict();

const forbiddenValueFields = new Set(['outcome', 'suggestedOutcome', 'decision', 'resolution', 'ruleId', 'matchedRule', 'policyDecision']);

function addForbiddenValueIssues(value: unknown, path: (string | number)[], context: z.RefinementCtx, seen: Set<object>): void {
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    value.forEach((item, index) => addForbiddenValueIssues(item, [...path, index], context, seen));
    return;
  }

  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  for (const [key, nestedValue] of Object.entries(value)) {
    if (forbiddenValueFields.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, key],
        message: 'Forbidden normative field',
      });
    }
    addForbiddenValueIssues(nestedValue, [...path, key], context, seen);
  }
}

const extractedFactValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.unknown()),
]);

export const extractedFactSchema: z.ZodType<ExtractedFactV1> = z.object({
  factType: z.string().min(1),
  value: extractedFactValueSchema,
  state: z.enum(['OBSERVED', 'INFERRED', 'UNKNOWN', 'CONTRADICTORY']),
  confidence: z.number().min(0).max(1).optional(),
  provenance: z.array(factProvenanceSchema).min(1),
}).strict();

export const extractionToolOutputSchema: z.ZodType<ExtractionToolOutputV1> = z.object({
  facts: z.array(extractedFactSchema),
}).strict().superRefine((output, context) => {
  for (const [index, fact] of output.facts.entries()) {
    addForbiddenValueIssues(fact.value, ['facts', index, 'value'], context, new Set<object>());
  }
});

export function validExtractionConfidence(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

export interface ExtractionToolContext {
  auditId: string;
  mode: 'SHADOW' | 'BLIND';
  evidences: readonly EvidenceReferenceEvidence[];
  artifacts: readonly JobArtifact[];
  allowedEvidenceIds: readonly string[];
}

export interface ExtractionTool<TInput> {
  id: string;
  version: string;
  inputSchemaVersion: string;
  outputSchemaVersion: string;
  deterministic: boolean;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<ExtractionToolOutputV1>;
  execute(input: TInput, context: ExtractionToolContext): Promise<ExtractionToolOutputV1>;
}
