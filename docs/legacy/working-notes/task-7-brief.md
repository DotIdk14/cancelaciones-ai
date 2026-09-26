### Task 7: Blind sanitizer fail-closed y fingerprint determinista

**Files:**
- Modify: `apps/web/src/server/policy/blind-evidence-sanitizer.ts:18-162`
- Create: `apps/web/src/server/policy/blind-evidence-sanitizer.test.ts`
- Modify: `apps/web/src/server/policy/blind-audit.ts:82-278`
- Modify: `apps/web/src/server/policy/blind-audit.test.ts`

**Interfaces:**
- Produces: `BlindInputManifestV1`, `assertBlindManifestComplete`, `filterBlindArtifactsAndFacts`.
- Mantiene: `runBlindMachineAudit` no productivo.

- [ ] **Step 1: Escribir RED de fail-closed**

```ts
it('falla si un artifact no tiene evidencia permitida', () => {
  expect(() => assertBlindManifestComplete([{ artifactId: 'a1', evidenceId: '' }], new Set(['e1'])))
    .toThrow(/BLIND_MANIFEST_INCOMPLETE/);
});
```

- [ ] **Step 2: Implementar manifest y filtering GREEN**

El filtro usará un mapa explícito `artifactId -> evidenceId`; ya no indexará texto sólo por artifact y lo consultará por evidence ID sin relación. Evitará exclusiones duplicadas.

- [ ] **Step 3: Escribir RED de exclusión antes de extraction**

El test inyectará un interpreter/candidate fetcher que grabe los artifact IDs recibidos. El resultado será `fail closed` si `evidencesForSanitization` falta en modo blind estricto. `HUMAN_DECISION_DOCUMENT` y `ADJUDICATION_EVIDENCE` nunca llegarán al interpreter.

- [ ] **Step 4: Conectar filtering en `runBlindMachineAudit`**

Orden obligatorio:

```ts
const manifest = buildBlindInputManifest(input);
const allowedArtifacts = filterBlindArtifactsAndFacts(input.artifacts ?? [], manifest);
const allowedStoredFacts = filterBlindArtifactsAndFacts(input.storedFacts, manifest);
```

Si la entrada exige blind y el manifest está incompleto, devolver `BlindAuditFailure` con kind nuevo `BLIND_INPUT_INVALID`, sin crear facts sintéticas.

- [ ] **Step 5: Escribir RED de fingerprint estable**

Dos ejecuciones con artifacts equivalentes pero distintos `factRunId`, synthetic candidate IDs y `createdAt` deben producir igual `inputFingerprint`.

- [ ] **Step 6: Eliminar timestamps/IDs del fingerprint**

No usar `stableFingerprint` directamente sobre `StoredFact[]`. Crear `blindCanonicalInputV1` con:

```ts
{
  policyCode,
  policyVersion,
  extractorVersion: 'deterministic-v1',
  artifacts: artifacts.map(({ evidenceId, contentSha256, result }) => ({ evidenceId, contentSha256, result })),
  facts: storedFacts.map(({ factType, value, confidence, sourceRef }) => ({ factType, value, confidence, sourceRef })),
}
```

Ordenar artifacts/facts por hash canónico de su contenido, no por UUID o `created_at`.

- [ ] **Step 7: Verificar GREEN**

```bash
pnpm --filter @cancelaciones/web exec vitest run src/server/policy/blind-evidence-sanitizer.test.ts src/server/policy/blind-audit.test.ts
pnpm --filter @cancelaciones/web typecheck
```

Expected: PASS; el test histórico que acepta `MODEL_ERROR` no se usará como evidencia de sanitizer exitoso.

---

