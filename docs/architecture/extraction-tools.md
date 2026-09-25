# Herramientas de extracción: contrato, registro y frontera

> **ESTADO: exactamente dos herramientas registradas, ambas `SHADOW` /
> `TEST ONLY`, y con CERO llamadores productivos.**
> `createDefaultExtractionToolRegistry` no se invoca desde
> `apps/web/src/app` ni desde `apps/web/src/server/jobs`: los únicos imports del
> registry en todo el repositorio están en su propio test
> (`apps/web/src/server/extraction/registry.test.ts:6,135,212`). Este documento
> describe una **frontera construida y probada, no un pipeline en producción**.
>
> El pipeline de extracción con LLM es una **frontera descrita y deliberadamente
> no conectada** (§7). No hay ningún extractor que llame a un modelo.

---

## 1. Para qué existe esta capa

`AGENTS.md` fija dos invariantes que parecen incompatibles y no lo son:

- `AI_EXTRACTS`: la IA **clasifica, lee, transcribe y estructura** evidencia.
- `POLICY_ENGINE_DECIDES`: el motor normativo **aplica reglas oficiales** con
  datos estructurados.

La capa de extracción es donde se hace cumplir la frontera. Su trabajo es
convertir artefactos brutos en **hechos con procedencia verificable**, y nada
más. No sabe qué reglas existen, no sabe qué outcomes hay, y no puede saberlo:
eso está prohibido por contrato, no por convención (§5).

Archivos de la capa:

| Archivo | Responsabilidad |
|---|---|
| `apps/web/src/server/extraction/contracts.ts` | Tipos del contrato, schemas Zod, firewall recursivo |
| `apps/web/src/server/extraction/registry.ts` | Registro, validación en el registro, pipeline de `execute` |
| `apps/web/src/server/extraction/evidence-reference-validation.ts` | Segunda barrera: toda referencia debe ser real, permitted y coherente |
| `apps/web/src/server/extraction/tools/extract-dates.ts` | Herramienta `extract_dates` |
| `apps/web/src/server/extraction/tools/extract-contact-attempts.ts` | Herramienta `extract_contact_attempts` |

Tipos de dominio compartidos (paquete `@cancelaciones/domain`):
`ExtractedFactV1`, `ExtractionToolOutputV1`, `FactProvenanceV1`, `FactState`,
`ExtractionMethod` en `packages/domain/src/policy-foundation.ts`.

---

## 2. El contrato `ExtractionTool<TInput>`

Definido en `contracts.ts:93-102`. Una herramienta declara **ocho** cosas:

| Campo | Tipo | Qué obliga |
|---|---|---|
| `id` | `string` | Identidad estable. El registro rechaza duplicados con `EXTRACTION_TOOL_DUPLICATE`. |
| `version` | `string` | Versión de la implementación. Es lo que entra en la `provenance` de cada hecho. |
| `inputSchemaVersion` | `string` | Versión del **contrato de entrada**, independiente de la implementación: subir `version` no rompe a un consumidor que ya validó. |
| `outputSchemaVersion` | `string` | Ídem para la salida. |
| `deterministic` | `boolean` | Si es `true`, la misma entrada y el mismo contexto producen la misma salida. **Ambas herramientas registradas lo son.** Un extractor con LLM tendría aquí `false`. |
| `inputSchema` | `z.ZodType<TInput>` | Valida y **transforma** la entrada antes de ejecutar. |
| `outputSchema` | `z.ZodType<ExtractionToolOutputV1>` | Valida la salida. Además, el registro lo **inspecciona** para rechazar cualquier schema que permita campos normativos (§5). |
| `execute` | `(input, context) => Promise<ExtractionToolOutputV1>` | La lógica. Recibe la entrada ya validada por `inputSchema` y un `ExtractionToolContext`. |

`ExtractionToolContext` (`contracts.ts:85-91`) lleva:

```ts
{ auditId: string; mode: 'SHADOW' | 'BLIND'; evidences: readonly EvidenceReferenceEvidence[];
  artifacts: readonly JobArtifact[]; allowedEvidenceIds: readonly string[] }
```

`mode` es validado antes de cualquier otra cosa por `validateExtractionMode`
(`evidence-reference-validation.ts:43`), que lanza `EXTRACTION_CONTEXT_INVALID`
si no es exactamente `'SHADOW'` o `'BLIND'`. No existe `'PROD'`. El test *"rechaza
en runtime los modos PROD e inválido en las tres barreras"* lo afirma.

Los cinco campos de metadata (`id`, `version`, `inputSchemaVersion`,
`outputSchemaVersion`, `deterministic`) se validan en el registro
(`validateToolMetadata`, `registry.ts:86`): si alguno no es un string no vacío,
o `deterministic` no es booleano, o alguno de los dos schemas no es una
instancia de `z.ZodType`, el registro lanza
`EXTRACTION_TOOL_METADATA_INVALID` **antes** de guardar nada.

---

## 3. El registro: `ExtractionToolRegistry`

`createExtractionToolRegistry(tools)` devuelve cuatro operaciones
(`registry.ts:121-166`). `createDefaultExtractionToolRegistry()` lo construye con
los dos tools por defecto.

### `register(tool)`

1. `registeredTool()` valida metadata (§2) e inspecciona el `outputSchema`
   (§5). Si algo falla, **no** se inserta nada.
2. `EXTRACTION_TOOL_DUPLICATE` si el `id` ya está registrado.
3. Congela el tool y su metadata con `Object.freeze`.

### `get<TInput>(id)`

Devuelve una **copia congelada** del tool, no la referencia registrada
(`registry.ts:134-138`). Consecuencia observable: el test
*"registra por defecto únicamente los tools shadow…"* afirma
`expect(registry.get('extract_dates')).not.toBe(extractDatesTool)`. Nadie puede
mutar un tool registrado por la vía del registro.

`EXTRACTION_TOOL_NOT_FOUND` si el `id` no existe. **No hay valor por defecto ni
tool genérico**: un `id` desconocido es un error, no un `undefined` silencioso.

### `list()`

Devuelve **sólo** `ExtractionToolMetadata[]`: `{ id, version, inputSchemaVersion,
outputSchemaVersion, deterministic }`, cada objeto congelado. No expone schemas
ni `execute`. Es la superficie de introspección: se puede ver qué herramientas
existen y con qué versión sin poder invocarlas.

### `execute(id, input, context)`

El pipeline completo, en orden. **Cada paso puede abortar:**

1. `EXTRACTION_TOOL_NOT_FOUND` si el `id` no está registrado.
2. `validateExtractionMode(context.mode)` → `EXTRACTION_CONTEXT_INVALID`.
3. Si la entrada tiene forma `{ artifact }`:
   `validateExtractionArtifactInput(artifact, context)` → así el artefacto se
   valida **antes** de que el tool llegue a leer `artifact.result`.
4. `entry.inputSchema.safeParse(input)` → `EXTRACTION_INPUT_INVALID` si falla.
5. `await entry.execute(parsedInput.data, context)`. Ojo: se pasa **`parsedInput.data`**,
   no la entrada cruda: el schema no sólo valida, también normaliza.
6. `entry.outputSchema.safeParse(output)` → `EXTRACTION_OUTPUT_INVALID`.
7. `extractionToolOutputSchema.safeParse(parsedOutput.data)` — **el schema
   canónico**, el mismo para todas las herramientas → `EXTRACTION_OUTPUT_INVALID`.
   Esta segunda pasada es lo que hace que el firewall recursivo del §5 aplique
   igual a un tool que declare un schema más laxo.
8. `validateExtractionToolOutputReferences(canonicalOutput.data, context)` →
   `EXTRACTION_REFERENCE_INVALID` (§6).
9. Devuelve `canonicalOutput.data`, es decir **la salida ya revalidada**, no la
   que devolvió el tool.

El paso 7 tiene además un test dedicado: *"rechaza un schema de output que no
valida facts canónicos"* muestra que un tool con un `outputSchema` propio pero
incompleto **no** puede saltarse el schema canónico registrando su salida.

---

## 4. El schema de salida: sólo `{ facts }`

`extractionToolOutputSchema` (`contracts.ts:73-79`):

```ts
z.object({ facts: z.array(extractedFactSchema) }).strict().superRefine(…)
```

- `.strict()`: cualquier clave distinta de `facts` hace el parseo **fallar**.
  Una herramienta no puede devolver metadatos, puntuaciones, resúmenes ni
  diagnósticos junto a los hechos. Un campo extra es un error, no un campo
  ignorado.
- `extractedFactSchema` (`contracts.ts:65-71`) también es `.strict()`:
  ```
  factType   z.string().min(1)
  value      string | number | boolean | null | unknown[] | Record<string, unknown>
  state      'OBSERVED' | 'INFERRED' | 'UNKNOWN' | 'CONTRADICTORY'
  confidence z.number().min(0).max(1)  (opcional)
  provenance array de factProvenanceSchema, min 1
  ```
- `value` admite `null` a propósito. `UNKNOWN_IS_NOT_FALSE`: la ausencia de un
  valor es un valor distinto de `false`, y el tipo lo tiene que permitir.

Tests que lo fijan: *"acepta exclusivamente un contenedor de facts"* y
*"rechaza input y output que no pasan sus schemas"*.

---

## 5. El firewall recursivo: siete campos normativos prohibidos

`forbiddenValueFields` (`contracts.ts:32`) define exactamente siete claves:

```
outcome
suggestedOutcome
decision
resolution
ruleId
matchedRule
policyDecision
```

### 5.1 Primera barrera: sobre los **valores**, a cualquier profundidad

`extractionToolOutputSchema.superRefine` corre `addForbiddenValueIssues` sobre
cada `fact.value` (`contracts.ts:75-79`). Esa función:

1. Si el valor es un array, itera sus índices.
2. Si es un objeto, itera **todas** sus claves.
3. Si alguna clave está en el conjunto prohibido, añade un
   `z.ZodIssueCode.custom` con `message: 'Forbidden normative field'` y el `path`
   exacto donde apareció.
4. **Recursiona dentro del valor encontrado**, y lleva un `seen: Set<object>` para
   no ciclar ante referencias circulares.

Consecuencia: `value: { a: { b: { ruleId: 'GDM-V5-5.2-A' } } }` **falla**, y
`value: { a: [{ outcome: 'CANCELACION_VENTA' }] }` **también falla**. No hay
profundidad máxima.

Test: *"rechaza campos normativos anidados en values, arrays y records"*.

### 5.2 Segunda barrera: en el **schema**, en tiempo de registro

Un tool podría declarar un `outputSchema` que acepte `outcome` en la raíz. El
registro lo detecta sin ejecutar nada: `validateOutputSchema` (`registry.ts:76`)
recorre los siete campos y, para cada uno, llama a `schemaAllowsField`
(`registry.ts:61`), que inspecciona el árbol interno del schema de Zod probando un
objeto centinela `{ facts: [], <campo>: 'SENTINEL' }` y, si eso no basta,
recorriendo `_def`: `shape()`, `unknownKeys`, `catchall`, `options`, `schema`,
`innerType`, `out`, `type`, recursivamente.

Si algún schema permite alguno de los siete campos →
`EXTRACTION_OUTPUT_SCHEMA_INVALID`, y el tool **no se registra**.

Test: *"rechaza en runtime schemas que permiten campos normativos"*.

El punto de este doble mecanismo es que el registro no confía en que el tool se
comporte bien. Un schema declarativo que admita un campo normativo es un
defecto de diseño detectable sin ejecutarlo, y por eso se detecta en
`register()` y no en el primer `execute()`.

---

## 6. La segunda barrera: validación de referencias a evidencia

`validateEvidenceReferences` (`evidence-reference-validation.ts:49`) recibe
`{ auditId, mode, references, evidences, artifacts, allowedEvidenceIds }` y
devuelve una lista de errores — **no lanza**. Quien llama decide. Los códigos
son estables:

| Código | Condición |
|---|---|
| `EVIDENCE_REFERENCE_INCOMPLETE` | `evidenceId` en blanco; o `artifactHash` sin `artifactId`; o `artifactId` sin `artifactHash` |
| `EVIDENCE_NOT_ALLOWED` | `evidenceId` no está en `allowedEvidenceIds` |
| `EVIDENCE_NOT_FOUND` | la evidencia no existe, o el artefacto no existe, o `artifact.evidenceId !== reference.evidenceId` |
| `EVIDENCE_AUDIT_MISMATCH` | `evidence.auditId !== auditId` |
| `EVIDENCE_NOT_ALLOWED_BLIND` | en modo `BLIND`, `evidence.documentRole !== 'EVIDENCE'` |
| `EVIDENCE_HASH_MISMATCH` | `reference.artifactHash !== artifact.contentSha256` |

La aserción sobre el orden es que **`allowedEvidenceIds` va primero** y la
comprobación de existencia va después: una referencia que no está en la
allowlist se rechaza como *no permitida*, no como *no encontrada*. La
distinción importa en un diagnóstico, y sobre todo impide que la existencia de un
objeto valga como autorización.

Dos envoltorios lanzan si hay errores:

- `validateExtractionArtifactInput(artifact, context)` — valida la forma del
  artefacto (`id`, `evidenceId`, `contentSha256` no vacíos; si no,
  `EXTRACTION_REFERENCE_INCOMPLETE`) y luego sus referencias. La usa `execute`
  antes de invocar el tool, y también la usan las dos herramientas por dentro
  (redundancia deliberada: la herramienta sigue siendo segura si alguien la
  llama directamente, sin pasar por el registro).
- `validateExtractionToolOutputReferences(output, context)` — aplana
  `output.facts.flatMap(f => f.provenance)` y valida cada entrada. Si hay
  cualquier error → `EXTRACTION_REFERENCE_INVALID`.

Ambas se llaman en los dos sitios: `execute` valida la salida, y cada tool
también valida la suya. Un tool que no valide sus propias referencias no puede
producir evidencia más débil que un tool que sí lo haga, porque el registro
vuelve a validar.

Test: *"falla la segunda barrera si el output referencia evidencia no permitida"*.

---

## 7. Provenance: qué tiene que rellenar un tool

`factProvenanceSchema` (`contracts.ts:18-30`), `.strict()`, por cada hecho:

| Campo | Regla | Por qué |
|---|---|---|
| `evidenceId` | `z.string().min(1)` — **obligatorio** | Sin evidencia no hay hecho. No hay valor por defecto. |
| `artifactId` | `z.string().min(1)` opcional | Qué artefacto concreto. |
| `artifactHash` | `z.string().min(1)` opcional | Hash del artefacto. Si aparece, la segunda barrera exige que coincida con `artifact.contentSha256`. |
| `page` | entero positivo opcional | Ubicación en el documento. |
| `startTimestamp` / `endTimestamp` | no negativos opcionales | Ventana temporal de la evidencia. |
| `sourceText` | `string` opcional | Texto fuente. |
| `extractionMethod` | `'DETERMINISTIC' \| 'LLM' \| 'HUMAN' \| 'IMPORTED'` — **obligatorio** | Cómo se obtuvo. Es lo que separa un regex de un modelo. |
| `extractorId` | `z.string().min(1)` — **obligatorio** | Qué componente. |
| `extractorVersion` | `z.string().min(1)` — **obligatorio** | Qué versión de ese componente. |
| `confidence` | número en `[0,1]` opcional | **Confianza de la extracción**, no de la decisión. Ver §8. |

Y `provenance` es `z.array(factProvenanceSchema).min(1)`: **al menos una**
entrada por hecho. Un hecho sin procedencia no pasa el schema.

`validExtractionConfidence(value)` (`contracts.ts:81`) es el único punto de
entrada para la confianza: devuelve `undefined` si no es un número finito en
`[0,1]`. Ambas herramientas lo usan, de modo que una confianza fuera de rango
**desaparece** en vez de propagarse como un número basura. El campo `confidence`
del schema y el de la `provenance` son el mismo valor, y ambos son opcionales
para que "no se pudo cuantificar" sea distinto de "cero confianza".

Test: *"exige provenance completa para cada fact"*.

---

## 8. `UNKNOWN` se preserva, no se convierte en `false`

`FactState` (`packages/domain/src/policy-foundation.ts:1`) tiene cuatro valores:
`OBSERVED`, `INFERRED`, `UNKNOWN`, `CONTRADICTORY`. Los cuatro son de primera
clase en el schema, y `false` **no** es un valor de `state`: es un `value`
legítimo de un hecho `OBSERVED`.

El caso concreto está en `extract_contact_attempts` (`extract-contact-attempts.ts:50-73`):

```ts
const observed = … rawValue.value;
const noEvidenceOfContact = !hasEvents(fact.value) && !hasObservedCount(observed);
const value = noEvidenceOfContact && isRecord(fact.value)
  ? { ...fact.value, sourceCompleteness: 'UNKNOWN' }
  : fact.value;
…
state: noEvidenceOfContact ? 'UNKNOWN' : 'OBSERVED',
```

Es decir: si no hay eventos **y** no hay conteo observado, la herramienta **no**
emite "no hubo contacto". Emite `state: 'UNKNOWN'` y marca
`sourceCompleteness: 'UNKNOWN'`. La distinción es la que permite que el motor
normativo devuelva `UNKNOWN` para la condición en vez de `FALSE` — que es
precisamente lo que hacen los casos `unknown-contact-collections` y
`partial-contact-collections` del Golden Master.

El Golden Master bloquea ese comportamiento: en
`partial-contact-collections`, los hechos llevan
`sourceCompleteness: 'PARTIAL'` y las reglas 5.2 salen **`UNKNOWN`**, no
`FALSE`, aunque el `observedCount` llegue al umbral. Si la extracción
convirtiera `PARTIAL` en `FALSE`, ese caso del corpus fallaría.

`extract_dates` es aún más conservadora: si el valor candidato no es una fecha
ISO válida, simplemente **no emite el hecho** (`continue`). Un hecho que no se
puede fechar no se afirma; se omite. Y el estado que emite es siempre
`'OBSERVED'`, porque una fecha ISO parseada sí es una observación directa.

---

## 9. Las dos herramientas que existen

`createDefaultExtractionToolRegistry()` (`registry.ts:168-170`) registra
exactamente dos, en este orden:

### `extract_dates` (`tools/extract-dates.ts`)

- `id: 'extract_dates'`, `version: '1.0.0'`, `inputSchemaVersion: '1.0.0'`,
  `outputSchemaVersion: '1.0.0'`, **`deterministic: true`**.
- `inputSchema: extractionToolArtifactInputSchema` — exige
  `{ artifact: { id, jobId, evidenceId, artifactType, result, contentSha256, createdAt } }`,
  `.strict()`, con un `.refine()` que **rechaza** el artefacto si
  `evidenceId === null` **o** `contentSha256 === null`.
- Recorre `artifact.result.extractedFacts`, se queda con los `factType`
  `'evidence.date'` o `'date'` cuyo `value` sea una fecha ISO
  (`z.string().datetime({ offset: true })` o `YYYY-MM-DD`), y emite
  `{ factType, value, state: 'OBSERVED', confidence?, provenance: [...] }`.
- No inventa nada: si el artefacto no trae candidatos, devuelve `facts: []`.

### `extract_contact_attempts` (`tools/extract-contact-attempts.ts`)

- Misma metadata: `version: '1.0.0'`, **`deterministic: true`**.
- Delegando en `extractFactsFromArtifacts` (`apps/web/src/server/facts/extract.ts`)
  sobre un único artefacto, con `runId: 'shadow'`.
- Se queda con `contact.callAttempts` y `contact.writtenInteractions`.
- **Verificación cruzada obligatoria**: `sourceMatchesArtifact(fact.sourceRef,
  artifact)` compara `evidenceId`, `artifactId` **y** `sha256` contra el
  artefacto; si no coinciden lanza `EXTRACTION_REFERENCE_INVALID`. Es decir, si
  el extractor delegado atriburiera un hecho a otro artefacto, la herramienta
  **falla** en vez de emitir la referencia equivocada.
- Aplica el tratamiento de `UNKNOWN` del §8.

Test que fija el inventario por defecto: *"registra por defecto únicamente los
tools shadow extract_dates y extract_contact_attempts"* — el `list()` esperado es
exactamente

```json
[{ "id": "extract_dates",             "version": "1.0.0", "inputSchemaVersion": "1.0.0", "outputSchemaVersion": "1.0.0", "deterministic": true },
 { "id": "extract_contact_attempts",  "version": "1.0.0", "inputSchemaVersion": "1.0.0", "outputSchemaVersion": "1.0.0", "deterministic": true }]
```

### 9.1 Por qué son `SHADOW` / `TEST ONLY`

Tres razones concretas, verificables en el repositorio:

1. **Sin llamadores productivos.** `git grep createDefaultExtractionToolRegistry`
   devuelve tres coincidencias y las tres están en
   `apps/web/src/server/extraction/registry.test.ts`. No hay ningún `import` desde
   `apps/web/src/app` ni desde `apps/web/src/server/jobs`.
2. **No están en el pipeline de jobs.** `apps/web/src/server/jobs/handlers.ts`
   extrae con `createFactRepository.insertFacts` y `extractFactsFromArtifacts`,
   no con el registry. Son dos caminos distintos y el registry no participa en
   el que corre hoy.
3. **El modo por defecto documentado es `SHADOW`.** Los tests ejecutan siempre con
   `mode: 'SHADOW'`. `BLIND` está soportado por los contratos
   (`EvidenceReferenceEvidence` y el contexto), pero no hay ningún flujo que lo
   ejercite a través del registry.

Consecuencia: las garantías del §3, §4, §5 y §6 están **probadas contra un
contexto de test**, no demostradas en producción. Escriben "el contrato obliga",
que es distinto de "el sistema en producción lo cumple".

---

## 10. El futuro pipeline de extracción con LLM: frontera descrita, no conectada

Este apartado describe lo que **se necesitaría** si mañana el propietario
decidiera que la extracción debe usar un modelo. **Nada de esto existe.**

### 10.1 Lo que ya está del lado del modelo

Existe `apps/web/src/server/ai/openrouter.ts` con `requestStructuredCompletion`
y `parseJsonFromCompletion`, y está en uso por el reasoner ciego
(`apps/web/src/server/policy/reasoner.ts`), el servicio de decisión humana
(`apps/web/src/server/human-decision/service.ts`), reconciliación
(`apps/web/src/server/reconciliation/service.ts`) y un `fetch` directo en
`apps/web/src/server/jobs/handlers.ts:125`. Ese cliente es **otro** camino de IA,
no el de extracción: no produce `ExtractedFactV1` y no pasa por el registry.

### 10.2 Cómo se conectaría, y qué habría que añadir

Un extractor con LLM sería un `ExtractionTool<TInput>` más, con una diferencia
obligatoria: **`deterministic: false`**. El resto del contrato no cambia. Eso es
todo lo que la arquitectura obliga a cambiar.

Lo que la frontera **no** permitiría, y por diseño:

| Regla | Consecuencia para un extractor con LLM |
|---|---|
| `outputSchema` es `ExtractionToolOutputV1` y es `.strict()` | No puede devolver texto libre, ni razonamiento, ni un outcome "sugerido". |
| Los siete campos normativos están prohibidos a cualquier profundidad en `value` | No puede colar `suggestedOutcome` "como un dato más". |
| `provenance` con `min(1)` y `extractorId` + `extractorVersion` obligatorios | Cada hecho debe decir qué modelo y qué versión lo produjo. |
| `extractionMethod` es `'DETERMINISTIC' \| 'LLM' \| 'HUMAN' \| 'IMPORTED'` | El hecho declara que vino de un modelo. Es un hecho auditable, no una caja negra. |
| `execute` valida entrada, salida y referencias a evidencia en el mismo orden | Un LLM no puede citar evidencia inventada: la segunda barrera no distingue entre quien produce la referencia y quien la consume. |
| `mode` sólo es `'SHADOW'` o `'BLIND'` | No hay un modo "productivo con modelo" que se salte la sanitización ciega. |

### 10.3 Lo que haría falta y **no** está hecho

- Un módulo extractor que hable con el cliente de completion y construya
  `ExtractedFactV1`. **No existe.**
- `deterministic: false` y todo lo que eso implica en el resto del sistema: un
  `factsFingerprint` ya no es reproducible entre ejecuciones, y el Golden Master
  y la idempotencia de `engine_runs` asumen que sí. Habría que decidir cómo se
  registra eso.
- Un modo de procedencia para distinguir "corrida determinista" de "corrida con
  modelo" en la `provenance` del snapshot congelado. `FactProvenanceEntry`
  (`apps/web/src/server/facts/fact-run-snapshot.ts:59`) tiene hoy
  `extractionMethod: 'AI' | 'HUMAN' | 'IMPORTED' | 'UNKNOWN'`, pero **no**
  distingue dos extractores de IA distintos.
- Wiring al pipeline de jobs. **No existe.**

### 10.4 `DO_NOT_DUPLICATE_IMPLEMENTATIONS`

`extract_contact_attempts` delega en `extractFactsFromArtifacts`, que es la
misma función que usa el pipeline de jobs. Es una decisión deliberada y
correcta: una sola implementación de "qué hechos de contacto hay en este
artefacto", usada por los dos caminos, con la diferencia de que la herramienta la
envuelve en el contrato `ExtractionTool` y la herramienta añade la verificación
cruzada de `sourceRef` y el tratamiento de `UNKNOWN` que el pipeline directo no
hace. Lo que **no** se ha hecho es duplicar la lógica de extracción: si mañana
se cambiara la extracción de contactos, cambiaría en un solo sitio y el registry
la seguiría exponiendo igual.

---

## 11. Resumen

| Afirmación | Mecanismo | Estado |
|---|---|---|
| Un tool declara 8 campos, validados en el registro | `ExtractionTool` + `validateToolMetadata` | activo, verificado por test |
| La salida sólo puede ser `{ facts }` | `extractionToolOutputSchema.strict()` | activo, verificado por test |
| Ningún hecho puede llevar `outcome`/`decision`/`ruleId`/… a ninguna profundidad | `addForbiddenValueIssues` recursivo | activo, verificado por test |
| Un schema que admita campos normativos no se registra | `validateOutputSchema` + `schemaAllowsField` en `register()` | activo, verificado por test |
| Toda referencia debe existir, estar permitida, ser de esta auditoría y tener el hash correcto | `validateEvidenceReferences` | activo, verificado por test |
| En modo `BLIND` sólo se admite `documentRole === 'EVIDENCE'` | `EVIDENCE_NOT_ALLOWED_BLIND` | activo, verificado por test |
| Cada hecho declara de dónde viene, con extractor y versión | `factProvenanceSchema` con `min(1)` | activo, verificado por test |
| La ausencia de evidencia se preserva como `UNKNOWN`, no como `false` | `state: 'UNKNOWN'` + `sourceCompleteness: 'UNKNOWN'` | activo, verificado por test y bloqueado por el Golden Master |
| Existen exactamente dos herramientas, ambas `deterministic: true` | `createDefaultExtractionToolRegistry` | activo |
| Hay un pipeline de extracción con LLM | — | **no existe**; frontera descrita en §10 |
| Las herramientas de extracción se usan en producción | — | **no**: cero llamadores fuera de sus tests |
| `mode: 'PROD'` | — | **no existe por diseño**; sólo `SHADOW` y `BLIND` |
