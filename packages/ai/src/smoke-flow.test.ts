import { describe, expect, test } from 'vitest';
import { TERMINAL_AUDIT_RUN_STATUSES } from '@cancelaciones/shared';
import { runCaseAnalyst } from './analyst';
import { runAuditReviewer } from './reviewer';
import { createFakeAiProvider, FakeOpenRouterScenario } from './fakes';
import { evalDataset } from './eval-dataset';

const base = evalDataset[0]!;

function terminalFromAssessment(status: 'COMPLETED' | 'NEEDS_INPUT'): 'COMPLETED' | 'NEEDS_INPUT' {
  return status;
}

describe('smoke AI-native end-to-end', () => {
  test.each([
    ['SUCCESS', FakeOpenRouterScenario.CASE_CV, 'COMPLETED'],
    ['NEEDS_INPUT', FakeOpenRouterScenario.CASE_NEEDS_INPUT, 'NEEDS_INPUT'],
    ['PROVIDER_FAILURE', FakeOpenRouterScenario.CASE_TOOL_FAILURE, 'NEEDS_INPUT'],
    ['PROVIDER_TIMEOUT', FakeOpenRouterScenario.CASE_TIMEOUT, 'NEEDS_INPUT'],
  ] as const)('%s termina en estado terminal accionable', async (_name, scenario, expectedStatus) => {
    const provider = createFakeAiProvider(scenario);
    const assessment = await runCaseAnalyst({
      provider,
      model: 'fake-model',
      ...base,
      maxSteps: scenario === FakeOpenRouterScenario.CASE_TIMEOUT ? 2 : undefined,
      maxToolCalls: scenario === FakeOpenRouterScenario.CASE_TIMEOUT ? 2 : undefined,
    });

    const terminal = terminalFromAssessment(assessment.status);
    expect(terminal).toBe(expectedStatus);
    expect(TERMINAL_AUDIT_RUN_STATUSES).toContain(terminal);
    if (terminal === 'NEEDS_INPUT') expect(assessment.missingEvidence.length).toBeGreaterThan(0);
  });

  test('REVIEW_REJECT no supera dos rondas y termina NEEDS_INPUT si persiste el conflicto', async () => {
    const assessment = await runCaseAnalyst({ provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_CV), model: 'fake-model', ...base });
    const result = await runAuditReviewer({
      provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_REVIEW_REJECT),
      model: 'fake-reviewer',
      assessment,
      ...base,
      maxReviewRounds: 2,
      reviseAssessment: async () => assessment,
    });

    expect(result.rounds).toBeLessThanOrEqual(2);
    expect(result.finalAssessment.status).toBe('NEEDS_INPUT');
    expect(result.finalAssessment.missingEvidence.length).toBeGreaterThan(0);
  });
});
