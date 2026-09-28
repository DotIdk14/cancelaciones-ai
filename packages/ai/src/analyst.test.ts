import { describe, expect, test, vi } from 'vitest';
import { MAX_AGENT_STEPS, MAX_TOOL_CALLS } from '@cancelaciones/shared';
import { runCaseAnalyst, type AnalystProvider } from './analyst';
import { createFakeAiProvider, FakeOpenRouterScenario } from './fakes';
import { evalDataset } from './eval-dataset';
import type { ToolContext } from './tools';

const base = evalDataset[0]!;
const context: ToolContext = { audit: { ...base.audit }, evidence: [...base.evidence], policyRootDir: undefined };

function analyst(scenario: FakeOpenRouterScenario, overrides: Partial<Parameters<typeof runCaseAnalyst>[0]> = {}) {
  return runCaseAnalyst({ provider: createFakeAiProvider(scenario), model: 'fake', context, ...overrides });
}

/** Estrecha el resultado: si el run falló, el test no tiene assessment que inspeccionar. */
function assessed(result: Awaited<ReturnType<typeof runCaseAnalyst>>) {
  if (result.status === 'FAILED') throw new Error(`El run falló con ${result.errorCode}: ${result.errorMessage}`);
  return result.assessment;
}

describe('runCaseAnalyst', () => {
  test('cada escenario produce su outcome principal', async () => {
    await expect(analyst(FakeOpenRouterScenario.CASE_CV)).resolves.toMatchObject({ status: 'COMPLETED', assessment: { classification: 'CANCELACION_VENTA' } });
    await expect(analyst(FakeOpenRouterScenario.CASE_BAJA)).resolves.toMatchObject({ status: 'COMPLETED', assessment: { classification: 'BAJA' } });
    await expect(analyst(FakeOpenRouterScenario.CASE_OPERATIVA)).resolves.toMatchObject({ status: 'COMPLETED', assessment: { classification: 'CANCELACION_VENTA_OPERATIVA' } });
    await expect(analyst(FakeOpenRouterScenario.CASE_DICTAMINACION)).resolves.toMatchObject({ status: 'COMPLETED', assessment: { classification: 'DICTAMINACION' } });
  });

  test('NEEDS_INPUT viene del assessment y no de un fallo técnico', async () => {
    const result = await analyst(FakeOpenRouterScenario.CASE_NEEDS_INPUT);
    expect(result.status).toBe('NEEDS_INPUT');
    expect(assessed(result).missingEvidence.length).toBeGreaterThan(0);
  });

  test('MAX_AGENT_STEPS agotado es FAILED, no NEEDS_INPUT', async () => {
    const result = await analyst(FakeOpenRouterScenario.CASE_TIMEOUT, { maxSteps: 2, maxToolCalls: MAX_TOOL_CALLS });
    expect(result.status).toBe('FAILED');
    expect(result).toMatchObject({ errorCode: 'AGENT_STEP_LIMIT' });
    expect(result).not.toHaveProperty('assessment');
  });

  test('MAX_TOOL_CALLS agotado es FAILED, no NEEDS_INPUT', async () => {
    const result = await analyst(FakeOpenRouterScenario.CASE_TIMEOUT, { maxSteps: MAX_AGENT_STEPS, maxToolCalls: 1 });
    expect(result).toMatchObject({ status: 'FAILED', errorCode: 'AGENT_TOOL_LIMIT' });
  });

  test('una tool que lanza es fallo técnico, no expediente incompleto', async () => {
    const provider: AnalystProvider = {
      async generateWithTools() {
        return { content: '', toolCalls: [{ id: 'x', name: 'toolQueNoExiste', arguments: {} }] };
      },
    };
    const result = await runCaseAnalyst({ provider, model: 'fake', context });
    expect(result).toMatchObject({ status: 'FAILED', errorCode: 'UNKNOWN_TOOL' });
    expect(result).not.toHaveProperty('assessment');
  });

  test('provider que lanza termina en FAILED con su código', async () => {
    const result = await analyst(FakeOpenRouterScenario.CASE_PROVIDER_FAILURE);
    expect(result).toMatchObject({ status: 'FAILED' });
  });

  test('turno sin tool_calls no se acepta como dictamen', async () => {
    const provider: AnalystProvider = { async generateWithTools() { return { content: 'ya terminé' }; } };
    const result = await runCaseAnalyst({ provider, model: 'fake', context });
    expect(result).toMatchObject({ status: 'FAILED', errorCode: 'ASSESSMENT_NOT_SUBMITTED' });
  });

  test('envía system prompt, user inicial y las tool definitions', async () => {
    const provider = createFakeAiProvider(FakeOpenRouterScenario.CASE_CV);
    const spy = vi.spyOn(provider, 'generateWithTools');
    await runCaseAnalyst({ provider, model: 'fake', context });

    const first = spy.mock.calls[0]?.[0];
    expect(first?.system).toContain('GDM_GAM_PRD_MLG_003');
    expect(first?.system).toContain('submitAssessment');
    expect(first?.messages[0]).toMatchObject({ role: 'user' });
    expect(String((first?.messages[0] as { content: string }).content)).toContain(base.audit.id);
    expect(first?.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['listEvidence', 'readEvidence', 'searchEvidence', 'searchPolicy', 'readPolicySection', 'submitAssessment']),
    );
  });

  test('el assistant con tool_calls precede a cada role=tool', async () => {
    const provider = createFakeAiProvider(FakeOpenRouterScenario.CASE_CV);
    const spy = vi.spyOn(provider, 'generateWithTools');
    await runCaseAnalyst({ provider, model: 'fake', context });

    const second = spy.mock.calls[1]?.[0]?.messages as Array<{ role: string; tool_call_id?: string }>;
    // segundo turno: user, assistant(tool_calls), tool, tool
    expect(second[0]).toMatchObject({ role: 'user' });
    expect(second[1]).toMatchObject({ role: 'assistant' });
    expect((second[1] as { tool_calls?: unknown[] }).tool_calls).toHaveLength(2);
    expect(second[2]).toMatchObject({ role: 'tool' });
    expect(second[3]).toMatchObject({ role: 'tool' });
  });

  test('submitAssessment cierra el run sin volver a llamar al modelo', async () => {
    const provider = createFakeAiProvider(FakeOpenRouterScenario.CASE_CV);
    const spy = vi.spyOn(provider, 'generateWithTools');
    const result = await runCaseAnalyst({ provider, model: 'fake', context });
    expect(result.status).toBe('COMPLETED');
    // turno 1 investiga, turno 2 entrega: exactamente dos llamadas, la terminal incluida.
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test('NEEDS_INPUT sin missingEvidence se rechaza como assessment inválido', async () => {
    const invalid = { status: 'NEEDS_INPUT', summary: 'x', findings: [], evidenceReferences: [], policyReferences: [], contradictions: [], missingEvidence: [], procedureVersion: '5' };
    const provider: AnalystProvider = {
      async generateWithTools() {
        return { content: '', toolCalls: [{ id: 'bad', name: 'submitAssessment', arguments: { assessment: invalid } }] };
      },
    };
    await expect(runCaseAnalyst({ provider, model: 'fake', context })).rejects.toThrow();
  });

  test('acumula contadores, uso y secciones de política consultadas', async () => {
    const policyContext: ToolContext = { ...context, onToolExecution: undefined };
    const result = await runCaseAnalyst({
      provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_CV),
      model: 'fake',
      context: policyContext,
    });
    expect(result.agentStepCount).toBe(2);
    expect(result.toolCallCount).toBe(3);
    expect(result.usage.length).toBe(2);
    expect(result.policySectionsConsulted).toEqual([]);
  });

  test('registra readPolicySection en policySectionsConsulted y en la traza', async () => {
    const seen: string[] = [];
    const result = await runCaseAnalyst({
      provider: {
        async generateWithTools() {
          return { content: '', toolCalls: [{ id: 'p', name: 'readPolicySection', arguments: { sectionId: '5.2' } }] };
        },
      },
      model: 'fake',
      context: { ...context, onToolExecution: (event) => { seen.push(event.name); } },
      maxSteps: 2,
      maxToolCalls: MAX_TOOL_CALLS,
    });
    expect(result.policySectionsConsulted).toContain('5.2');
    expect(seen).toContain('readPolicySection');
    expect(result.status).toBe('FAILED');
  });

  test('readPolicySection de una sección inexistente es fallo técnico', async () => {
    const result = await runCaseAnalyst({
      provider: {
        async generateWithTools() {
          return { content: '', toolCalls: [{ id: 'p', name: 'readPolicySection', arguments: { sectionId: '99.99' } }] };
        },
      },
      model: 'fake',
      context,
      maxSteps: 2,
      maxToolCalls: MAX_TOOL_CALLS,
    });
    expect(result).toMatchObject({ status: 'FAILED', errorCode: 'TOOL_EXECUTION_FAILED' });
  });
});
