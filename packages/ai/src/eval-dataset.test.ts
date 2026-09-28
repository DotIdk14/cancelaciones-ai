import { describe, expect, test } from 'vitest';
import { runCaseAnalyst } from './analyst';
import { evalDataset } from './eval-dataset';
import { createFakeAiProvider, FakeOpenRouterScenario } from './fakes';

describe('eval dataset y fakes', () => {
  test('dataset tiene 8 casos con diferencias reales y cubre outcomes principales', () => {
    expect(evalDataset).toHaveLength(8);
    expect(new Set(evalDataset.map((item) => item.audit.externalCaseId))).toHaveLength(8);
    expect(new Set(evalDataset.map((item) => item.expected.status))).toEqual(new Set(['COMPLETED', 'NEEDS_INPUT']));
    expect(new Set(evalDataset.flatMap((item) => item.expected.classification ? [item.expected.classification] : []))).toEqual(new Set(['CANCELACION_VENTA', 'BAJA', 'CANCELACION_VENTA_OPERATIVA', 'DICTAMINACION']));
  });

  test('diferentes expedientes producen resultados distintos', async () => {
    const a = await runCaseAnalyst({ provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_CV), model: 'fake', ...evalDataset[0]! });
    const b = await runCaseAnalyst({ provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_BAJA), model: 'fake', ...evalDataset[1]! });
    expect(a).not.toEqual(b);
    expect(a.classification).not.toBe(b.classification);
  });
});
