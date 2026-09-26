### Task 4: Golden Master del motor actual

**Files:**
- Create: `packages/policy-engine/src/golden-master-cases.ts`
- Create: `packages/policy-engine/src/golden-master.test.ts`
- Create: `packages/policy-engine/src/testdata/golden-master-v1.json`

**Interfaces:**
- Consumes: `evaluatePolicy(input)`.
- Produces: corpus sintético inmutable con `expected.evaluation` y hashes completos.

- [ ] **Step 1: Definir casos sintéticos RED**

Crear exactamente estas familias:

```ts
export const goldenCases = [
  'complete-licenciatura',
  'missing-all-facts',
  'partial-contact-collections',
  'unknown-academic-level',
  'non-licenciatura',
  'grades-observed',
  'grades-absent',
  'contact-threshold-satisfied',
  'contact-threshold-not-satisfied',
  'coverage-gaps-v5',
] as const;
```

Cada caso usará sólo facts sintéticos con IDs `synthetic-*`, valores conocidos por el contrato actual y provenance `synthetic-evidence`. No copiar texto de expedientes reales.

- [ ] **Step 2: Escribir comparación exhaustiva**

```ts
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalFingerprintV1 } from '@cancelaciones/domain';
import { evaluatePolicy } from './index';
import { goldenCases } from './golden-master-cases';

const expected = JSON.parse(readFileSync(new URL('./testdata/golden-master-v1.json', import.meta.url), 'utf8')) as Record<string, unknown>;

for (const testCase of goldenCases) {
  it(`bloquea comportamiento actual: ${testCase}`, () => {
    const actual = evaluatePolicy(testCase.input);
    expect(actual).toEqual(expected[testCase]);
    expect(createHash('sha256').update(canonicalFingerprintV1(actual)).digest('hex')).toBe(testCase.expectedFingerprint);
  });
}
```

- [ ] **Step 3: Ejecutar RED**

```bash
pnpm --filter @cancelaciones/policy-engine test -- golden-master.test.ts
```

Expected: FAIL porque `golden-master-v1.json` aún no existe.

- [ ] **Step 4: Capturar baseline una sola vez con el código actual**

Antes de añadir el JSON, ejecutar el test contra `evaluatePolicy` actual y materializar `expected` con la salida completa. Cada caso usará:

```ts
inputFingerprint: sha256(canonicalFingerprintV1(facts))
expectedFingerprint: sha256(canonicalFingerprintV1(expectedEvaluation))
metadata: { synthetic: true, notes: 'Behavior lock; not normative truth.' }
```

No añadir script, flag ni test que escriba el JSON.

- [ ] **Step 5: Ejecutar GREEN dos veces**

```bash
pnpm --filter @cancelaciones/policy-engine test -- golden-master.test.ts
pnpm --filter @cancelaciones/policy-engine test -- golden-master.test.ts
```

Expected: ambos PASS y fingerprints idénticos.

- [ ] **Step 6: Guardar hash de referencia del fixture**

```bash
sha256sum packages/policy-engine/src/testdata/golden-master-v1.json
```

Registrar el hash en el reporte, no en un archivo autoactualizable.

---

