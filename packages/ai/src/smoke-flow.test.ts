import { describe, expect, test } from 'vitest';
import { TERMINAL_AUDIT_RUN_STATUSES } from '@cancelaciones/shared';
import { runCaseAnalyst } from './analyst';
import { runAuditReviewer } from './reviewer';
import { createFakeAiProvider, FakeOpenRouterScenario } from './fakes';
import { evalDataset } from './eval-dataset';
import type { ToolContext } from './tools';

const base = evalDataset[0]!;
const context: ToolContext = { audit: { ...base.audit }, evidence: [...base.evidence] };

type Terminal = 'COMPLETED' | 'NEEDS_INPUT' | 'FAILED';

function assessed(result: Awaited<ReturnType<typeof runCaseAnalyst>>) {
  if (result.status === 'FAILED') throw new Error(`Falló: ${result.errorCode}`);
  return result.assessment;
}

/**
 * Smoke del ciclo completo con el protocolo real de tool calling.
 *
 * El criterio es uno solo y es el que importa: da igual cómo termine, siempre
 * cae en un estado terminal. NEEDS_INPUT solo aparece cuando el assessment lo
 * pidió; los fallos de infraestructura aparecen como FAILED.
 */
describe('smoke AI-native end-to-end', () => {
  test.each([
    ['SUCCESS', FakeOpenRouterScenario.CASE_CV, 'COMPLETED'],
    ['NEEDS_INPUT', FakeOpenRouterScenario.CASE_NEEDS_INPUT, 'NEEDS_INPUT'],
    ['PROVIDER_FAILURE', FakeOpenRouterScenario.CASE_PROVIDER_FAILURE, 'FAILED'],
    ['PROVIDER_TIMEOUT', FakeOpenRouterScenario.CASE_TIMEOUT, 'FAILED'],
  ] as const)('%s termina en estado terminal y nunca queda pendiente', async (_name, scenario, expected) => {
    const result = await runCaseAnalyst({
      provider: createFakeAiProvider(scenario),
      model: 'fake',
      context,
      maxSteps: scenario === FakeOpenRouterScenario.CASE_TIMEOUT ? 2 : undefined,
      maxToolCalls: scenario === FakeOpenRouterScenario.CASE_TIMEOUT ? 2 : undefined,
    });

    const terminal = result.status as Terminal;
    expect(TERMINAL_AUDIT_RUN_STATUSES).toContain(terminal);
    expect(terminal).toBe(expected);

    if (terminal === 'NEEDS_INPUT') {
      expect(result.status === 'NEEDS_INPUT' ? result.assessment.missingEvidence.length : 0).toBeGreaterThan(0);
    }
    if (terminal === 'FAILED') {
      expect(result).toMatchObject({ errorCode: expect.any(String) });
    }
  });

  test('REVIEW_REJECT agota dos rondas y termina NEEDS_INPUT con conflicto explicable', async () => {
    const analysis = await runCaseAnalyst({ provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_CV), model: 'fake', context });
    expect(analysis.status).toBe('COMPLETED');

    const result = await runAuditReviewer({
      provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_REVIEW_REJECT),
      model: 'fake-reviewer',
      assessment: assessed(analysis),
      context,
      maxReviewRounds: 2,
      reviseAssessment: async () => assessed(analysis),
    });

    expect(result.rounds).toBe(2);
    expect(result.status).toBe('NEEDS_INPUT');
    expect(result.finalAssessment.missingEvidence.length).toBeGreaterThan(0);
  });

  test('REVIEW_REJECT con corrección del analista y segundo veredicto confirmado', async () => {
    const analysis = await runCaseAnalyst({ provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_CV), model: 'fake', context });

    let rejectOnce = true;
    const result = await runAuditReviewer({
      provider: {
        async review() {
          const review = rejectOnce
            ? { verdict: 'REJECTED' as const, summary: 'Falta sustento', unsupportedClaims: ['classification'], missingEvidence: [], counterEvidence: [], instruction: 'Aportar evidencia.' }
            : { verdict: 'CONFIRMED' as const, summary: 'Ahora sí sustentado', unsupportedClaims: [], missingEvidence: [], counterEvidence: [] };
          rejectOnce = false;
          return { value: review };
        },
      },
      model: 'fake-reviewer',
      assessment: assessed(analysis),
      context,
      reviseAssessment: async () => assessed(analysis),
    });

    expect(result.rounds).toBe(2);
    expect(result.status).toBe('COMPLETED');
  });

  test('revisor que falla es FAILED, no NEEDS_INPUT', async () => {
    const analysis = await runCaseAnalyst({ provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_CV), model: 'fake', context });

    const result = await runAuditReviewer({
      provider: { async review() { throw new Error('OPENROUTER_HTTP_500'); } },
      model: 'fake-reviewer',
      assessment: assessed(analysis),
      context,
    });

    expect(result).toMatchObject({ status: 'FAILED', errorCode: 'REVIEWER_FAILED' });
  });
});
