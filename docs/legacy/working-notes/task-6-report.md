# Task 6 — Evidence validation y Extraction Tools shadow

## Estado

COMPLETADA.

Se implementaron contratos Zod estrictos, validación de referencias de evidencia, registry local y dos Extraction Tools deterministas shadow/test-only. No se conectaron al pipeline productivo, no se integró OpenRouter y no se añadieron outcomes, decisiones ni referencias de reglas.

## Archivos creados

- `apps/web/src/server/extraction/contracts.ts`
- `apps/web/src/server/extraction/contracts.test.ts`
- `apps/web/src/server/extraction/evidence-reference-validation.ts`
- `apps/web/src/server/extraction/evidence-reference-validation.test.ts`
- `apps/web/src/server/extraction/registry.ts`
- `apps/web/src/server/extraction/registry.test.ts`
- `apps/web/src/server/extraction/tools/extract-dates.ts`
- `apps/web/src/server/extraction/tools/extract-dates.test.ts`
- `apps/web/src/server/extraction/tools/extract-contact-attempts.ts`
- `apps/web/src/server/extraction/tools/extract-contact-attempts.test.ts`
- `.superpowers/sdd/task-6-report.md`

No se modificaron otros archivos de producto.

## Implementación

### Contratos y firewall Zod

- `extractionToolArtifactInputSchema` valida un `JobArtifact` completo en servidor y exige `evidenceId` y `contentSha256` no nulos.
- `factProvenanceSchema` valida todos los campos de `FactProvenanceV1` y rechaza claves adicionales.
- `extractedFactSchema` exige `value`, `state` y al menos una provenance; rechaza estados fuera del contrato.
- `extractionToolOutputSchema` es strict y sólo admite `{ facts: [...] }`.
- El firewall rechaza `outcome`, `suggestedOutcome`, `decision`, `resolution`, `ruleId`, `matchedRule` y `policyDecision` en el output.
- `ExtractionTool` contiene únicamente metadata estable, schemas Zod y `execute`.
- `ExtractionToolContext` contiene `auditId` y modo `SHADOW | BLIND`.

### Evidence reference validation

`validateEvidenceReferences` es una función pura y fail-closed. Para cada provenance:

1. exige que exista el evidence referenciado;
2. si se referencia un artifact, exige que exista y pertenezca al mismo evidence;
3. exige que el evidence pertenezca a la auditoría activa;
4. en modo `BLIND`, sólo admite `documentRole === 'EVIDENCE'`;
5. cuando hay artifact, exige que `artifactHash` coincida con `contentSha256`.

Codes implementados:

- `EVIDENCE_NOT_FOUND`
- `EVIDENCE_AUDIT_MISMATCH`
- `EVIDENCE_HASH_MISMATCH`
- `EVIDENCE_NOT_ALLOWED_BLIND`

### Registry

- `ExtractionToolRegistry` expone `register`, `get`, `list` y `execute`.
- `list` devuelve metadata estable y en orden de registro.
- `execute` valida input antes de invocar el tool y valida output antes de devolverlo.
- El registro duplicado falla con `EXTRACTION_TOOL_DUPLICATE`.
- Un tool inexistente falla con `EXTRACTION_TOOL_NOT_FOUND`.
- Input inválido falla con `EXTRACTION_INPUT_INVALID`.
- Output inválido falla con `EXTRACTION_OUTPUT_INVALID`.
- `createDefaultExtractionToolRegistry` registra únicamente `extract_dates` y `extract_contact_attempts`.

### `extract_dates`

- Sólo inspecciona `artifact.result.extractedFacts`.
- Sólo acepta `factType === 'evidence.date'` o `factType === 'date'`.
- Sólo conserva strings ISO datetime parseables con `Z` u offset.
- No aplica regex sobre texto.
- Sin fechas devuelve `{ facts: [] }`; nunca devuelve `false`.
- Cada fact usa `state: 'OBSERVED'`.
- Cada provenance contiene `evidenceId`, `artifactId`, `artifactHash`, `extractionMethod: 'DETERMINISTIC'`, `extractorId: 'extract_dates'` y `extractorVersion: '1.0.0'`.
- La confianza se conserva sólo cuando es finita y está entre 0 y 1.
- Un artifact sin evidence o hash completo falla con `EXTRACTION_REFERENCE_INCOMPLETE`.

### `extract_contact_attempts`

- Invoca `extractFactsFromArtifacts({ auditId, runId: 'shadow', artifacts: [artifact] })`.
- No duplica regex ni normalización de contactos.
- Reutiliza el fallback de texto y la normalización legacy existentes.
- Filtra exclusivamente `contact.callAttempts` y `contact.writtenInteractions`.
- Excluye otros facts contacts, incluidos `contact.effectiveContact`.
- Conserva `sourceCompleteness: 'UNKNOWN'` y colecciones vacías sin convertirlos en `false`.
- Mapea cada `sourceRef` a `FactProvenanceV1` con método, extractor y versión deterministas.
- Un artifact sin evidence o hash completo falla cerrado.

## TDD RED → GREEN

### Baseline

Comando:

```bash
pnpm --filter @cancelaciones/web test
```

Resultado previo: PASS — 13 archivos, 58 tests, 0 fallos.

### Contracts

RED:

```bash
pnpm --filter @cancelaciones/web exec vitest run src/server/extraction/contracts.test.ts
```

Resultado RED: suite no cargada porque `./contracts` no existía.

GREEN inicial: PASS — 2 tests.

Durante typecheck se detectó que `z.unknown()` hacía opcional `value` en la inferencia del schema. Se añadió una prueba RED que rechazó un fact sin `value`; la prueba falló porque el schema lo aceptaba. El valor pasó a un union JSON-like required y la prueba quedó GREEN.

### Evidence references

RED:

```bash
pnpm --filter @cancelaciones/web exec vitest run src/server/extraction/evidence-reference-validation.test.ts
```

Resultado RED: suite no cargada porque `./evidence-reference-validation` no existía.

GREEN: PASS — 5 casos: not found, audit mismatch, hash mismatch, human blind rejection y referencia permitida.

### Registry

RED inicial:

```bash
pnpm --filter @cancelaciones/web exec vitest run src/server/extraction/registry.test.ts
```

Resultado RED: suite no cargada porque `./registry` no existía.

GREEN del registry genérico: PASS — 4 tests.

RED del factory default: FAIL esperado — `createDefaultExtractionToolRegistry is not a function`.

GREEN final: PASS — 5 tests, incluyendo `get`, `list`, `execute`, default factory, output leak, duplicado y not found.

### `extract_dates`

RED:

```bash
pnpm --filter @cancelaciones/web exec vitest run src/server/extraction/tools/extract-dates.test.ts
```

Resultado RED: suite no cargada porque `./extract-dates` no existía.

GREEN inicial: PASS — 3 tests.

RED de provenance fail-closed: FAIL esperado — un artifact sin evidence/hash resolvía `{ facts: [] }` en vez de rechazar.

GREEN final: PASS — 4 tests.

### `extract_contact_attempts`

RED:

```bash
pnpm --filter @cancelaciones/web exec vitest run src/server/extraction/tools/extract-contact-attempts.test.ts
```

Resultado RED: suite no cargada porque `./extract-contact-attempts` no existía.

GREEN inicial: PASS — 4 tests.

RED de provenance fail-closed: FAIL esperado — un artifact sin evidence/hash producía facts con provenance nula o vacía.

GREEN final: PASS — 5 tests.

## Verificación final

Suite específica:

```bash
pnpm --filter @cancelaciones/web exec vitest run src/server/extraction
```

Resultado: PASS — 5 archivos, 21 tests, 0 fallos.

Suite completa web:

```bash
pnpm --filter @cancelaciones/web test
```

Resultado: PASS — 18 archivos, 79 tests, 0 fallos.

Typecheck:

```bash
pnpm --filter @cancelaciones/web typecheck
```

Resultado: PASS — `tsc --noEmit`, exit code 0.

Lint:

```bash
pnpm --filter @cancelaciones/web lint
```

Resultado: PASS — `eslint . --max-warnings=0`, exit code 0.

## Invariantes verificadas

- Output de tools limitado a `facts` por schema strict.
- Campos normativos y de decisión prohibidos por el firewall.
- `UNKNOWN` y colecciones vacías no se convierten en `false`.
- Provenance incluye evidence, artifact, hash, método, extractor y versión.
- `validateEvidenceReferences` implementa los cuatro códigos requeridos.
- `extract_contact_attempts` reutiliza `extractFactsFromArtifacts` con `runId: 'shadow'`.
- No se copiaron regex ni normalización de contactos.
- No existe import de OpenRouter en `apps/web/src/server/extraction`.
- Las únicas referencias a registry/tools encontradas bajo `apps/web/src` están en sus módulos y tests shadow.
- No hay callers productivos en `apps/web/src/app` ni `apps/web/src/server/jobs`.
- No se añadieron comentarios nuevos al código.
- No se añadieron dependencias.
- No se realizaron commits, push, merge ni PR.

## Concerns

1. No hay bloqueos funcionales, de seguridad ni de tipado conocidos.
2. Vitest/Vite emite el warning preexistente de deprecación del CJS build; no afecta el resultado y no se modificó infraestructura fuera de Task 6.
3. La suite completa conserva stdout esperado de tests legacy que simulan `MODEL_ERROR`; todos finalizaron correctamente.
4. El workspace contiene cambios preexistentes ajenos a Task 6; fueron preservados y no se atribuyen a esta tarea.
5. El harness no expone herramienta de subagentes, por lo que la revisión fue local contra el brief, invariantes, seguridad, alcance y suite completa.

## Fix report — revisión de seguridad y contratos

### Estado

COMPLETADA. Se corrigieron los siete hallazgos manteniendo el scope en `apps/web/src/server/extraction`, sus tests y este reporte. No se añadieron callers productivos, OpenRouter, outcomes, ruleIds, cambios normativos, comentarios ni commits.

### Correcciones

- `ExtractionTool` queda fijado a `ExtractionToolOutputV1`; el registry rechaza en runtime schemas con `facts` más cualquiera de `outcome`, `suggestedOutcome`, `decision`, `resolution`, `ruleId`, `matchedRule` o `policyDecision`, y valida el output contra el schema canónico.
- `ExtractionToolContext` incorpora `evidences`, `artifacts` y `allowedEvidenceIds`. El registry ejecuta `validateEvidenceReferences` después de ejecutar el tool; los tools directos llaman el mismo helper antes de retornar.
- La validación cubre referencias en blanco, allowlist, existencia, auditoría, artifact asociado, rol `BLIND`, artifact completo y hash. `artifactHash` sin `artifactId` se rechaza con `EVIDENCE_REFERENCE_INCOMPLETE`.
- `extract_contact_attempts` exige que cada `sourceRef` coincida con evidence, artifact y hash; no usa fallback. Sin events ni count observado emite `state: UNKNOWN` y `sourceCompleteness: UNKNOWN`, nunca `COMPLETE` vacío.
- El registry clona y congela tools/metadata; `get` devuelve una copia congelada y `list` devuelve metadata congelada.
- `extract_dates` acepta date-only ISO `YYYY-MM-DD` y datetimes ISO con offset.
- Se añadieron pruebas específicas para cada regla, incluyendo los siete sentinels normativos, allowlist/blank/hash huérfano, segunda barrera, schema débil, inmutabilidad, sourceRef/contexto, estado `UNKNOWN` y fechas date-only.

### Verificación

- Extracción: PASS — 5 archivos, 28 tests.
- Web test: PASS — 18 archivos, 86 tests.
- Web typecheck: PASS — `tsc --noEmit`.
- Web lint: PASS — `eslint . --max-warnings=0`.
- Concerns: permanece únicamente el warning preexistente de deprecación del build CJS de Vite; los cambios preexistentes ajenos a Task 6 fueron preservados.

## Fix report — revisión final del reviewer

### Estado

COMPLETADA. Se corrigieron los hallazgos solicitados sin modificar el normative engine, callers productivos, dependencias ni infrastructure.

### Correcciones

- Se creó `validateExtractionArtifactInput(artifact, context)` como helper compartido. `registry.execute` lo ejecuta antes de validar el input cuando existe `artifact`, y ambos tools lo ejecutan antes de leer `artifact.result`.
- El helper valida evidencia existente, artifact asociado, pertenencia a la auditoría, allowlist, rol en modo `BLIND` y hash, incluso cuando el resultado final es `{ facts: [] }`.
- El firewall Zod rechaza recursivamente `outcome`, `suggestedOutcome`, `decision`, `resolution`, `ruleId`, `matchedRule` y `policyDecision` dentro de `value`, incluyendo objetos, arrays y records anidados.
- El registro valida en runtime `id`, `version`, `inputSchemaVersion`, `outputSchemaVersion`, `deterministic` y que ambos schemas sean instancias Zod antes de registrar.
- Los schemas Zod no se mutan ni se congelan; se conservan por identidad dentro de wrappers congelados y clones de metadata estables.

### Pruebas añadidas

- Valores normativos anidados en objetos, arrays y records.
- Metadata runtime inválida para identificadores, versiones, `deterministic` y schemas.
- Artifact humano, artifact de otra auditoría y artifact fuera de allowlist con `facts` vacío, tanto en registry como en cada tool directo.
- Preservación de identidad de schemas y estabilidad de metadata frente a mutación del tool original.

### Verificación final

- Extracción: PASS — 5 archivos, 33 tests.
- Web: PASS — 18 archivos, 91 tests.
- Workspace typecheck: PASS — 5 proyectos.
- Workspace lint: PASS — 5 proyectos.
- `git diff --check`: PASS.

### Concerns

1. Vitest/Vite mantiene el warning preexistente de deprecación del build CJS.
2. El workspace conserva cambios preexistentes ajenos a Task 6.
3. No se realizaron commits, push, merge ni PR.

## Fix report — validación runtime del modo de extracción

### Estado

COMPLETADA. La validación de referencias, la validación del artifact de entrada y la validación de referencias del output rechazan en runtime cualquier modo distinto de `SHADOW` o `BLIND` con `EXTRACTION_CONTEXT_INVALID`.

### Correcciones

- Se añadió una única función runtime fail-closed para validar el modo.
- `validateEvidenceReferences` valida el modo antes de procesar referencias.
- `validateExtractionArtifactInput` y `validateExtractionToolOutputReferences` validan el modo antes de leer artifacts o facts.
- `ExtractionToolRegistry.execute` valida el modo antes de invocar cualquier tool, incluso cuando la entrada no contiene artifact.
- Se añadieron pruebas para `PROD` y `LEGACY` en las tres barreras y para verificar que el tool no se ejecuta con contexto inválido.

### Verificación

- Extracción: PASS — 5 archivos, 35 tests.
- Web: PASS — 18 archivos, 93 tests.
- Web typecheck: PASS — `tsc --noEmit`.
- Web lint: PASS — `eslint . --max-warnings=0`.

### Alcance

- No se modificó otra lógica de extracción, normativo, dependencias o callers productivos.
- No se añadieron comentarios al código.
- No se realizaron commits, push, merge ni PR.

