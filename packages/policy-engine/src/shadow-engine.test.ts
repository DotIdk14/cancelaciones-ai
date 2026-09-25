import { describe, expect, it, vi } from 'vitest';
import type { ShadowPolicyResult } from '@cancelaciones/domain';
import {
  createNonAuthoritativeShadowRunner,
  type ShadowPolicyEngine,
} from './shadow-engine';

function shadowEngine(evaluate: ShadowPolicyEngine['evaluate']): ShadowPolicyEngine {
  return {
    id: 'declarative-shadow',
    version: '1.0.0',
    evaluate,
  };
}

describe('non-authoritative shadow boundary', () => {
  it('no expone una API de persistencia oficial', () => {
    const runner = createNonAuthoritativeShadowRunner(shadowEngine(async () => ({
      authoritative: false,
      source: 'DECLARATIVE_SHADOW',
      evaluation: { outcome: null },
    })));
    expect(runner.authoritative).toBe(false);
    expect('persist' in runner).toBe(false);
    expect('write' in runner).toBe(false);
    expect('databaseClient' in runner).toBe(false);
    expect('serializer' in runner).toBe(false);
  });

  it('define ShadowPolicyEngine con solamente id, version y evaluate', () => {
    const engine: ShadowPolicyEngine = shadowEngine(vi.fn(async (_input: unknown): Promise<ShadowPolicyResult> => ({
      authoritative: false,
      source: 'DECLARATIVE_SHADOW',
      evaluation: { suggestedOutcome: 'CANCELACION_VENTA' },
    })));

    expect(Object.keys(engine)).toEqual(['id', 'version', 'evaluate']);
  });

  it('compara el resultado oficial y shadow sólo en memoria', async () => {
    const evaluate = vi.fn(async (_input: unknown): Promise<ShadowPolicyResult> => ({
      authoritative: false,
      source: 'DECLARATIVE_SHADOW',
      evaluation: { suggestedOutcome: 'CANCELACION_VENTA' },
    }));
    const runner = createNonAuthoritativeShadowRunner(shadowEngine(evaluate));
    const shadowInput = { facts: [{ id: 'fact-1' }] };

    const comparison = await runner.compare({
      official: { suggestedOutcome: 'BAJA' },
      shadowInput,
    });

    expect(evaluate).toHaveBeenCalledWith(shadowInput);
    expect(comparison.official).toEqual({ suggestedOutcome: 'BAJA' });
    expect(comparison.shadow).toEqual({
      authoritative: false,
      source: 'DECLARATIVE_SHADOW',
      evaluation: { suggestedOutcome: 'CANCELACION_VENTA' },
    });
    expect(comparison.matches).toBe(false);
  });

  it('fuerza authoritative false y source DECLARATIVE_SHADOW en el resultado', async () => {
    const runner = createNonAuthoritativeShadowRunner(shadowEngine(async () => ({
      authoritative: false,
      source: 'DECLARATIVE_SHADOW',
      evaluation: { outcome: null },
    })));

    const comparison = await runner.compare({ official: { outcome: null }, shadowInput: {} });

    expect(comparison.matches).toBe(true);
    expect(comparison.shadow.authoritative).toBe(false);
    expect(comparison.shadow.source).toBe('DECLARATIVE_SHADOW');
  });
});
