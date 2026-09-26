# Task 7 — Fix report

## Estado

COMPLETADA.

Se corrigieron las brechas fail-closed del blind audit sin modificar normativa, callers productivos, dependencias ni infraestructura.

## Revisión de seguimiento — 2026-09-25

### Correcciones

- `allowedArtifacts` se ordenan antes de `runEvidenceInterpreter` por `canonicalFingerprintV1({ evidenceId, contentSha256, result })`, con desempate estable por el fingerprint canónico completo del artifact.
- El test de artifacts inversos usa el mismo manifest y verifica que el orden recibido y el candidato extraído no cambian.
- El test de `inputFingerprint` conserva `evidenceId: evidence-one` en los artifacts equivalentes y usa el mismo `contentSha256`, evitando que el test pase por filtrado accidental.
- `artifactTextMap` considera `result.text` sólo cuando contiene texto no vacío; en caso contrario usa `transcript` no vacío o `firstFact`.
- Se añadió la regresión de transcript humano con `text` whitespace que falla antes del interpreter.

### TDD y verificación

- RED: el test de orden falló con `['a-one', 'a-two']` frente a `['a-two', 'a-one']`; el test de transcript no falló cerrado porque el texto humano quedaba oculto.
- GREEN focalizado: `pnpm --filter @cancelaciones/web exec vitest run src/server/policy/blind-audit.test.ts src/server/policy/blind-evidence-sanitizer.test.ts` — 2 archivos, 30 tests PASS.
- Web: `pnpm --filter @cancelaciones/web test` — 19 archivos, 121 tests PASS.
- Typecheck: `pnpm --filter @cancelaciones/web typecheck` — PASS.
- Lint: `pnpm --filter @cancelaciones/web lint` — PASS.
- No se modificó el payload, truncación, campos ni hash de `AI_DECISION_V1`; Task 8 permanece fuera de alcance.
- No se realizaron commits.

## Revisión posterior — correcciones de los tres hallazgos de Task 7

### Estado

COMPLETADA. Los tres hallazgos quedaron corregidos con TDD RED → GREEN, sin tocar `AI_DECISION_V1` (payload, truncación de justificaciones ni campos), el policy engine, las fuentes normativas, los callers ni los comentarios de código.

### Archivos modificados en esta revisión

- `apps/web/src/server/policy/blind-audit.ts`
- `apps/web/src/server/policy/blind-audit.test.ts`
- `.superpowers/sdd/task-7-report.md`

### Hallazgo 1 — canonicalización dependiente de locale

- `hashOf` ya no usa `stableFingerprint`; usa `canonicalFingerprintV1` de `@cancelaciones/domain`, que ordena claves por code points y omite campos operativos.
- El fallback de `sortCanonical` también usa `canonicalFingerprintV1`, conservando el comparator por code points ya existente en el módulo para hashes y para el desempate.
- El módulo `blind-audit.ts` queda sin ninguna referencia a `stableFingerprint` ni a `localeCompare`.
- El hash local del test de orden canónico se alineó con la misma canonicalización para que la aserción siga describiendo el comportamiento real.
- Alcance: la canonicalización es única en el módulo. El hash `aiDecisionHash` de `AI_DECISION_V1` conserva su payload, sus campos y su truncación; sólo comparte la función de canonicalización, ya que dejar `stableFingerprint` en el archivo reintroduciría la dependencia de locale que el hallazgo elimina.

### Hallazgo 2 — colisión de provenance en el fingerprint canónico

- `blindCanonicalInputV1` conserva `artifactId` en `evidenceRefs` y en `artifactRefs`; antes ambos campos se descartaban y dos candidates con distinta artifact de origen pero mismo `evidenceId` y mismo `sha256` generaban el mismo fingerprint.
- El orden canónico de esas referencias se mantiene por code points, así que el fingerprint sigue siendo independiente del orden de salida del interpreter.

### Hallazgo 3 — sobrescritura de texto en `artifactTextMap`

- La construcción del mapa de texto acumula los fragments por `evidenceId` y los concatena con salto de línea antes de invocar `blindEvidenceSanitizer`.
- Antes, el último artifact con un `evidenceId` compartido reemplazaba el texto de los anteriores, de modo que contenido de dictamen humano en un artifact podía quedar oculto tras un artifact limpio y esa evidencia era admitida al conjunto permitido.
- Ahora la sanitización evalúa la totalidad del texto de la evidencia, y una evidencia compartida que contenga heurística humana se excluye y falla cerrado con `BLIND_INPUT_INVALID` antes del interpreter, el grafo o el candidate fetcher.

### TDD RED → GREEN

#### RED

Comando:

```bash
pnpm --filter @cancelaciones/web exec vitest run src/server/policy/blind-audit.test.ts
```

Resultado observado:

- FAIL — `conserva el artifactId en evidenceRefs y artifactRefs del fingerprint canónico`: el ref canónico sólo contenía `evidenceId` y `page`.
- FAIL — `el fingerprint de entrada no depende de localeCompare`: con `localeCompare` forzado a `-1` el `inputFingerprint` cambiaba de `687e2ae4…` a `478f1f1a…`.
- FAIL — `concatena los textos de artifacts que comparten evidenceId antes de sanitizar`: el audit continuaba y el interpreter sí se invocaba.

Los tres fallos fueron por la razón esperada, no por error de test.

#### GREEN

```bash
pnpm --filter @cancelaciones/web exec vitest run src/server/policy/blind-audit.test.ts src/server/policy/blind-evidence-sanitizer.test.ts
```

- PASS — 2 archivos, 28 tests, 0 fallos.

### Verificación final de la revisión

#### Blind tests

```bash
pnpm --filter @cancelaciones/web exec vitest run src/server/policy/blind-audit.test.ts src/server/policy/blind-evidence-sanitizer.test.ts
```

- PASS — 2 archivos, 28 tests.

#### Web test

```bash
pnpm --filter @cancelaciones/web test
```

- PASS — 19 archivos, 119 tests.

#### Web typecheck

```bash
pnpm --filter @cancelaciones/web typecheck
```

- PASS — `tsc --noEmit`, exit code 0.

#### Web lint

```bash
pnpm --filter @cancelaciones/web lint
```

- PASS — `eslint . --max-warnings=0`, exit code 0.

### Invariantes verificadas en la revisión

- `blind-audit.ts` no depende de `stableFingerprint` ni de `localeCompare` para hashear ni para ordenar.
- El orden canónico sigue usando el comparator por code points del propio módulo.
- Dos candidates que sólo difieren en `artifactId` producen fingerprints distintos.
- El `inputFingerprint` es idéntico con `localeCompare` saboteado.
- El texto sanitizado de una evidencia es la concatenación de todos sus artifacts, no el del último.
- El `aiDecisionHash` de `AI_DECISION_V1` no se modificó en payload ni en estructura; queda fuera de alcance hasta Task 8.
- No se modificaron el policy engine, las fuentes normativas, los callers, las dependencias ni los comentarios de código.
- No se realizaron commits, push, merge ni PR.
- Los cambios preexistentes ajenos a esta revisión fueron preservados.

### Concerns de la revisión

1. El cambio de canonicalización altera los digests de `inputFingerprint`, del id sintético de facts y de `aiDecisionHash` respecto de la implementación previa; es el efecto buscado por el hallazgo 1, pero invalida comparaciones históricas de hashes y requiere que Task 8 revise el alcance de `AI_DECISION_V1`.
2. `canonicalFingerprintV1` omite `runId` además de los campos operativos ya contemplados; el fingerprint no incorporaba `runId` en las colecciones canónicas, por lo que no cambia el comportamiento observable cubierto por tests.
3. Persiste el warning preexistente de deprecación del build CJS de Vite.


## Archivos modificados

- `apps/web/src/server/policy/blind-evidence-sanitizer.ts`
- `apps/web/src/server/policy/blind-evidence-sanitizer.test.ts`
- `apps/web/src/server/policy/blind-audit.ts`
- `apps/web/src/server/policy/blind-audit.test.ts`
- `.superpowers/sdd/task-7-report.md`

## Correcciones

- Se agregó `assertBlindReferencesValid`, helper puro y fail-closed para referencias de artifacts, stored facts y candidates.
- El manifest se construye únicamente desde la relación evidence-artifact declarada; ya no admite ni utiliza `storedFacts` como fuente de autoridad.
- El manifest rechaza relaciones ambiguas, ausentes o no permitidas antes de filtering.
- Las referencias humanas, desconocidas, huérfanas o inconsistentes se rechazan con `BLIND_REFERENCE_INVALID`.
- La validación de candidates comprueba evidencia permitida, relación evidence-artifact, artifact conocido y hash coincidente.
- Las referencias de artifacts y stored facts se validan antes de cualquier extracción o construcción de grafo.
- Los candidates se validan inmediatamente después del interpreter y antes de construir el grafo.
- `isBlindAuditResultV1` excluye correctamente `BlindAuditFailure` mediante la ausencia de `ok`.
- `blindCanonicalInputV1` incluye artifacts, stored facts y candidates extraídos con orden canónico.
- El manifest y el sanitizer aplican una allowlist estricta: sólo `document_role = EVIDENCE` es admisible; roles humanos, desconocidos, vacíos, `undefined`, `null` o de otro tipo se excluyen.
- El artifact asociado a un role no admisible queda fuera del manifest y nunca se incorpora al conjunto permitido.
- `roleSummary` representa explícitamente roles ausentes y valores no textuales sin mutar prototipos.
- El fingerprint de candidates excluye IDs operativos de artifacts y conserva evidencia, hashes, valor, confianza, método, texto observado, fecha observada y warnings.
- Las referencias internas de candidates se ordenan canónicamente para evitar dependencia del orden de salida.
- `sortCanonical` compara hashes y fallback por code points, sin dependencia de `localeCompare` ni del locale del runtime.
- Los facts sintéticos mantienen IDs y `createdAt` deterministas, pero esos campos operativos no entran al fingerprint.
- Antes de filtrar, cada artifact cuyo `evidenceId` está en `sanitizationResult.allowed` se compara con la relación `artifactId -> evidenceId` del manifest; una relación ausente o distinta devuelve `BLIND_INPUT_INVALID` antes de interpreter, grafo o candidate fetcher.
- Los artifacts humanos excluidos por sanitización no participan en esa comparación ni en el conjunto permitido.

## Casos de referencia cubiertos

Los tests focalizados cubren nueve casos de seguridad y corrección:

1. El manifest no se amplía desde stored facts.
2. Referencias consistentes de artifacts, facts y candidates.
3. Referencias humanas en las tres colecciones.
4. Referencias desconocidas en las tres colecciones.
5. Referencias inconsistentes, incluyendo hash distinto.
6. Artifact sin evidencia permitida.
7. Roles no `EVIDENCE` desconocidos, vacíos y ausentes, incluyendo la exclusión de su artifact.
8. Filtrado heurístico y relación artifact-evidence.
9. Orden canónico de hashes por code points sin comparación por locale.

## TDD RED → GREEN

### RED

Comando:

```bash
pnpm --filter @cancelaciones/web exec vitest run src/server/policy/blind-evidence-sanitizer.test.ts src/server/policy/blind-audit.test.ts
```

Resultado observado en la corrección fail-closed:

- FAIL — 3 variantes: `UNKNOWN_ROLE`, rol vacío y rol ausente se includían en `allowed` y su artifact entraba al manifest.
- FAIL — orden canónico: `sortCanonical` llamaba `localeCompare` directamente sobre el hash canónico.

El fix base también había registrado RED para ampliación indebida del manifest, helper ausente, type guard incorrecto, referencias no rechazadas y fingerprint sin candidates.

### GREEN

Comando:

```bash
pnpm --filter @cancelaciones/web exec vitest run src/server/policy/blind-evidence-sanitizer.test.ts src/server/policy/blind-audit.test.ts
```

Resultado:

- PASS — 2 archivos, 25 tests, 0 fallos.

## Ajuste aprobado posterior

### RED

- El test de relación `a-mismatch -> evidence-declared` con artifact `evidence-actual` reproducía que el filtro descartaba el artifact, pero `graphFetcher` todavía se ejecutaba.

### GREEN

- La comparación fail-closed se ejecuta después de sanitizar y antes de filtrar.
- El caso inválido devuelve `BLIND_INPUT_INVALID` sin invocar `graphFetcher` ni `candidateFetcher`.
- El caso conserva un artifact humano excluido y confirma que no altera la comparación de artifacts permitidos.

## Verificación final

### Blind tests

```bash
pnpm --filter @cancelaciones/web exec vitest run src/server/policy/blind-evidence-sanitizer.test.ts src/server/policy/blind-audit.test.ts
```

- PASS — 2 archivos, 24 tests.

### Web test

```bash
pnpm --filter @cancelaciones/web test
```

- PASS — 19 archivos, 116 tests.

### Web typecheck

```bash
pnpm --filter @cancelaciones/web typecheck
```

- PASS — `tsc --noEmit`, exit code 0.

### Web lint

```bash
pnpm --filter @cancelaciones/web lint
```

- PASS — `eslint . --max-warnings=0`, exit code 0.

## Invariantes verificadas

- Ningún role distinto de `EVIDENCE` llega a `allowed`, manifest, graph, interpreter, reasoner o candidate fetcher.
- Ninguna referencia humana, desconocida o inconsistente llega a graph, reasoner o candidate fetcher.
- El manifest no obtiene autoridad desde stored facts.
- La validación de candidates ocurre antes del grafo.
- El fingerprint cambia ante contenido de stored facts o candidates.
- El fingerprint permanece estable ante IDs y timestamps operativos cubiertos por tests.
- El orden canónico no depende de locale ni de `localeCompare` para comparar hashes.
- El type guard no estrecha failures como successes.
- No se modificaron fuentes normativas ni el policy engine.
- No se añadieron callers productivos, dependencias ni comentarios de código.
- No se realizaron commits, push, merge ni PR.

## Concerns

1. Vitest/Vite mantiene el warning preexistente de deprecación del build CJS.
2. Los tests legacy imprimen `MODEL_ERROR` esperado al usar `candidateFetcher` o completar sin variables de entorno; no representa una sanitizerización exitosa.
3. `interpreterFetcher` y `graphFetcher` son dependencias inyectables para tests del límite shadow; no tienen callers productivos.
4. El workspace contiene cambios preexistentes ajenos a este fix; fueron preservados.
5. El harness no expone subagentes; la review fue local contra el brief, invariantes, seguridad, typecheck, lint y suites ejecutadas.
