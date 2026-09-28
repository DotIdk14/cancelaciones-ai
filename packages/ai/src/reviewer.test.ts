import { describe, expect, test } from 'vitest';
import { runAuditReviewer } from './reviewer';
import { createFakeAiProvider, FakeOpenRouterScenario } from './fakes';
import { evalDataset } from './eval-dataset';

const assessment = evalDataset[0]!.expected;
const base = evalDataset[0]!;

describe('runAuditReviewer', () => {
  test('CONFIRMED devuelve el mismo assessment', async () => {
    const result = await runAuditReviewer({ provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_CV), model: 'fake', assessment, ...base });
    expect(result.finalAssessment).toBe(assessment);
    expect(result.review.verdict).toBe('CONFIRMED');
  });

  test('REVIEW_REJECT permite una revision', async () => {
    const revised = evalDataset[1]!.expected;
    const result = await runAuditReviewer({
      provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_REVIEW_REJECT), model: 'fake', assessment, ...base,
      reviseAssessment: async () => revised,
    });
    expect(result.rounds).toBe(2);
    expect(result.finalAssessment).toBe(revised);
  });

  test('conflicto persistente termina NEEDS_INPUT en maximo 2 rondas', async () => {
    const result = await runAuditReviewer({
      provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_REVIEW_REJECT), model: 'fake', assessment, ...base,
      maxReviewRounds: 2,
      reviseAssessment: async () => assessment,
    });
    expect(result.rounds).toBe(2);
    expect(result.finalAssessment.status).toBe('NEEDS_INPUT');
  });
});
