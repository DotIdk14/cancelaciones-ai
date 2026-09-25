import {
  canonicalFingerprintV1,
  type ShadowPolicyResult,
} from '@cancelaciones/domain';

export interface ShadowPolicyEngine {
  readonly id: string;
  readonly version: string;
  evaluate(input: unknown): Promise<ShadowPolicyResult>;
}

export interface NonAuthoritativeShadowComparison {
  readonly official: unknown;
  readonly shadow: ShadowPolicyResult;
  readonly matches: boolean;
}

export interface NonAuthoritativeShadowRunner {
  readonly authoritative: false;
  compare(input: { official: unknown; shadowInput: unknown }): Promise<NonAuthoritativeShadowComparison>;
}

export function createNonAuthoritativeShadowRunner(engine: ShadowPolicyEngine): NonAuthoritativeShadowRunner {
  return Object.freeze({
    authoritative: false as const,
    compare: async (input: { official: unknown; shadowInput: unknown }): Promise<NonAuthoritativeShadowComparison> => {
      const result = await engine.evaluate(input.shadowInput);
      const shadow: ShadowPolicyResult = {
        authoritative: false,
        source: 'DECLARATIVE_SHADOW',
        evaluation: result.evaluation,
      };
      return {
        official: input.official,
        shadow,
        matches: canonicalFingerprintV1(input.official) === canonicalFingerprintV1(shadow.evaluation),
      };
    },
  });
}
