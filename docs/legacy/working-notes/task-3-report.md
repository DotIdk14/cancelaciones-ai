# Task 3 — Canonical Policy Source Registry

## Estado

Implementación completada dentro del alcance solicitado.

Archivos modificados o creados:

- `packages/policy-engine/src/source-registry.ts`
- `packages/policy-engine/src/source-registry.test.ts`
- `packages/policy-engine/src/index.ts`

No se modificaron `v5Rules`, `policySets` ni `evaluatePolicy`. No se añadieron comentarios al código. No se realizaron commits.

## Comportamiento implementado

- `PolicySourceRecord` representa una fuente con `policyCode`, `policyVersion`, `documentId`, `sha256` y estado.
- `PolicyRuleReference` permite `page` y `citation` opcionales; el registry no inventa esos valores.
- `createPolicySourceRegistry` es puro y no crea fuentes implícitas.
- Valida SHA-256 con `/^[a-f0-9]{64}$/`.
- Indexa por `policyCode|policyVersion`.
- Rechaza índices de policy/version duplicados y `documentId` duplicados con `POLICY_SOURCE_DUPLICATE`.
- Expone `get`, `list`, `canonicalSources` y `requireReference`.
- `requireReference` verifica que el `documentId` corresponda a la fuente registrada y conserva `PENDING_VERIFICATION`.
- No existe seed de ninguna fuente `CANONICAL`; el PDF/hash local queda únicamente como `PENDING_VERIFICATION` en la prueba.
- `index.ts` exporta el nuevo módulo al inicio.

## TDD

### RED

Comando ejecutado:

```bash
pnpm --filter @cancelaciones/policy-engine test -- source-registry.test.ts
```

Resultado: fallo esperado porque `./source-registry` no existía. Vitest reportó `Failed to load url ./source-registry`.

### GREEN

Comandos ejecutados:

```bash
pnpm --filter @cancelaciones/policy-engine test -- source-registry.test.ts
pnpm --filter @cancelaciones/policy-engine typecheck
```

Resultados:

- Prueba focal: 3 passed.
- Typecheck: PASS.

### Baseline

Comandos ejecutados:

```bash
pnpm --filter @cancelaciones/policy-engine test
pnpm --filter @cancelaciones/policy-engine lint
git diff --check
```

Resultados:

- Suite completa: 4 archivos, 32 pruebas passed.
- Lint configurado: PASS; el paquete delega el lint al typecheck.
- Diff check: PASS.

## Concerns

- La verificación de que una fuente sea oficialmente canónica y la transición `PENDING_VERIFICATION` a `CANONICAL` quedan fuera de este registry; no se seedea ni se modifica ninguna fuente.
- `requireReference` devuelve el estado de la fuente, por lo que una referencia a la fuente local permanece claramente `PENDING_VERIFICATION` y no se presenta como normativa canónica.
- Se observaron cambios preexistentes fuera del alcance en otros archivos del workspace; no fueron tocados por esta tarea.

## Fix report

### Estado

Corregido el contrato de estados de fuentes normativas. `PolicySourceStatus` incluye exactamente `CANONICAL`, `LEGACY`, `PENDING_VERIFICATION` y `SUPERSEDED`. No se modificó otra lógica, el PDF local continúa en estado `PENDING_VERIFICATION` y no se realizaron commits.

### Cambios

- Se añadió una prueba de regresión que registra una fuente `LEGACY`, una `SUPERSEDED` y una `CANONICAL`.
- La prueba verifica que las tres fuentes quedan registradas y que `canonicalSources` devuelve exclusivamente la `CANONICAL`.
- La cobertura tipada mediante `Record<PolicySourceStatus, true>` exige exactamente los cuatro estados sin permitir estados adicionales.

### TDD y verificaciones

RED:

```text
pnpm --filter @cancelaciones/policy-engine typecheck
```

Falló con `TS2353` y `TS2322` para `LEGACY` y `SUPERSEDED` antes de ampliar la unión.

GREEN y verificación final:

```text
pnpm --filter @cancelaciones/policy-engine test
pnpm --filter @cancelaciones/policy-engine typecheck
pnpm --filter @cancelaciones/policy-engine lint
git diff --check -- packages/policy-engine/src/source-registry.ts packages/policy-engine/src/source-registry.test.ts .superpowers/sdd/task-3-report.md
```

Resultados:

- Suite `policy-engine`: 4 archivos y 33 pruebas aprobadas.
- Typecheck: PASS.
- Lint configurado: PASS.
- Diff check: PASS.

### Concerns

- La transición o validación que convertiría una fuente en `CANONICAL` sigue fuera del registry; esta corrección sólo define y filtra estados.
- Persisten cambios preexistentes fuera del alcance del workspace; no fueron tocados.
