# Golden Master: congelar el comportamiento actual del motor

> **Lo que este corpus es:** un bloqueo de **comportamiento actual** de
> `evaluatePolicy`. No es verdad normativa, no es una lista de casos históricos
> validados, y no pretende serlo.
>
> **Lo que NO es, y no debe convertirse:** un golden case normativo. Por
> `AGENTS.md`, *"Los casos historicos solo pueden ser golden case si se validan
> explicitamente contra la fuente normativa"*. **Ninguno de los 12 casos ha sido
> validado contra el documento oficial firmado por el propietario.** Todos
> declaran `metadata: { synthetic: true, notes: 'Behavior lock; not normative
> truth.' }` en su propia definición
> (`packages/policy-engine/src/golden-master-cases.ts:19`). La fuente normativa
> local `GDM_GAM_PRD_MLG_003` sigue en estado `PENDING_VERIFICATION` y **no**
> puede marcarse `CANONICAL` hasta que el propietario la verifique contra el
> original.

---

## 1. Las tres piezas

| Pieza | Ruta | Función |
|---|---|---|
| Definición de casos | `packages/policy-engine/src/golden-master-cases.ts` | 12 casos: `input` (hechos sintéticos), `inputFingerprint`, `expectedFingerprint`, `metadata` |
| Fixture de expectativas | `packages/policy-engine/src/testdata/golden-master-v1.json` | Por nombre de caso, el `PolicyEvaluation` completo esperado |
| Test | `packages/policy-engine/src/golden-master.test.ts` | Compara `evaluatePolicy(case.input)` contra la fixture y verifica las dos huellas |

El test hace tres cosas por caso, y las tres importan:

```ts
const actual = evaluatePolicy(testCase.input);
expect(actual).toEqual(expected[testCase.name]);
expect(createHash('sha256').update(canonicalFingerprintV1(testCase.input.facts)).digest('hex'))
  .toBe(testCase.inputFingerprint);
expect(createHash('sha256').update(canonicalFingerprintV1(actual)).digest('hex'))
  .toBe(testCase.expectedFingerprint);
```

1. **Igualdad profunda** del `PolicyEvaluation` completo contra la fixture. Esto
   cubre `suggestedOutcome`, `outcomeStatus`, `decisionStatus`, `satisfiedRules`,
   `unknownRules`, `notApplicableRules`, `missingData`, `conflicts`, `exclusions`,
   `missingEvidence`, `missingFacts`, `missingNormativeSources`,
   `softwareCoverageGaps`, `nextActions`, `explanation`, `trace` y las 3 reglas
   evaluadas con sus condiciones, estados, `factIds` y `evidenceRefs`.
2. **La huella de la entrada**: `sha256(canonicalFingerprintV1(case.input.facts))`
   debe ser `case.inputFingerprint`. Detecta que el caso cambió aunque la
   evaluación no se moviera.
3. **La huella de la salida**: `sha256(canonicalFingerprintV1(actual))` debe ser
   `case.expectedFingerprint`. Detecta que cambió la evaluación aunque el
   `toEqual` pasara por alguna razón que no consideremos.

Y hay un test adicional, independiente del bucle:

```ts
it('mantiene exactamente las claves de goldenCases en la fixture', () => {
  expect(Object.keys(expected).sort()).toEqual(goldenCases.map(c => c.name).sort());
});
```

Falla si se **añade** un caso a `golden-master-cases.ts` sin añadir su entrada a
la fixture, **y también** si se añade una entrada a la fixture sin su caso. El
corpus no puede crecer por un lado sólo.

**Total: 13 tests** (1 de integridad del corpus + 12 de caso).

---

## 2. Los 12 casos

Todos con `policyCode: 'GDM_GAM_PRD_MLG_003'`, `policyVersion: '5'` y hechos
sintéticos con `source: { evidenceId: 'synthetic-evidence' }`,
`extractionConfidence: 1` y prefijo de id `synthetic-`.

| # | Nombre | Hechos de entrada | Qué bloquea |
|---|---|---|---|
| 1 | `complete-licenciatura` | 8 hechos: 16 llamadas, 10 escritas, `contact.effectiveContact: false`, `student.level: LICENCIATURA`, sin login, sin modalidad, sin actividades, sin calificaciones | El camino de outcome completo: 5.2 `SATISFIED`, 5.7.e `NOT_SATISFIED`, 5.8.a `SATISFIED` con `outcomeEffect: CANCELACION_VENTA` → `suggestedOutcome: 'CANCELACION_VENTA'`, `outcomeStatus: 'DETERMINED'`, `decisionStatus: 'READY_TO_APPROVE'`, `reviewRequired: false` |
| 2 | `missing-all-facts` | `[]` (array vacío) | `factsFingerprint: '[]'`, todas las reglas `UNKNOWN`, `suggestedOutcome: null`, `outcomeStatus: 'INDETERMINATE'`, `decisionStatus: 'INDETERMINATE'`, `reviewRequired: true`, 5 `nextActions` `UPLOAD_EVIDENCE`. **Es el caso que bloquea `UNKNOWN_IS_NOT_FALSE`.** |
| 3 | `partial-contact-collections` | 2 hechos: `contact.callAttempts` y `contact.writtenInteractions` con `sourceCompleteness: 'PARTIAL'`, `observedCount: 16` y `6` | Que `PARTIAL` produzca **`UNKNOWN`**, no `FALSE`, aunque el `observedCount` alcance el umbral. 5.2 `UNKNOWN`, 5.7.e y 5.8.a `UNKNOWN` |
| 4 | `unknown-academic-level` | 4 hechos: 16 llamadas, 10 escritas, `contact.effectiveContact: false`, sin actividades (sin `student.level`) | La rama `GDM-V5-5.8-A-ACADEMIC-LEVEL-UNKNOWN` con la condición `academic-level-unknown` en `UNKNOWN`. Bloquea que la falta de nivel se resuelva por defecto a una rama |
| 5 | `non-licenciatura` | 6 hechos: 16 llamadas, 10 escritas, `contact.effectiveContact: false`, `student.level: POSGRADO`, sin actividades, sin calificaciones | La rama `GDM-V5-5.8-A-NON-LICIENCIATURA` con la condición `non-licenciatura-no-activity` |
| 6 | `grades-observed` | 6 hechos: `contact.effectiveContact: false`, `LICENCIATURA`, sin login, sin modalidad, sin actividades, **`classroom.hasGrades: true`** | Que la exclusión 5.7.e **sí** se materialice como `SATISFIED` y entre en `exclusions` |
| 7 | `grades-absent` | 6 hechos: idénticos a `grades-observed` pero con `classroom.hasGrades: false` | El caso espejo: 5.7.e `NOT_SATISFIED` |
| 8 | `contact-threshold-satisfied` | 7 hechos: 16 llamadas, 10 escritas, `contact.effectiveContact: true`, `LICENCIATURA`, sin login, sin modalidad | 5.2 `SATISFIED` con contacto efectivo presente |
| 9 | `contact-threshold-not-satisfied` | 7 hechos: **15** llamadas, **9** escritas, resto igual | 5.2 `NOT_SATISFIED` por debajo de los umbrales (16 llamadas / 6 escritas) |
| 10 | `coverage-gaps-v5` | 1 hecho: `classroom.hasGrades: false` | El array de `softwareCoverageGaps` de v5: las 11 secciones sin formalizar. Congela **qué falta**, que es información de trazabilidad |
| 11 | `unknown-contact-collections` | 2 hechos: colecciones con `sourceCompleteness: 'UNKNOWN'`, `events: []`, `observedCount: 16` y `10` | Que `UNKNOWN` en la fuente no se convierta en "sí hay contacto". Complementa al caso 3 |
| 12 | `conflict-current-engine-probe` | 7 hechos: 16 llamadas, 10 escritas, `contact.effectiveContact: true`, `LICENCIATURA`, sin login, sin modalidad, **`classroom.hasGrades: true`** | **Un conflicto que el motor actual NO materializa.** Su `notes` lo dice textualmente: *"Current engine does not materialize a conflict between the grades exclusion and cancellation outcome in this rule set."` Congela una limitación actual, no una virtud |

**Por qué el caso 12 importa tanto como los demás.** Congelar
`conflicts: []` para esa combinación de hechos es afirmar, sobre el motor
actual, que la coexistencia de una exclusión de calificaciones y un outcome de
cancelación **no** es un conflicto. Puede ser correcto o puede ser un hueco
normativo. El Golden Master no resuelve la pregunta: la congela y la hace
visible. Resolverla requiere la fuente normativa del propietario, y por tanto es
`REQUIRES_OWNER_DECISION`.

---

## 3. Cómo ejecutarlo

```bash
pnpm --filter @cancelaciones/policy-engine test
```

Sólo el Golden Master:

```bash
pnpm --filter @cancelaciones/policy-engine exec vitest run src/golden-master.test.ts
```

Resultado esperado: **14 passed (14)** — 12 casos + el test de integridad del
corpus + el test de hash del §4.2. No hay nada que preparar: no usa base de
datos, ni red, ni variables de entorno, ni credenciales.

Está incluido en el `test` raíz (`pnpm test` → `pnpm -r test`) y por tanto en
el gate de cada commit. A diferencia de los tres E2E de DEV, el Golden Master
está en el script `test` de `@cancelaciones/policy-engine` y no se excluye de
ningún sitio.

---

## 4. Hash de la fixture

```
38e29f441498b72137fcb6bda49b0aa00ff6f4f898c2c7f6504b46a378ea0d76
```

Ruta: `packages/policy-engine/src/testdata/golden-master-v1.json`.

### 4.1 El hash es canónico-LF, y en Windows el hash crudo difiere

Este repositorio tiene `core.autocrlf=true`. Git convierte los finales de línea
a CRLF al materializar los archivos en el disco de Windows, así que el SHA-256
sobre los **bytes crudos** del archivo en disco **no** es el valor de arriba. En
esta máquina el hash crudo es `51ca6b08a63478aa059c141d7cb68a5e6d2f33407d6005194cb496cc17f3d210`.

**Eso es lo esperado, no una discrepancia.** El valor de referencia se calcula
sobre los bytes leídos y normalizados a LF:

```bash
# Linux / macOS
sha256sum packages/policy-engine/src/testdata/golden-master-v1.json

# Windows (PowerShell), normalizando a LF antes de hashear
$p = "packages\policy-engine\src\testdata\golden-master-v1.json"
$s = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes((Resolve-Path $p)))
$lf = $s -replace "`r`n", "`n"
$lfBytes = [System.Text.Encoding]::UTF8.GetBytes($lf)
([System.Security.Cryptography.SHA256]::Create().ComputeHash($lfBytes) |
  ForEach-Object { $_.ToString("x2") }) -join ''
```

Ambos caminos deben dar `38e29f44…d76`. Un hash crudo distinto en Windows **no**
indica que la fixture haya cambiado.

### 4.2 El hash a nivel de archivo AHORA está fijado en código

**Estado: `PASS`.** `golden-master.test.ts` contiene un `it` adicional
(`fija el hash canonico-LF de la fixture: una edicion de bytes sucios falla aqui`)
que lee los bytes del fichero, normaliza CRLF→LF y compara el SHA-256 con el
valor del §4. El literal vive en el test como
`GOLDEN_MASTER_FIXTURE_SHA256_LF`.

**Por qué normaliza a LF y no hashea el fichero en crudo:** el repositorio tiene
`core.autocrlf=true`, así que en Windows el fichero en disco tiene CRLF y su
hash crudo es `51ca6b08…d210`. Asertar el hash crudo daría un test que **falla
en Windows y pasa en Linux** — un test dependiente de la plataforma, que es
peor que no tenerlo. El valor canónico es el de los bytes que Git guarda, y por
eso el test normaliza antes de hashear. El mismo valor funciona en los dos
sistemas.

**Qué detectaba y no detectaba.** Antes de este cambio, el resto del fichero
compara el objeto **ya parseado** (`toEqual`), que no distingue el orden de las
claves de un JSON ni el espaciado. Una edición de sólo espacios en blanco, o un
reordenamiento de claves que preserve los `PolicyEvaluation` por caso, **pasaba
inadvertida**; el hash del §4.1 era la única detección y la hacía una persona, no
un test. Ese hueco está cerrado.

**Verificado, no inferido:** se perturbó temporalmente la fixture con una
edición de **sólo espacios en blanco** (un byte `0x20` al final, que
`JSON.parse` acepta). Resultado: **13 tests existentes en verde y sólo el nuevo
en rojo**, que es exactamente el comportamiento buscado — el nuevo test detecta
lo que `toEqual` no puede. Después se restauró la fixture byte a byte y se
comprobó que su SHA-256 LF-canónico vuelve a ser `38e29f44…d76` y que `git
status --short` no la muestra modificada. La perturbación **no** se commiteó.

Lo que **también** está fijado en código, y por tanto detecta cambios
**semánticos**:

- La identidad del corpus: los nombres de `goldenCases` deben coincidir
  exactamente con las claves de la fixture.
- Por caso, `sha256(canonicalFingerprintV1(case.input.facts))` contra
  `case.inputFingerprint`.
- Por caso, `sha256(canonicalFingerprintV1(evaluatePolicy(case.input)))` contra
  `case.expectedFingerprint`.
- `toEqual` del `PolicyEvaluation` completo, que cubre las 3 reglas evaluadas,
  sus condiciones, estados, `factIds`, `evidenceRefs`, `observedValue`, y todas
  las listas agregadas.

---

## 5. Las huellas que el corpus fija

Las doce parejas `(inputFingerprint, expectedFingerprint)` viven en
`golden-master-cases.ts:82-95` y son `as const`, así que el compilador las
protege. Se transcriben aquí para poder compararlas a mano cuando algo falle.

| Caso | `inputFingerprint` | `expectedFingerprint` |
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
| `unknown-contact-collections` | `50b19363a894ec2c70207facd46e0023ffce602ab7fc2f27e0bd2d714fe788ff` | `81f97514c5cafb7327e8e5d2254a2b87f76d0bed1731427dc929fe20dae61a7a` |
| `conflict-current-engine-probe` | `53af2fc6278adc0d65adda8056b0fe6238cd4d43f0d98db48be569796569c2cf` | `9b1f69617e802bc987f44ff4a678cfc29e02188f535ce9bd87d04ffc1e0231f6` |

### 5.1 Por qué `canonicalFingerprintV1` y no `canonicalizeV1`

El Golden Master usa `canonicalFingerprintV1`, que **descarta** los campos
operativos `createdAt`, `updatedAt`, `completedAt`, `executionId` y `runId`
(`packages/domain/src/policy-foundation.ts:36`). Es lo correcto aquí: la pregunta
es "¿el motor produjo la misma decisión para estos hechos?", y el reloj no es
parte de esa pregunta.

Es exactamente la operación contraria a la del hash de integridad de
`ai_decision_snapshots`, que sí usa `canonicalizeV1` porque su hash debe cubrir
el registro entero. La razón del contraste está en
`docs/architecture/ai-decision-snapshots.md` §3.

`canonicalFingerprintV1` **sí** normaliza el orden de las claves (por code point),
así que un cambio puramente cosmético en la forma del objeto no lo mueve. **No**
normaliza el orden de los elementos de un array, porque el orden de los hechos es
parte de la identidad de la evaluación. Por eso los identificadores de los hechos
sintéticos (`synthetic-call-1` … `synthetic-call-16`) están en un orden fijo y
deliberado: reordenarlos es un cambio real de entrada, no cosmético.

---

## 6. Prohibición absoluta de auto-update

**No existe ninguna forma de actualizar la fixture automáticamente. No debe
construirse.**

Concretamente, está **prohibido**:

- Un flag `--update`, `-u`, `--snapshot-approval`, `--bless` o equivalente en
  `golden-master.test.ts`, en `vitest` o en cualquier script.
- Un script de regeneración de `golden-master-v1.json` (`generate:golden`,
  `golden:approve`, `golden:refresh`, o un `node scripts/…` que escriba el
  archivo).
- Un `.gitattributes`, `.gitignore` o excepción de CI que exclusa el archivo de
  revisión.
- Un paso de pipeline que escriba la fixture si el test falla.
- Aceptar un diff de la fixture como parte de un cambio de motor sin el
  análisis del §7, punto a punto.

**Por qué, y por qué no es una preferencia de estilo.**

La fixture es lo que **impide** que un cambio de motor mueva un outcome sin que
alguien lo note. Un modo de auto-update elimina esa propiedad por construcción:
basta con ejecutar el flag una vez para que la protección desaparezca, y el
"bless" se convierte en un `git commit` de la evidencia. Peor: normaliza el
comportamiento. Después de un par de regeneraciones, la fixture deja de ser un
registro de lo que el motor hacía y pasa a ser un reflejo de lo que el motor hace,
que es un espejo.

En este repositorio, `HISTORICAL_CASES_ARE_NOT_POLICY` y
`ONLY_OWNER_PROVIDED_POLICY_SOURCES` apuntan en la misma dirección: un artefacto
que se regenera sin revisión no es evidencia de nada. La fixture sólo tiene
valor como evidencia en la medida en que **cambió exactamente cuando alguien la
cambió a propósito y dijo por qué**.

Si alguna vez se necesita añadir un caso nuevo, el camino es: escribir el caso en
`golden-master-cases.ts` con sus dos huellas **a mano**, añadir su entrada a la
fixture **a mano**, y commitear los dos juntos con un mensaje que explique por
qué ese caso merece congelarse. El test de integridad de claves (§1) falla
hasta que los dos lados estén.

---

## 7. Protocolo de divergencia

### 7.1 Ante un fallo del Golden Master

**Paso 1 — ¿Cambió de verdad el comportamiento de `evaluatePolicy`?**

Esto es lo primero, y no es opcional. Un test rojo aquí **no** significa
"hay un problema con el motor": significa "el motor y la fixture ya no coinciden, y
alguien tiene que decir por qué".

Preguntas concretas, en orden:

1. ¿Cambió el **array `facts`** que entra al motor? Entonces cambia
   `inputFingerprint` y el fallo es de entrada, no de motor. El sitio a mirar es
   la cadena de hechos: extracción, snapshot congelado, adaptación de revisiones
   humanas — no `evaluatePolicy`.
2. ¿Cambió `inputFingerprint` pero no `expectedFingerprint`? El motor se comporta
   igual con hechos distintos. Suele ser un cambio en el fixture de entrada, que
   es una regresión de la misma categoría.
3. ¿Cambió `expectedFingerprint` con el mismo `inputFingerprint`? **El
   comportamiento de `evaluatePolicy` cambió.** Esto es lo que hay que decidir.
4. ¿Falló sólo el test de integridad de claves? Alguien añadió un caso a un lado
   y no al otro. Completar el otro lado, revisar el caso nuevo, y seguir.

### 7.2 Un cambio real de comportamiento de motor es una REGRESIÓN

**Regla:** hasta que se demuestre lo contrario, un cambio en
`expectedFingerprint` con el mismo `inputFingerprint` es una **REGRESIÓN** del
motor, no una mejora.

`evaluatePolicy` es la única fuente de outcomes
(`AGENTS.md: POLICY_ENGINE_DECIDES`) y su comportamiento está congelado
deliberadamente desde el checkpoint de la remediación. Moverlo sin una fuente
normativa del propietario detrás es, por definición, cambiar política sin
autorización — que es justo lo que `POLICY_IS_IMMUTABLE` prohíbe.

Para que un cambio de comportamiento sea legítimo hacen falta **las dos** cosas:

1. Una **fuente normativa del propietario** que diga cuál es el comportamiento
   correcto, con documento, versión, sección y página. Una fuente encontrada en
   internet, un CaVe histórico o el repositorio legacy **no** cuentan
   (`ONLY_OWNER_PROVIDED_POLICY_SOURCES`, `HISTORICAL_CASES_ARE_NOT_POLICY`,
   `LEGACY_IS_NOT_POLICY`).
2. Una **decisión explícita del propietario** registrada, que autorice el cambio
   y nombre la regla afectada.

Sin las dos, el camino es: **revertir el cambio de motor** y dejar la fixture
como estaba.

### 7.3 Divergencia normativa: `REQUIRES_OWNER_DECISION`

Si el análisis de §7.1 punto 3 revela que el motor se comporta de una forma que
**la fuente normativa del propietario dice que no debe**, entonces no es una
regresión del motor: es una **divergencia normativa**, y se marca
**`REQUIRES_OWNER_DECISION`**. No se arregla unilateralmente.

Estado actual de las divergencias conocidas:

| Divergencia | Qué dice el motor hoy | Estado |
|---|---|---|
| **5.7.e** — exclusión por calificaciones en el bimestre inicial | Bloqueada por `conflict-current-engine-probe` (y por `grades-observed` / `grades-absent`): la coexistencia de la exclusión y un outcome de cancelación **no** se materializa como `Conflict` | **`REQUIRES_OWNER_DECISION`** |
| **5.8.a** — nivel académico determina la rama normativa | Tres reglas distintas según el valor de `student.level`: `GDM-V5-5.8-A-LICENCIATURA`, `…-NON-LICIENCIATURA`, `…-ACADEMIC-LEVEL-UNKNOWN` (`index.ts:200`). Sin nivel no hay salida; la rama por defecto es `UNKNOWN`, no una suposición | **`REQUIRES_OWNER_DECISION`** sobre la forma de la rama y sus condiciones |
| Secciones 5.3, 5.4, 5.5, 5.6, 5.7 restante, 5.9 a 5.15 | `softwareCoverageGaps` las declara no formalizadas (`index.ts:231-246`), y el caso `coverage-gaps-v5` congela esa lista | Gap declarado, no divergencia; su formalización es `REQUIRES_OWNER_DECISION` |
| `GDM_GAM_PRD_MLG_003` como fuente | `PENDING_VERIFICATION`, nunca `CANONICAL` | **`REQUIRES_OWNER_DECISION`** |

Estas marcas no se borran cuando pasan los tests: describen el estado de una
pregunta normativa, no el resultado de un test.

### 7.4 Cambiar la fixture: nunca como efecto secundario

Si, tras todo lo anterior, el propietario autoriza un cambio, la actualización
de la fixture es **explícita y manual**:

- Se editan `inputFingerprint` / `expectedFingerprint` en
  `golden-master-cases.ts` y la entrada correspondiente en
  `golden-master-v1.json`.
- El mensaje del commit nombra el caso, la regla afectada, la fuente normativa
  y la decisión del propietario.
- Se registra en `docs/policy/` la regla con su referencia exacta, y el cambio
  se muestra en un reporte de la remediación.

Nunca como efecto secundario de "arreglar un test que fallaba".

---

## 8. Que protege el Golden Master y que no

| Queda bloqueado | No queda bloqueado |
|---|---|
| Un cambio de outcome para un caso dado | Que el motor sea **correcto**. El corpus congela el comportamiento, no el acierto |
| Un cambio en la lista de reglas o sus estados | Un caso **nuevo** que nadie anticipó. El corpus sólo conoce los 12 que contiene |
| Un cambio en `missingData` / `nextActions` / `explanation` | Un cambio en las 11 secciones sin formalizar: `softwareCoverageGaps` está congelado, y formalizarlas es `REQUIRES_OWNER_DECISION` |
| Un cambio en la construcción de `factsFingerprint` o `rulesFingerprint` | El contenido de un `Fact` mal construido **fuera** de los 12 casos |
| Un alta o baja de casos desalineada con la fixture | Un cambio en el **código de tests** del motor que no toque `evaluatePolicy` |
| Reordenar los hechos de un caso | Un cambio en `mapStoredFactsToPolicyFacts` o `mapSnapshotFactsToPolicyFacts` **fuera** de los casos del corpus (verificado aparte por `evaluation.test.ts` y `frozen-fact-run.test.ts`) |
| Un espaciado/reordenamiento de claves de la fixture | *(ninguna fila: esto ya no es una debilidad, está cerrado en §4.2)* |

La última fila de la tabla es ahora la de "Un cambio en el **código de tests**
del motor que no toque `evaluatePolicy`". La debilidad que sí existía —el
espaciado y el reordenamiento de claves de la fixture pasar inadvertidos— está
**cerrada** desde §4.2, y se cierra con la fila de arriba, no con una nota al
pie: `AGENTS.md` no admite notas al pie para limitaciones, pero una limitación
que ya no existe sí merece Constar que se cerró y con qué evidencia.

---

## 9. Estado de verificación

| Comprobación | Resultado |
|---|---|
| `pnpm --filter @cancelaciones/policy-engine test` | **14 passed (14)**, fixture sin tocar |
| `sha256` LF-normalizado de la fixture | `38e29f441498b72137fcb6bda49b0aa00ff6f4f898c2c7f6504b46a378ea0d76` — **coincide** |
| `core.autocrlf` | `true` (por eso el hash crudo en Windows difiere, §4.1) |
| Modo auto-update | **no existe**, y está prohibido construirlo (§6) |
| SHA-256 de archivo fijado en código | **sí**, y verificado con RED→GREEN (§4.2) |
| Ningún caso validado contra la fuente oficial del propietario | **ninguno**; todos `synthetic: true`, `notes: 'Behavior lock; not normative truth.'` |
| Fuente local `GDM_GAM_PRD_MLG_003` | `PENDING_VERIFICATION`; **nunca** `CANONICAL` |
| Divergencias normativas marcadas | 5.7.e, 5.8.a y la formalización de las 11 secciones: `REQUIRES_OWNER_DECISION` |
