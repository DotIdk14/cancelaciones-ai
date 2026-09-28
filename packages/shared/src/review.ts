import { z } from 'zod';
import { assessmentEvidenceRefSchema, assessmentMissingEvidenceSchema } from './assessment';

/**
 * Veredicto del revisor. Un REJECTED obliga a nombrar qué afirmación no se
 * sostiene: si el revisor no puede señalar ni una, la decisión defendible es
 * CONFIRMED. Sin esa exigencia, el revisor bloquea runs sin causa trazable.
 */
export const reviewSchema = z
  .object({
    verdict: z.enum(['CONFIRMED', 'REJECTED']),
    summary: z.string().min(1).max(3000),
    counterEvidence: z.array(assessmentEvidenceRefSchema).default([]),
    unsupportedClaims: z.array(z.string().max(500)).default([]),
    missingEvidence: z.array(assessmentMissingEvidenceSchema).default([]),
    instruction: z.string().max(1500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.verdict === 'REJECTED' && value.unsupportedClaims.length === 0 && value.missingEvidence.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unsupportedClaims'],
        message:
          'REJECTED debe señalar al menos una afirmación sin sustento o evidencia faltante; si no puede señalar nada, el veredicto es CONFIRMED.',
      });
    }
  });

export type Review = z.infer<typeof reviewSchema>;

/** Versión del prompt del revisor. */
export const REVIEW_PROMPT_VERSION = 'reviewer-verdict-v1';
