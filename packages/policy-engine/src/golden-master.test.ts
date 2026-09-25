import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { canonicalFingerprintV1 } from '@cancelaciones/domain';
import { evaluatePolicy } from './index';
import { goldenCases } from './golden-master-cases';

const expected = JSON.parse(readFileSync(new URL('./testdata/golden-master-v1.json', import.meta.url), 'utf8')) as Record<string, unknown>;

it('mantiene exactamente las claves de goldenCases en la fixture', () => {
  expect(Object.keys(expected).sort()).toEqual(goldenCases.map((testCase) => testCase.name).sort());
});

for (const testCase of goldenCases) {
  it(`bloquea comportamiento actual: ${testCase.name}`, () => {
    const actual = evaluatePolicy(testCase.input);
    expect(actual).toEqual(expected[testCase.name]);
    expect(createHash('sha256').update(canonicalFingerprintV1(testCase.input.facts)).digest('hex')).toBe(testCase.inputFingerprint);
    expect(createHash('sha256').update(canonicalFingerprintV1(actual)).digest('hex')).toBe(testCase.expectedFingerprint);
  });
}
