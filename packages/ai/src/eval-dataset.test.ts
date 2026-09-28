import { describe, expect, test } from 'vitest';
import { runCaseAnalyst } from './analyst';
import { runAuditReviewer } from './reviewer';
import { evalDataset } from './eval-dataset';
import { createFakeAiProvider, FakeOpenRouterScenario } from './fakes';
import type { ToolContext } from './tools';

function assessed(result: Awaited<ReturnType<typeof runCaseAnalyst>>) {
  if (result.status === 'FAILED') throw new Error(`Falló: ${result.errorCode}`);
  return result.assessment;
}

describe('eval dataset', () => {
  test('tiene 8 casos distintos y cubre todas las salidas principales', () => {
    expect(evalDataset).toHaveLength(8);
    expect(new Set(evalDataset.map((item) => item.audit.externalCaseId)).size).toBe(8);
    expect(new Set(evalDataset.map((item) => item.expected.status))).toEqual(new Set(['COMPLETED', 'NEEDS_INPUT']));
    expect(
      new Set(evalDataset.flatMap((item) => (item.expected.classification ? [item.expected.classification] : []))),
    ).toEqual(new Set(['CANCELACION_VENTA', 'BAJA', 'CANCELACION_VENTA_OPERATIVA', 'DICTAMINACION']));
  });

  test('los expedientes no son el mismo fixture con nombres distintos', () => {
    const firmas = new Set(evalDataset.map((item) => item.evidence.map((e) => e.text).join('|')));
    expect(firmas.size).toBeGreaterThan(4);
  });

  test('expedientes distintos producen clasificaciones distintas', async () => {
    const cv = await runCaseAnalyst({
      provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_CV),
      model: 'fake',
      context: { audit: { ...evalDataset[0]!.audit }, evidence: [...evalDataset[0]!.evidence] },
    });
    const baja = await runCaseAnalyst({
      provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_BAJA),
      model: 'fake',
      context: { audit: { ...evalDataset[1]!.audit }, evidence: [...evalDataset[1]!.evidence] },
    });

    expect(assessed(cv).classification).toBe('CANCELACION_VENTA');
    expect(assessed(baja).classification).toBe('BAJA');
    expect(assessed(cv).summary).not.toBe(assessed(baja).summary);
  });

  test('cada outcome del dataset sobrevive al ciclo analyst + reviewer', async () => {
    for (const [index, scenario] of [
      [0, FakeOpenRouterScenario.CASE_CV],
      [1, FakeOpenRouterScenario.CASE_BAJA],
      [2, FakeOpenRouterScenario.CASE_OPERATIVA],
      [3, FakeOpenRouterScenario.CASE_DICTAMINACION],
      [4, FakeOpenRouterScenario.CASE_NEEDS_INPUT],
    ] as const) {
      const item = evalDataset[index]!;
      const context: ToolContext = { audit: { ...item.audit }, evidence: [...item.evidence] };
      const analysis = await runCaseAnalyst({ provider: createFakeAiProvider(scenario), model: 'fake', context });
      expect(analysis.status).toBe(item.expected.status);

      if (analysis.status === 'FAILED') continue;
      const reviewed = await runAuditReviewer({
        provider: createFakeAiProvider(scenario),
        model: 'fake-reviewer',
        assessment: assessed(analysis),
        context,
      });
      expect(reviewed.status).toBe(item.expected.status);
    }
  });
});
