import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { canonicalFingerprintV1 } from '@cancelaciones/domain';
import { evaluatePolicy } from './index';
import { goldenCases } from './golden-master-cases';

const expected = JSON.parse(readFileSync(new URL('./testdata/golden-master-v1.json', import.meta.url), 'utf8')) as Record<string, unknown>;

/**
 * SHA-256 del fichero `testdata/golden-master-v1.json`, canonizado a LF.
 *
 * POR QUÉ EXISTE ESTA ASERCIÓN: el resto del fichero compara el objeto YA
 * PARSEADO (`toEqual`). Una edición que sólo cambie el espaciado, el orden de las
 * claves o un salto de línea del JSON deja el objeto parseado idéntico, así que
 * `toEqual` seguiría pasando y el cambio sería invisible. El hash de fichero sí
 * lo detecta. Documenta ese hueco desde docs/testing/golden-master.md §4.2.
 *
 * POR QUÉ SE NORMALIZA A LF Y NO SE HASHEA EL FICHERO EN CRUDO: este repositorio
 * tiene `core.autocrlf=true`, así que en Windows el fichero en disco tiene
 * terminadores CRLF y su hash crudo es DISTINTO del valor canónico
 * (`51ca6b08…d210`). Asertar el hash crudo daría un test que falla en Windows y
 * pasa en Linux: un test dependiente de la plataforma, que es peor que no
 * tenerlo. El valor canónico es el de los bytes que Git guarda, y por eso se
 * normaliza CRLF→LF antes de hashear.
 */
const GOLDEN_MASTER_FIXTURE_SHA256_LF = '38e29f441498b72137fcb6bda49b0aa00ff6f4f898c2c7f6504b46a378ea0d76';

it('mantiene exactamente las claves de goldenCases en la fixture', () => {
  expect(Object.keys(expected).sort()).toEqual(goldenCases.map((testCase) => testCase.name).sort());
});

it('fija el hash canonico-LF de la fixture: una edicion de bytes sucios falla aqui', () => {
  const raw = readFileSync(new URL('./testdata/golden-master-v1.json', import.meta.url));
  const lf = Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  const digest = createHash('sha256').update(lf).digest('hex');
  expect(digest).toBe(GOLDEN_MASTER_FIXTURE_SHA256_LF);
});

for (const testCase of goldenCases) {
  it(`bloquea comportamiento actual: ${testCase.name}`, () => {
    const actual = evaluatePolicy(testCase.input);
    expect(actual).toEqual(expected[testCase.name]);
    expect(createHash('sha256').update(canonicalFingerprintV1(testCase.input.facts)).digest('hex')).toBe(testCase.inputFingerprint);
    expect(createHash('sha256').update(canonicalFingerprintV1(actual)).digest('hex')).toBe(testCase.expectedFingerprint);
  });
}
