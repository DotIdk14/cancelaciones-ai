import { assessmentSchema, MAX_REVIEW_ROUNDS, type Assessment, type Review } from '@cancelaciones/shared';

export async function runAuditReviewer(input: {
  provider: { review(input: unknown): Promise<Review> };
  model: string;
  assessment: Assessment;
  maxReviewRounds?: number;
  reviseAssessment?: (review: Review) => Promise<Assessment>;
  [key: string]: unknown;
}): Promise<{ finalAssessment: Assessment; review: Review; rounds: number }> {
  const maxRounds = input.maxReviewRounds ?? MAX_REVIEW_ROUNDS;
  let current = input.assessment;
  let lastReview = await input.provider.review({ model: input.model, assessment: current });
  let rounds = 1;
  if (lastReview.verdict === 'CONFIRMED') return { finalAssessment: current, review: lastReview, rounds };

  if (input.reviseAssessment && rounds < maxRounds) {
    current = await input.reviseAssessment(lastReview);
    assessmentSchema.parse(current);
    rounds += 1;
    lastReview = await input.provider.review({ model: input.model, assessment: current, previousReview: lastReview });
    if (lastReview.verdict === 'CONFIRMED') return { finalAssessment: current, review: lastReview, rounds };
    if (current !== input.assessment) return { finalAssessment: current, review: lastReview, rounds };
  }

  return { finalAssessment: needsInput(lastReview), review: lastReview, rounds };
}

function needsInput(review: Review): Assessment {
  return assessmentSchema.parse({
    status: 'NEEDS_INPUT',
    summary: 'El revisor mantiene conflicto con el dictamen y requiere intervencion.',
    findings: [],
    evidenceReferences: [],
    policyReferences: [],
    contradictions: [],
    missingEvidence: review.missingEvidence.length > 0 ? review.missingEvidence : [{ description: 'Conflicto persistente de revision', reason: review.summary, suggestedEvidence: review.instruction ?? 'Revision humana del expediente.' }],
    procedureVersion: '5',
  });
}
