### Task 5: Evaluation Envelope y Shadow Engine no oficial

**Files:**
- Create: `packages/policy-engine/src/evaluation-envelope.ts`
- Create: `packages/policy-engine/src/evaluation-envelope.test.ts`
- Create: `packages/policy-engine/src/shadow-engine.ts`
- Create: `packages/policy-engine/src/shadow-engine.test.ts`
- Modify: `packages/policy-engine/src/index.ts:3-4`

**Interfaces:**
- Produces: `AuditEvaluationEnvelopeV1`, `toAuditEvaluationEnvelopeV1(evaluation, context)`, `ShadowPolicyEngine`, `NonAuthoritativeShadowRunner`.

- [ ] **Step 1: Escribir RED de envelope**

Cubrir las diez reason codes:

```ts
const reasonCodes = [
  'NO_POLICY_OUTCOME', 'MISSING_EVIDENCE', 'CONTRADICTORY_EVIDENCE',
  'POLICY_COVERAGE_GAP', 'MISSING_NORMATIVE_SOURCE', 'MODEL_ERROR',
  'PARSING_ERROR', 'SCHEMA_ERROR', 'PERSISTENCE_ERROR', 'HUMAN_REVIEW_REQUIRED',
] as const;
```

Probar que `MODEL_ERROR` queda en `system`, no en `decision.outcomeStatus`; `MISSING_EVIDENCE` en `evidence`; coverage gap en `policy`; y human review en `review`.

- [ ] **Step 2: Ejecutar RED**

```bash
pnpm --filter @cancelaciones/policy-engine test -- evaluation-envelope.test.ts
```

Expected: FAIL por módulo inexistente.

- [ ] **Step 3: Implementar adapter sin cambiar `PolicyEvaluation`**

`toAuditEvaluationEnvelopeV1` conservará `suggestedOutcome`, `outcomeStatus` y `decisionStatus` sin reinterpretarlos. Ordenará las causas según errores de sistema, fuentes normativas, coverage, conflictos, missing facts/evidence y review.

- [ ] **Step 4: Escribir RED de shadow boundary**

```ts
it('no expone una API de persistencia oficial', () => {
  const runner = createNonAuthoritativeShadowRunner({ evaluate: async () => ({ outcome: null }) });
  expect(runner.authoritative).toBe(false);
  expect('persist' in runner).toBe(false);
  expect('write' in runner).toBe(false);
});
```

- [ ] **Step 5: Implementar interfaz mínima y GREEN**

`ShadowPolicyEngine` tendrá sólo `id`, `version` y `evaluate(input): Promise<ShadowPolicyResult>`. El wrapper comparará resultados en memoria y no aceptará `DatabaseClient`, audit ID, engine run ID ni serializer oficial.

```bash
pnpm --filter @cancelaciones/policy-engine test
pnpm --filter @cancelaciones/policy-engine typecheck
```

Expected: PASS y Golden Master verde.

---

