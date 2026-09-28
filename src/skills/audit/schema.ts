import { z } from 'zod';
import { AUDIT_RESULTS } from './types.js';
import { ApiError } from '../../server/http.js';

// =============================================================================
// Schemas del Audit Skill.
// El LLM sólo emite el assessment. Metadata técnica (modelo/usage/coste) se
// agrega en servidor desde OpenRouter real; nunca desde la respuesta del modelo.
// =============================================================================

const MissingEvidenceSchema = z.object({
  title: z.string().min(1),
  reason: z.string().min(1),
  acceptedEvidence: z.array(z.string().min(1)).min(1),
  relatedProcedureSection: z.string().min(1),
  relatedEvidenceIds: z.array(z.string().min(1)).min(1),
  blocking: z.boolean(),
}).strict();

const ProcedureCheckSchema = z.object({
  procedureSection: z.string().min(1),
  criterion: z.string().min(1),
  status: z.enum(['ACREDITADO', 'NO_ACREDITADO', 'NO_DETERMINABLE']),
  reasoning: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
  observedValues: z.array(z.object({
    label: z.string().min(1),
    value: z.string().min(1),
  }).strict()).min(1),
}).strict();

const ProvisionalResolutionSchema = z.object({
  result: z.enum(AUDIT_RESULTS).exclude(['EVIDENCIA_INSUFICIENTE']),
  rationale: z.string().min(1),
  procedureSection: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
}).strict();

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
      rule: z.string().min(1),
      procedureSection: z.string().min(1),
      auditPath: z.object({
        hypothesis: z.string().min(1),
        procedureSections: z.array(z.string().min(1)).min(1),
        reasoning: z.string().min(1),
      }).strict(),
      provisionalResolution: ProvisionalResolutionSchema.nullable(),
      reasoning: z.string(),
      confidence: z.number().min(0).max(1),
      supportingEvidenceIds: z.array(z.string()).min(1),
      missingEvidence: z.array(MissingEvidenceSchema),
      procedureChecks: z.array(ProcedureCheckSchema),
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

function validateBusinessRules(assessment: { audit: { result: string; rule: string; procedureSection: string; supportingEvidenceIds: string[]; missingEvidence: Array<{ blocking: boolean }>; procedureChecks: Array<{ evidenceIds: string[] }>; provisionalResolution: unknown } }): void {
  if (assessment.audit.rule.trim().length === 0) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.rule: debe ser un string no vacío');
  }
  if (assessment.audit.procedureSection.trim().length === 0) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.procedureSection: debe ser un string no vacío');
  }
  if (assessment.audit.supportingEvidenceIds.length === 0) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.supportingEvidenceIds: debe incluir al menos una evidencia');
  }
  if (assessment.audit.result === 'EVIDENCIA_INSUFICIENTE') {
    if (assessment.audit.provisionalResolution === null) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.provisionalResolution: EVIDENCIA_INSUFICIENTE exige una orientación provisional');
    }
    if (assessment.audit.missingEvidence.length === 0) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.missingEvidence: EVIDENCIA_INSUFICIENTE exige al menos un elemento');
    }
    if (!assessment.audit.missingEvidence.some((item) => item.blocking)) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.missingEvidence: al menos un item debe tener blocking === true');
    }
  }
  if (assessment.audit.result !== 'EVIDENCIA_INSUFICIENTE' && assessment.audit.provisionalResolution !== null) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.provisionalResolution: solo aplica a EVIDENCIA_INSUFICIENTE');
  }
  const hasBlocking = assessment.audit.missingEvidence.some((item) => item.blocking);
  if (hasBlocking && assessment.audit.result !== 'EVIDENCIA_INSUFICIENTE') {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.missingEvidence: no puede haber bloqueo cuando el resultado no es EVIDENCIA_INSUFICIENTE');
  }
  for (const check of assessment.audit.procedureChecks) {
    if (check.evidenceIds.length === 0) {
      throw new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.procedureChecks[].evidenceIds: debe incluir al menos una evidencia');
    }
  }
}

function parseWithInvalidAiError<T>(schema: z.ZodType<T>, raw: unknown): T {
  try {
    const parsed = schema.parse(raw);
    if (parsed && typeof parsed === 'object' && 'audit' in parsed) {
      validateBusinessRules(parsed as Parameters<typeof validateBusinessRules>[0]);
    }
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `INVALID_AI_RESPONSE: ${details.join(' | ')}`);
    }
    throw error;
  }
}
