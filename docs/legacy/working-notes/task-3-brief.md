### Task 3: Canonical Policy Source Registry

**Files:**
- Create: `packages/policy-engine/src/source-registry.ts`
- Create: `packages/policy-engine/src/source-registry.test.ts`
- Modify: `packages/policy-engine/src/index.ts:3-4`

**Interfaces:**
- Produces: `PolicySourceRecord`, `PolicyRuleReference`, `createPolicySourceRegistry(input)`.
- Registra sólo el PDF local con status `PENDING_VERIFICATION`; no seed CANONICAL.

- [ ] **Step 1: Escribir RED**

```ts
import { describe, expect, it } from 'vitest';
import { createPolicySourceRegistry } from './source-registry';

const pending = {
  policyCode: 'GDM_GAM_PRD_MLG_003',
  policyVersion: 'UNVERIFIED_LOCAL',
  documentId: 'gdm-gam-prd-mlg-003-local-unverified',
  sha256: '71faf64634805b1b4820132cdfcc1304d740ff00d1e9573dd850222c9496c7d2',
  status: 'PENDING_VERIFICATION' as const,
};

describe('PolicySourceRegistry', () => {
  it('registra una fuente pendiente sin declararla canónica', () => {
    const registry = createPolicySourceRegistry([pending]);
    expect(registry.get(pending.policyCode, pending.policyVersion)?.status).toBe('PENDING_VERIFICATION');
    expect(registry.canonicalSources()).toEqual([]);
  });

  it('rechaza SHA-256 inválido y versiones duplicadas', () => {
    expect(() => createPolicySourceRegistry([{ ...pending, sha256: 'bad' }])).toThrow(/POLICY_SOURCE_SHA256_INVALID/);
    expect(() => createPolicySourceRegistry([pending, pending])).toThrow(/POLICY_SOURCE_DUPLICATE/);
  });

  it('exige referencia completa de policy para reglas futuras', () => {
    const registry = createPolicySourceRegistry([pending]);
    expect(registry.requireReference({
      policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: 'UNVERIFIED_LOCAL',
      documentId: 'gdm-gam-prd-mlg-003-local-unverified', section: '5.2', page: 3, citation: 'test',
    }).status).toBe('PENDING_VERIFICATION');
  });
});
```

- [ ] **Step 2: Ejecutar RED**

```bash
pnpm --filter @cancelaciones/policy-engine test -- source-registry.test.ts
```

Expected: FAIL por módulo inexistente.

- [ ] **Step 3: Implementar registry puro**

`createPolicySourceRegistry` validará SHA-256 con `/^[a-f0-9]{64}$/`, indexará por `policyCode|policyVersion`, exigirá unicidad de `documentId`, y expondrá `get`, `list`, `canonicalSources` y `requireReference`. La referencia podrá omitir `page` o `citation` cuando no estén confirmados, pero no inventará valores.

- [ ] **Step 4: Exportar sin tocar reglas**

Añadir `export * from './source-registry';` al inicio de `packages/policy-engine/src/index.ts`. No modificar las líneas de `v5Rules`, `policySets` ni `evaluatePolicy`.

- [ ] **Step 5: Verificar GREEN y baseline del motor**

```bash
pnpm --filter @cancelaciones/policy-engine test
pnpm --filter @cancelaciones/policy-engine typecheck
```

Expected: PASS.

---

