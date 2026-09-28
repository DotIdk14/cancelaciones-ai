import { z } from 'zod';

/**
 * Dictamen del analista. El esquema no admite `INDETERMINADO`: si la evidencia
 * no alcanza, el único resultado permitido es NEEDS_INPUT con la lista concreta
 * de lo que falta y por qué. Un dictamen que no puede sostenerse no se emite
 * nunca; se declara incompleto.
 */
export const ASSESSMENT_CLASSIFICATIONS = [
  'CANCELACION_VENTA',
  'BAJA',
  'CANCELACION_VENTA_OPERATIVA',
  'DICTAMINACION',
] as const;
export type AssessmentClassification = (typeof ASSESSMENT_CLASSIFICATIONS)[number];

export const assessmentEvidenceRefSchema = z
  .object({
    evidenceId: z.string().min(1),
    artifactId: z.string().min(1).optional(),
    page: z.number().int().positive().optional(),
    timestampStart: z.number().nonnegative().optional(),
    timestampEnd: z.number().nonnegative().optional(),
    snippet: z.string().max(600).optional(),
  })
  .strict();

export const assessmentPolicyRefSchema = z
  .object({
    procedureVersion: z.string().min(1),
    section: z.string().min(1),
    page: z.number().int().positive().optional(),
    quote: z.string().max(600).optional(),
  })
  .strict();

export const assessmentFindingSchema = z
  .object({
    title: z.string().min(1).max(200),
    detail: z.string().min(1).max(2000),
    evidence: z.array(assessmentEvidenceRefSchema).default([]),
  })
  .strict();

export const assessmentContradictionSchema = z
  .object({
    description: z.string().min(1).max(1000),
    between: z.array(assessmentEvidenceRefSchema).min(1),
    resolution: z.string().max(1000).optional(),
  })
  .strict();

export const assessmentMissingEvidenceSchema = z
  .object({
    description: z.string().min(1).max(500),
    reason: z.string().min(1).max(1000),
    suggestedEvidence: z.string().min(1).max(300),
  })
  .strict();

export const assessmentSchema = z
  .object({
    status: z.enum(['COMPLETED', 'NEEDS_INPUT']),
    classification: z.enum(ASSESSMENT_CLASSIFICATIONS).optional(),
    summary: z.string().min(1).max(4000),
    findings: z.array(assessmentFindingSchema).max(20).default([]),
    evidenceReferences: z.array(assessmentEvidenceRefSchema).max(40).default([]),
    policyReferences: z.array(assessmentPolicyRefSchema).max(20).default([]),
    contradictions: z.array(assessmentContradictionSchema).max(10).default([]),
    missingEvidence: z.array(assessmentMissingEvidenceSchema).max(10).default([]),
    procedureVersion: z.string().min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    // NEEDS_INPUT sin explicación es exactamente el INDETERMINADO que se elimina.
    if (value.status === 'NEEDS_INPUT' && value.missingEvidence.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['missingEvidence'],
        message:
          'NEEDS_INPUT exige al menos un elemento en missingEvidence con description, reason y suggestedEvidence.',
      });
    }
    if (value.status === 'COMPLETED' && !value.classification) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['classification'],
        message: 'COMPLETED exige una classification.',
      });
    }
    if (value.status === 'NEEDS_INPUT' && value.classification) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['classification'],
        message: 'NEEDS_INPUT no puede llevar classification: no hay dictamen que clasificar.',
      });
    }
  });

export type Assessment = z.infer<typeof assessmentSchema>;
export type AssessmentEvidenceRef = z.infer<typeof assessmentEvidenceRefSchema>;
export type AssessmentPolicyRef = z.infer<typeof assessmentPolicyRefSchema>;
export type AssessmentFinding = z.infer<typeof assessmentFindingSchema>;
export type AssessmentContradiction = z.infer<typeof assessmentContradictionSchema>;
export type AssessmentMissingEvidence = z.infer<typeof assessmentMissingEvidenceSchema>;

/** Versión del prompt del analista. Cambia el dictamen aunque el esquema no cambie, así que se versiona aparte. */
export const ASSESSMENT_PROMPT_VERSION = 'analyst-assessment-v1';
