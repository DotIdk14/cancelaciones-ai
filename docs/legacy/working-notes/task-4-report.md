# Task 4 — Golden Master del motor actual

## Estado

COMPLETADA CON CONCERNS.

Se creó un corpus sintético de caracterización con diez familias, una fixture JSON estática con la evaluación completa del motor actual y pruebas de igualdad exhaustiva más SHA-256 de entrada y salida.

No se modificaron `evaluatePolicy`, `v5Rules`, `policySets` ni ningún outcome. No se añadieron datos reales, scripts, flags, mecanismos de auto-update ni comentarios de código. No se realizaron commits.

## Archivos creados

- `packages/policy-engine/src/golden-master-cases.ts`
- `packages/policy-engine/src/golden-master.test.ts`
- `packages/policy-engine/src/testdata/golden-master-v1.json`
- `.superpowers/sdd/task-4-report.md`

## Familias incluidas

1. `complete-licenciatura`
2. `missing-all-facts`
3. `partial-contact-collections`
4. `unknown-academic-level`
5. `non-licenciatura`
6. `grades-observed`
7. `grades-absent`
8. `contact-threshold-satisfied`
9. `contact-threshold-not-satisfied`
10. `coverage-gaps-v5`

Todos los facts presentes usan IDs `synthetic-*` y provenance `synthetic-evidence`. El caso `missing-all-facts` contiene deliberadamente cero facts. Cada caso declara metadata sintética y no normativa.

## TDD

### Baseline previa

Comando:

```bash
pnpm --filter @cancelaciones/policy-engine test
```

Resultado anterior a Task 4:

- 4 archivos de test pasaron.
- 33 tests pasaron.
- 0 fallos.

### RED por fixture ausente

Primero se crearon `golden-master-cases.ts` y `golden-master.test.ts`, sin crear la fixture.

Comando:

```bash
pnpm --filter @cancelaciones/policy-engine test -- golden-master.test.ts
```

Resultado observado:

- 1 suite fallida.
- 0 tests ejecutados.
- Fallo esperado `ENOENT` al abrir `packages/policy-engine/src/testdata/golden-master-v1.json`.
- No hubo fallo de sintaxis, compilación, tipos o lógica antes del fixture.

### Captura del comportamiento actual

Se evaluó el motor actual con los diez inputs finales y se materializó una sola vez la captura final como `golden-master-v1.json`. Cada entrada y evaluación recibió SHA-256 mediante `canonicalFingerprintV1`. La evaluación completa quedó almacenada sin transformaciones semánticas.

No se creó ningún comando persistente, script, flag o test que escriba la fixture.

### GREEN #1

Comando:

```bash
pnpm --filter @cancelaciones/policy-engine test -- golden-master.test.ts
```

Resultado:

- 1 archivo pasó.
- 10 tests pasaron.
- 0 fallos.

### GREEN #2

Comando:

```bash
pnpm --filter @cancelaciones/policy-engine test -- golden-master.test.ts
```

Resultado:

- 1 archivo pasó.
- 10 tests pasaron.
- 0 fallos.
- El hash de la fixture permaneció idéntico.

## Hashes de casos

| Familia | inputFingerprint | expectedFingerprint |
|---|---|---|
| `complete-licenciatura` | `7bce39d4c8a356a2e1e8f77c02cbcbb04834409deb3416f87cfa96c99ef8db58` | `f95394ddaf0c5dc22a8fa133e0ae01c6546fc9e487c75894b05cc97deee43fea` |
| `missing-all-facts` | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | `3771a40414cd4b339b18059cfbefa5de6ac99b6e62d070d0934b4f8cc028321e` |
| `partial-contact-collections` | `ed2fd088d80fa94d2e1e3393c757f4b0444ba162d9711c29171734cf97c0a9bf` | `50fde4d4728d90ee68dbea95aba70a320c40fe36ece22e146b0f56dd4d6726d5` |
| `unknown-academic-level` | `614419f3c83348b161b1582ec13159d1878b7b628e7f62f11a1554f5d475da92` | `3c60ef592e08931650ba33aeb915be484774864088d114e084243331f27243ae` |
| `non-licenciatura` | `bbb2b50c23584acda4f09cb38e65a700ae9e871b3b5bfc466b393ead20594491` | `eadb0627eed359d7ff5c79ac359bcef440b24e9ca79a815cd0d99b950d3a6030` |
| `grades-observed` | `92a1b8597099ef932e6a12ef35f0572d25d68013b333815e23516d0d72220469` | `e260009ec5894046348f37c80ad5b088bd07f57c0f374579b3ada2a097a3b5b1` |
| `grades-absent` | `ea6680de55290e8c18b993dc423f39125f202e23f7fac2e84edee2da0a5b5982` | `638bed7bfa343ea1007bc81faf9d00453bbf9749d0e9f2c2e90d90cd4ccc29b3` |
| `contact-threshold-satisfied` | `7c557a69b2aff0f0428debb269a9a48c53033a576ad5137050b54cdc3dc47c41` | `2e501f028f60dfeb59c3fdfc31d6b1cf871d48ec7883590cedb3e56bf370fb7a` |
| `contact-threshold-not-satisfied` | `dce71863391ee6d0948ba935cd185e9272e88708eb58f9dc9b15dc8b031be1cc` | `b149edeac1a35fba5cedaa122a192346bedf8df5657b627867ed303bb9d3ea68` |
| `coverage-gaps-v5` | `4af0fd3e517a382c77363b9ca4574c95cdf2d8895a793a941522c9db52e3dac9` | `197c968fe336dd033d58a67cef2c7bbe3c2ee7121fa2c5c00c5d165ac4135521` |

## SHA-256 de referencia de la fixture

Comando:

```bash
sha256sum packages/policy-engine/src/testdata/golden-master-v1.json
```

Resultado:

```text
506c5d92da6822bcf7f2caee5ca1f8df12366f694a1bf2f1e326c31baa011dc3  packages/policy-engine/src/testdata/golden-master-v1.json
```

## Verificación final

### Suite completa del paquete

```bash
pnpm --filter @cancelaciones/policy-engine test
```

Resultado:

- 5 archivos de test pasaron.
- 43 tests pasaron.
- 0 fallos.

### Typecheck

```bash
pnpm --filter @cancelaciones/policy-engine typecheck
```

Resultado: exit code 0, sin errores.

### Lint

```bash
pnpm --filter @cancelaciones/policy-engine lint
```

Resultado: exit code 0. El script del paquete delega el lint al typecheck.

### Integridad de la fixture

El SHA-256 antes y después de las verificaciones fue:

```text
506c5d92da6822bcf7f2caee5ca1f8df12366f694a1bf2f1e326c31baa011dc3
```

## Revisión de alcance

- Archivos de aplicación modificados por Task 4: ninguno.
- `evaluatePolicy`, `v5Rules` y `policySets`: sin cambios.
- Outcomes: capturados como comportamiento actual, sin corrección.
- Policy sets: sin versiones o reglas nuevas.
- Datos: únicamente sintéticos; no se copiaron expedientes reales.
- Fixture: JSON estático de lectura durante tests; ninguna prueba lo modifica.
- Auto-update: no implementado.
- Comentarios nuevos en código: ninguno.
- Commits: ninguno.

## Concerns

1. La fixture congela comportamiento actual, no verdad normativa. Debe tratarse sólo como characterization baseline.
2. El checkout no es un linked worktree y ya contenía cambios ajenos a Task 4. Se trabajó en el workspace indicado por el brief y se limitaron las escrituras de producto a los tres archivos solicitados, más este informe.
3. Antes de la captura final se ejecutó un smoke efímero de los inputs con una distribución escrita 4/2. Se descartó sin materializarlo al detectar que el motor actual no satisface 70/30 con esa proporción. Los inputs finales se cambiaron a 7/3 y la captura final se realizó una sola vez antes de crear la fixture del proyecto. No se corrigió ninguna evaluación del motor.
4. `rulesFingerprint` y `factsFingerprint` son strings JSON produced por el contrato vigente. La fixture también conserva las estructuras completas, por lo que cualquier cambio de orden o contenido queda bloqueado por `toEqual` y por los SHA-256.

## Fix report de Task 4

### Estado

CORREGIDA CON CONCERNS.

Se corrigieron los cuatro hallazgos del reviewer sin modificar `evaluatePolicy`, `v5Rules` ni `policySets`.

### Cambios

- Se añadió `unknown-contact-collections` con dos facts deterministas de `sourceCompleteness: 'UNKNOWN'`.
- Se añadió `conflict-current-engine-probe` con facts deterministas que combinan la exclusión de grades satisfecha con la rama de outcome no satisfecha; su metadata documenta que el motor actual no materializa un conflicto en este rule set.
- La fixture captura exactamente el resultado actual del probe: `conflicts: []`, `suggestedOutcome: null`, `outcomeStatus: 'INDETERMINATE'` y `decisionStatus: 'INDETERMINATE'`.
- El test exige que `Object.keys(expected)` coincida exactamente con los nombres de `goldenCases`, sin claves extra.
- Se eliminó el import no usado de `describe`.
- La fixture estática se materializó una sola vez para el conjunto final; no se añadió auto-update.

### Verificación

- Golden test #1: 1 archivo, 14 tests, 0 fallos.
- Golden test #2: 1 archivo, 14 tests, 0 fallos.
- Suite del paquete: 5 archivos, 46 tests, 0 fallos.
- Typecheck: exit code 0.
- Lint: exit code 0; el script delega en typecheck.
- SHA-256 fixture: `38e29f441498b72137fcb6bda49b0aa00ff6f4f898c2c7f6504b46a378ea0d76`.

### Hashes añadidos

| Caso | inputFingerprint | expectedFingerprint |
|---|---|---|
| `unknown-contact-collections` | `50b19363a894ec2c70207facd46e0023ffce602ab7fc2f27e0bd2d714fe788ff` | `81f97514c5cafb7327e8e5d2254a2b87f76d0bed1731427dc929fe20dae61a7a` |
| `conflict-current-engine-probe` | `53af2fc6278adc0d65adda8056b0fe6238cd4d43f0d98db48be569796569c2cf` | `9b1f69617e802bc987f44ff4a678cfc29e02188f535ce9bd87d04ffc1e0231f6` |

### Concerns

1. El probe documenta una limitación real del rule set actual: la exclusión de grades no genera un `outcomeEffect` y, por tanto, no se materializa como conflicto.
2. El corpus sigue siendo una baseline de caracterización, no una afirmación normativa.
3. El checkout contiene cambios previos ajenos a esta corrección; el diff de `index.ts` observado corresponde a un cambio preexistente y no fue alterado.
4. No se realizaron commits.

