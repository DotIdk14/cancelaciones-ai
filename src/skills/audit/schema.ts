import { z } from 'zod';
import { AUDIT_RESULTS } from './types.js';
import { ApiError } from '../../server/http.js';

// =============================================================================
// Schemas del Audit Skill.
// El LLM sólo emite el assessment. Metadata técnica (modelo/usage/coste) se
// agrega en servidor desde OpenRouter real; nunca desde la respuesta del modelo.
// =============================================================================

export const AiAuditAssessmentSchema = z
  .object({
    case: z.object({
      matricula: z.string().nullable(),
      studentName: z.string().nullable(),
      program: z.string().nullable(),
      cycle: z.string().nullable(),
      cycleStartDate: z.string().nullable(),
    }),

    evidenceSummary: z.array(
      z.object({
        evidenceId: z.string(),
        filename: z.string(),
        detectedType: z.string(),
        description: z.string(),
        relevant: z.boolean(),
      }),
    ),

    facts: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
        confidence: z.number().min(0).max(1),
        evidenceIds: z.array(z.string()),
        evidenceText: z.string().nullable(),
      }),
    ),

    timeline: z.array(
      z.object({
        date: z.string().nullable(),
        event: z.string(),
        evidenceIds: z.array(z.string()),
      }),
    ),

    conflicts: z.array(
      z.object({
        description: z.string(),
        evidenceIds: z.array(z.string()),
      }),
    ),

    audit: z.object({
      result: z.enum(AUDIT_RESULTS),
      rule: z.string().nullable(),
      procedureSection: z.string().nullable(),
      reasoning: z.string(),
      confidence: z.number().min(0).max(1),
      supportingEvidenceIds: z.array(z.string()),
      missingEvidence: z.array(z.string()),
      observations: z.array(z.string()),
    }),
  })
  .strict();

export const AuditResultSchema = AiAuditAssessmentSchema.extend({
  model: z.object({
    provider: z.literal('openrouter'),
    model: z.string(),
  }),
  usage: z.object({
    promptTokens: z.number().nullable(),
    completionTokens: z.number().nullable(),
    totalTokens: z.number().nullable(),
    estimatedCostUSD: z.number().nullable(),
  }),
}).strict();

export type AiAuditAssessment = z.infer<typeof AiAuditAssessmentSchema>;
export type AuditResult = z.infer<typeof AuditResultSchema>;

export function parseAiAuditAssessment(raw: unknown): AiAuditAssessment {
  return parseWithInvalidAiError(AiAuditAssessmentSchema, raw);
}

export function parseAuditResult(raw: unknown): AuditResult {
  return parseWithInvalidAiError(AuditResultSchema, raw);
}

function parseWithInvalidAiError<T>(schema: z.ZodType<T>, raw: unknown): T {
  try {
    return schema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `INVALID_AI_RESPONSE: ${details.join(' | ')}`);
    }
    throw error;
  }
}
