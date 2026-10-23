import { z } from 'zod';

export const FactGroundingSchema = z.object({
  factKey: z.string().min(1),
  support: z.enum(['OBSERVED', 'INFERRED', 'UNKNOWN', 'HUMAN_CONTEXT']),
  explanation: z.string().min(1),
  citations: z.array(z.object({ evidenceId: z.string().min(1), quote: z.string().trim().min(1), locator: z.string().trim().min(1) }).strict()),
}).strict();

export const DecisionSupportSchema = z.object({
  procedureSection: z.string().min(1), policyQuote: z.string().trim().min(1),
  explanation: z.string().min(1), evidenceIds: z.array(z.string().min(1)),
}).strict();

/** Metadata de la revisión efectivamente realizada; no es una probabilidad de acierto. */
export const ReliabilityReviewSchema = z.object({
  status: z.enum(['CONFIRMED', 'CORRECTED', 'NEEDS_INPUT']),
  model: z.string().min(1),
  proposalModel: z.string().min(1),
  issues: z.array(z.object({ description: z.string().min(1), evidenceIds: z.array(z.string().min(1)) }).strict()),
  factGrounding: z.array(FactGroundingSchema),
  decisionSupport: DecisionSupportSchema,
}).strict();
export type ReliabilityReview = z.infer<typeof ReliabilityReviewSchema>;
