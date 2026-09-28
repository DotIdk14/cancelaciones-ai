import { describe, expect, test } from 'vitest';
import { MAX_AGENT_STEPS, MAX_TOOL_CALLS } from '@cancelaciones/shared';
import { runCaseAnalyst } from './analyst';
import { createFakeAiProvider, FakeOpenRouterScenario } from './fakes';
import { evalDataset } from './eval-dataset';

const base = evalDataset[0]!;

describe('runCaseAnalyst', () => {
  test('escenarios fake producen outcomes principales', async () => {
    await expect(runCaseAnalyst({ provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_CV), model: 'fake', ...base })).resolves.toMatchObject({ status: 'COMPLETED', classification: 'CANCELACION_VENTA' });
    await expect(runCaseAnalyst({ provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_BAJA), model: 'fake', ...base })).resolves.toMatchObject({ status: 'COMPLETED', classification: 'BAJA' });
    await expect(runCaseAnalyst({ provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_OPERATIVA), model: 'fake', ...base })).resolves.toMatchObject({ status: 'COMPLETED', classification: 'CANCELACION_VENTA_OPERATIVA' });
    await expect(runCaseAnalyst({ provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_DICTAMINACION), model: 'fake', ...base })).resolves.toMatchObject({ status: 'COMPLETED', classification: 'DICTAMINACION' });
    await expect(runCaseAnalyst({ provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_NEEDS_INPUT), model: 'fake', ...base })).resolves.toMatchObject({ status: 'NEEDS_INPUT' });
  });

  test('no supera MAX_AGENT_STEPS ni MAX_TOOL_CALLS', async () => {
    const provider = createFakeAiProvider(FakeOpenRouterScenario.CASE_TIMEOUT);
    const result = await runCaseAnalyst({ provider, model: 'fake', ...base, maxSteps: MAX_AGENT_STEPS, maxToolCalls: MAX_TOOL_CALLS });
    expect(result.status).toBe('NEEDS_INPUT');
    expect(provider.toolCallCount).toBeLessThanOrEqual(MAX_TOOL_CALLS);
    expect(provider.stepCount).toBeLessThanOrEqual(MAX_AGENT_STEPS);
  });

  test('TOOL_FAILURE produce NEEDS_INPUT accionable', async () => {
    const result = await runCaseAnalyst({ provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_TOOL_FAILURE), model: 'fake', ...base });
    expect(result.status).toBe('NEEDS_INPUT');
    expect(result.missingEvidence[0]?.reason).toContain('tool');
  });
});
