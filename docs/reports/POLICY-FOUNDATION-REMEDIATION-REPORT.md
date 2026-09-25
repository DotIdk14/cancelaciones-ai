# Policy Foundation Remediation Report

> **Reporte final de la fase. Cierra las Tasks 1–12 de
> `docs/superpowers/plans/2026-09-24-policy-foundation-remediation.md`.**
>
> Este documento **reemplaza** al checkpoint de Task 7 que ocupaba esta misma ruta.
> Aquel checkpoint decía que la inmutabilidad de Fact Runs y `AI_DECISION_V1` estaban
> «BLOCKED / pendiente». Ya no es cierto, y un lector que sólo abriera aquel archivo se
> llevaría una impresión equivocada. Este es el estado real, verificado.
>
> **Para un resumen del estado del repositorio y cómo retomar el trabajo si la fase se
> interrumpe, ver `docs/reports/POLICY-FOUNDATION-RECOVERY-REPORT.md`.**
>
> - **Rama:** `feature/policy-foundation-tasks-8-12` · **Base:** `ed5ddb4` · **HEAD:** `d8e1b67` + este commit
> - **DB VALIDATION: `BLOCKED`.** La migración de inmutabilidad está escrita y
>   commiteada, y deliberadamente **NO aplicada**.
> - Verdulgos usados: `PASS`, `FAIL`, `BLOCKED`, `NOT_STARTED`. Nada se declara `PASS`
>   por inferencia. Este reporte se reescribió después de ejecutar la matriz final.

---

## 1. Executive Summary

Estado: **fase de remediación cerrada en código y documentación; validación de base de
datos `BLOCKED`.**

Se completaron las 12 tareas del plan. Lo que se entregó:

- Contratos de facts, provenance, Golden Master, separación de estados, firewall de
  Extraction Tools, validación de evidencia y sanitización blind fail-closed (Tasks 1–7).
- `AI_DECISION_V1` durable en código, append-only, con hash de integridad (Task 8).
- La migración SQL completa de inmutabilidad, snapshots y envelopes (Task 9) —
  **escrita, revisada, commiteada, no aplicada**.
- Fact Run snapshots, FROZEN irreversible y correcciones humanas versionadas por
  derivación, todo con degradación explícita al comportamiento previo cuando la
  migración no está (Task 10).
- Cinco documentos de arquitectura (Task 11).

Lo que **no** se hizo, y es lo primero que hay que leer:

- **La migración no se aplicó y ningún trigger, ACL, política RLS ni RPC se ha ejecutado
  jamás contra un Postgres.** La garantía de inmutabilidad está *escrita*, no *probada*.
- **Las tres suites E2E de DEV están `BLOCKED`** por credenciales ausentes.
- **Ninguna divergencia normativa se corrigió.** Todas son del propietario.
- Los Extraction Tools y el shadow engine **siguen sin caller productivo**. Verificado
  por grep en la §3 y en la matriz final.

**No se modificó `evaluatePolicy` ni `v5Rules` ni un byte del cuerpo normativo.** La
prueba es la §3: 4 líneas añadidas, 0 borradas.

## 2. Baseline Before Changes

El baseline normativo es el commit **`410275e`** (estado del motor antes de la
remediación). El baseline de la rama de esta fase es **`ed5ddb4`** (main en el momento
del recovery, con Tasks 1–7 ya commiteadas en `becfa9d` y fusionadas en `e9eece5`).

Medición del baseline en el recovery, antes de escribir nada de las Tasks 8–12:

| Comando | Exit | Resultado |
|---|---|---|
| `pnpm typecheck` | 0 | PASS |
| `pnpm lint` | 0 | PASS |
| `pnpm test` | 0 | PASS — **225 tests / 30 archivos / 0 skipped** |
| `pnpm build` | 0 | PASS |
| `test:audit:e2e` | 0 | PASS |
| `test:audit:dev-e2e` | 1 | `DEV_INFRA_NOT_CONFIGURED` — **preexistente**, guard byte-idéntico a `410275e` |
| `test:governance:dev-e2e` | 1 | `DEV_INFRA_NOT_CONFIGURED` — **preexistente**, mismo guard |

**Regresiones reales en el baseline: 0.** Los dos fallos de DEV son de entorno y
predescaban la fase; están registrados así y no como «fallos que se explican».

## 3. Files Changed

### 3.1 Diff normativo — la comprobación que manda

```
git diff 410275e..HEAD -- packages/policy-engine/src/index.ts
```

```diff
diff --git a/packages/policy-engine/src/index.ts b/packages/policy-engine/src/index.ts
index cd3e139..156494f 100644
--- a/packages/policy-engine/src/index.ts
+++ b/packages/policy-engine/src/index.ts
@@ -1,3 +1,7 @@
+export * from './evaluation-envelope';
+export * from './shadow-engine';
+export * from './source-registry';
+
 import { stableFingerprint } from '@cancelaciones/domain';
 
 export * from './comparison';
```

```
git diff 410275e..HEAD --numstat -- packages/policy-engine/src/index.ts
4	0	packages/policy-engine/src/index.ts
```

**4 inserciones, 0 borrados.** Las 4 son `export * from` de los tres módulos nuevos
más una línea en blanco, insertadas en la cabecera. **Cero líneas del cuerpo normativo
fueron tocadas.**

Los tres símbolos normativos siguen existiendo, con su número de línea actual:

| Símbolo | Línea | Estado |
|---|---|---|
| `v5Rules` | `packages/policy-engine/src/index.ts:156` | presente, cuerpo sin cambios |
| `policySets` | `packages/policy-engine/src/index.ts:207` | presente, cuerpo sin cambios |
| `evaluatePolicy` | `packages/policy-engine/src/index.ts:209` | presente, cuerpo sin cambios |

### 3.2 Frontera shadow/tools — la comprobación que demuestra que nada se conectó

```
git grep -n -E "createDefaultExtractionToolRegistry|ShadowPolicyEngine|runAndPersistBlindMachineAudit" -- apps/web/src/app apps/web/src/server/jobs
```

**Salida: vacía. Exit 1.**

Esto prueba tres cosas a la vez: las herramientas de extracción no están cableadas al
API, el shadow engine no está cableado al pipeline de evaluación, y el runner de
auditoría ciega no está cableado a ningún job. Si algo de eso estuviera productivo,
esta búsqueda lo habría encontrado.

### 3.3 Ficheros tocados por Tasks 8–12

| Commit | Tarea | Ficheros |
|---|---|---|
| `a411f61` | 8 | `.gitignore`, `apps/web/src/server/policy/ai-decision-snapshot.ts` (+test, 347), `apps/web/src/server/policy/blind-audit.ts` (+test), `packages/db/src/index.ts` |
| `5a889a9` | 9 | `apps/web/package.json`, `apps/web/src/server/policy/fact-run-snapshot.dev-e2e.test.ts` (nuevo), `migrations/20260925120000_policy-foundation-immutability.sql` (nuevo, 1688), `packages/policy-engine/src/source-registry.ts` |
| `5e7201f` | 10 | 20 ficheros: `apps/web/src/server/facts/` (4 nuevos + tests), `apps/web/src/server/policy/evaluation-persistence.ts` (nuevo), `evaluation.ts`, `frozen-fact-run.ts`, `handlers.ts`, dos rutas de API (+ tests), `packages/db/src/index.ts` (+ test) |
| `d8e1b67` | 11 | 5 documentos `.md` nuevos: `docs/architecture/{fact-immutability,ai-decision-snapshots,extraction-tools,policy-boundary}.md`, `docs/testing/golden-master.md` |
| este | 12 | `docs/reports/POLICY-FOUNDATION-REMEDIATION-REPORT.md`, `docs/reports/POLICY-FOUNDATION-RECOVERY-REPORT.md` |

**Ningún `.ts` normativo.** El único fichero de `packages/policy-engine/src/` tocado en
toda la fase aparte de los módulos nuevos es `index.ts`, con esas 4 líneas.

### 3.4 Corrección de una afirmación falsa del checkpoint anterior

El reporte anterior afirmaba, textualmente:

> «El reporte histórico `RULE-ENGINE-REFACTOR-REPORT.md` se conservó sin cambios
> normativos.»

**Esa afirmación es falsa. `docs/reports/RULE-ENGINE-REFACTOR-REPORT.md` no existe en
este repositorio.** Verificado de dos formas: `git grep -n "RULE-ENGINE-REFACTOR"`
devuelve una única coincidencia, y es la propia línea de la afirmación; y una búsqueda
recursiva de `*RULE-ENGINE-REFACTOR*` en todo el árbol de trabajo —incluidos
ficheros no trackeados— no encuentra nada.

No se ha creado ese fichero ni se ha fabricado su historia. Lo que existe en
`docs/reports/` son trece reportes de fase (`phase-0` … `phase-8`, `cave-30591-*`,
`hybrid-audit-*`) más este. **No se encontró ningún reporte histórico con ese nombre en
ningún commit del repositorio.** Cualquier afirmación futura que lo cite como evidencia
debe tratarse como no verificada.

## 4. Canonical Policy Source Registry

**`PASS` técnico / `BLOCKED` normativamente.**

Existe el contrato con estados `CANONICAL`, `LEGACY`, `PENDING_VERIFICATION` y
`SUPERSEDED`, validación SHA-256, rechazo de duplicados, `get`, `list`, `canonicalSources`
y referencias. La tabla SQL `policy_source_registry` es **append-only**: promover una
fuente a `CANONICAL` significa **insertar una versión nueva**, nunca sobrescribir la fila
`PENDING_VERIFICATION`. Es la razón de que la evidencia de «hubo una fuente sin
verificar» sobreviva.

R-06 de esta fase: `PolicySourceRecord` ganó 5 campos **opcionales** (`effectiveFrom`,
`effectiveTo`, `verifiedBy`, `verifiedAt`, `notes`) y la tabla SQL las correspondientes
columnas nullable, para que TypeScript y Postgres coincidan. Cambio puramente aditivo:
la semántica de estados no cambió.

**`BLOCKED`:** la fuente local sigue `PENDING_VERIFICATION`. Ningún documento de la
fase marca ninguna fuente como `CANONICAL`.

## 5. Golden Master

**`PASS`.**

12 casos sintéticos congelados, con fingerprint de entrada y de salida por caso. El
nombre del fichero de test es el de la aserción, así que un fallo identifica el caso:

| # | Nombre del caso |
|---|---|
| 1 | `complete-licenciatura` |
| 2 | `missing-all-facts` |
| 3 | `partial-contact-collections` |
| 4 | `unknown-academic-level` |
| 5 | `non-licenciatura` |
| 6 | `grades-observed` |
| 7 | `grades-absent` |
| 8 | `contact-threshold-satisfied` |
| 9 | `contact-threshold-not-satisfied` |
| 10 | `coverage-gaps-v5` |
| 11 | `unknown-contact-collections` |
| 12 | `conflict-current-engine-probe` |

El caso 12 es un **probe explícito de conflicto no materializado** por el rule set
actual: fija que hoy no se produce, para que si algún día se produce, salte. No es un
caso que «pase por casualidad».

**12 casos, 13 tests.** El test adicional es de integridad del corpus (comprueba que las
claves de la fixture son exactamente las de `goldenCases`) y no es un caso.

### 5.1 Hash de la fixture — verificado en esta ejecución

```
38e29f441498b72137fcb6bda49b0aa00ff6f4f898c2c7f6504b46a378ea0d76
```

**`MATCH`** con el valor del ledger de recovery. Calculado por **dos métodos
independientes que coinciden**:

1. **`git cat-file blob HEAD:packages/policy-engine/src/testdata/golden-master-v1.json`**
   volcado a fichero binario y hasheado con `certutil -hashfile … SHA256`:
   `38e29f44…d76`. El blob son **168 190 bytes y 0 pares CRLF**.
2. **Normalización a LF del fichero en disco**, leída con .NET y hasheada:
   `38e29f44…d76`. El fichero en disco son **171 651 bytes** con terminadores CRLF.

**Por qué difieren los bytes y por qué eso no es una discrepancia:** el repositorio tiene
`core.autocrlf=true`, así que Git checkout-convierte LF→CRLF en Windows. El hash crudo
del fichero en disco es `51ca6b08a63478aa059c141d7cb68a5e6d2f33407d6005194cb496cc17f3d210`
y **no debe compararse** con el valor canónico. El valor que importa es el
LF-canónico, y los dos caminos convergen en él. Es la diferencia de
171 651 − 168 190 = **3 461 bytes**, exactamente un byte por salto de línea: la
coherencia numérica confirma que no hay ninguna otra diferencia.

### 5.2 Debilidad conocida y honesta del hash de fichero

**El SHA-256 de la fixture está documentado pero NO está fijado en código.** Verificado:
`git grep -n "38e29f44"` devuelve coincidencias sólo en
`docs/testing/golden-master.md` y en este reporte. **Ningún `.ts` lo contiene.**

Consecuencia precisa, no teórica: el test hace `expect(actual).toEqual(expected[name])`
sobre el objeto **ya parseado**. Una edición que sólo cambie el espaciado, el orden de
claves o un salto de línea del JSON deja el objeto parseado **idéntico**, así que
`toEqual` sigue pasando, y el hash de fichero —que sí lo detectaría— no se está
comprobando. Es decir: **una edición de ese tipo pasaría inadvertida**, y el único control
que la habría pillado es el que no está automatizado.

**Dónde iría el arreglo:** en
`packages/policy-engine/src/testdata/../golden-master.test.ts` —concretamente junto al
test de integridad del corpus que ya existe en ese fichero, justo después de la línea
que hace `readFileSync(new URL('./testdata/golden-master-v1.json', import.meta.url), 'utf8')`
—añadiendo un `it(...)` que lea los bytes crudos, normalice CRLF→LF y compare el
SHA-256 con el literal. Son unas pocas líneas. **No se añadieron** porque esta fase es
de reportes y ese fichero es `.ts`.

**Mitigación actual:** el hash está documentado en dos sitios y verificado en cada
ejecución de la matriz. Es un control humano, no un control automatizado.

## 6. Frozen Fact Run Immutability

**`PASS` en código. `BLOCKED` en DB.**

Lo que existe escrito y commiteado en
`migrations/20260925120000_policy-foundation-immutability.sql` (1688 líneas):

- `guard_fact_run_transition` (`BEFORE UPDATE OF state`): sólo admite
  `DRAFT→PROCESSING|FAILED` y `PROCESSING→FROZEN|FAILED`. **`FROZEN` y `FAILED` no
  tienen salida.** Errores con código estable (`FACT_RUN_STATE_TRANSITION_FORBIDDEN`).
- `guard_frozen_fact_run_row` (`BEFORE UPDATE`): bloquea **cualquier** UPDATE sobre una
  fila `FROZEN`/`FAILED`, incluso sin tocar `state`. Esto cierra de paso la mutación de
  `artifact_set_fingerprint` y `extractor_version`, que son parte de la identidad del
  índice de idempotencia.
- `facts_reject_frozen_run_insert` (`BEFORE INSERT` en `facts` si el run está `FROZEN`).
- `facts_guard_frozen_run_mutation` (`BEFORE UPDATE OR DELETE` si el run está
  `FROZEN`/`FAILED`).
- La tabla `fact_run_frozen_snapshots` con `UNIQUE (fact_run_id)`, append-only por
  `REVOKE` **y** por trigger: los dos mecanismos hacen falta, ninguno sustituye al otro.
- El RPC `freeze_fact_run_v1`, que calcula el `integrity_hash` **en el servidor** para
  que el llamador no pueda sellar un hash que no corresponde a sus bytes.
- 11 triggers, 14 funciones (las 8 `SECURITY DEFINER` con
  `SET search_path = pg_catalog, public, pg_temp`), 6 políticas RLS.

En **código** (Task 10), `freezeFactRunWithSnapshot` sella por el RPC cuando existe y, si
no, recorre la máquina de estados legal (`DRAFT→PROCESSING→FROZEN`) avisando con
`FREEZE_FACT_RUN_RPC_ABSENT`. Se corrigió una rotura real: `createFactRepository.freezeRun`
hacía `DRAFT→FROZEN` en un solo UPDATE, que el trigger prohíbe. Ahora camina la máquina
legal y rechaza con `FACT_RUN_NOT_FREEZABLE` lo que no es congelable.

**`BLOCKED`:** nada de esto se ha ejecutado. La tabla no existe en ninguna base de datos.
La verificación del SQL fue **estructural y por lectura comparada** contra las 28
migraciones aplicadas (balanceo de `$$`, sentencias terminadas, variables sin declarar,
columnas existentes con el tipo correcto), no por ejecución.

## 7. AI_DECISION_V1 Persistence

**`PASS` en código. `BLOCKED` en DB.**

Existe `apps/web/src/server/policy/ai-decision-snapshot.ts` con el hash de integridad
sobre los **16 campos** del contrato (sin truncación) y
`createPolicyFoundationRepository.appendAiDecisionV1` en `packages/db`, que hace
`SELECT` + `INSERT` y **nunca** `UPDATE` ni `DELETE`.

Comportamiento real, que no es el que se suele suponer:

| Situación | Comportamiento | Código |
|---|---|---|
| Misma identidad (mismo `inputFingerprint`) | **Rechaza** | `AI_DECISION_V1_ALREADY_EXISTS` |
| `inputFingerprint` distinta | **Agrega** una fila nueva | — |
| `decisionVersion` distinta | No es hoy la palanca de versionado: el constructor fija `'AI_DECISION_V1'` literal y no hay constructor V2 | — |

Una fila nunca se sobrescribe. **No hay un tercer camino.** Y el hash se calcula con
`created_at` dentro, lo que significa que **reintentar la misma decisión con otro
timestamp produce un hash distinto** — la identidad la decide `inputFingerprint`, no el
hash.

**`appendAiDecisionV1` no tiene caller productivo.** Está escrito y probado, no
conectado. Por eso su JSDoc lo dice.

**`BLOCKED`:** la tabla `ai_decision_snapshots` **no existe en ninguna base de datos**.
Hasta que se aplique la migración, la unicidad es *check-then-act* en código, que no es
lo mismo que una restricción de base de datos.

## 8. AI_DECISION_V1 Immutability

**`PASS` en código. `BLOCKED` en DB.**

Tres mecanismos, y es importante no atribuirlos al que no les corresponde:

1. **`REVOKE UPDATE, DELETE` sobre `ai_decision_snapshots` a `anon` y `authenticated`.**
   Cierra al rol de cliente. No cierra al propietario de la tabla.
2. **Trigger `ai_decision_snapshots_append_only`** (`BEFORE UPDATE OR DELETE`, sin
   excepción). Cierra a **cualquier** rol, incluido el propietario y el cliente admin.
3. **Índice único `ai_decision_snapshots_identity (audit_id, decision_version,
   input_fingerprint)`.** No es un mecanismo de inmutabilidad: es el que hace que el
   check-then-act del repositorio no pueda duplicar filas bajo carrera.

**El `INSERT` se conserva a propósito** en `ai_decision_snapshots`: es la única vía de
escritura que tiene `appendAiDecisionV1`, que inserta directo y no tiene RPC.

Además, `audit_runs_guard_append_only` bloquea `UPDATE`/`DELETE` cuando
`run_type IN ('AI_DECISION_V1','AI_DECISION_V2')` **o** `status = 'COMPLETED'`.

**`BLOCKED`:** igual que §7. Ninguno de estos tres mecanismos se ha ejecutado.

## 9. Human Correction Versioning

**`PASS` en código. `BLOCKED` en DB.**

`deriveFactRunFromReviews` crea un **Fact Run derivado hijo**, deja el padre intacto y
marca la procedencia humana. La corrección humana **no reescribe la entrada de una
decisión ya tomada**: produce una versión nueva.

Precondiciones que el servidor impone: padre `FROZEN`, padre **con snapshot**,
`extractor_version` distinta (si coincidiera, el índice único de idempotencia
chocaría — se valida explícitamente con `DERIVED_RUN_IDEMPOTENCY_COLLISION` en vez de
dejar un `23505` opaco), y `document_id` registrado en `policy_source_registry`.

En la API, `POST /api/audits/[auditId]/fact-reviews` **añade** `derivedFactRunId` y
`derivation` sin quitar ningún campo de la respuesta previa. Un fallo de derivación
devuelve **201, no 500**: la review ya está guardada y es append-only, así que un 500
invitaría al cliente a reintentar y duplicar evidencia. Se declara el fallo con un
código estable en lugar de ocultarlo.

**El padre no recibe ni un `UPDATE` en ninguna rama**, afirmado por test: `state`,
`extractor_version`, `artifact_set_fingerprint` e `integrity_hash` del padre quedan
iguales.

**`BLOCKED`:** `fact_run_frozen_snapshots` no existe, así que la derivación por RPC no es
alcanzable. En el mundo real de hoy la derivación se materializa con inserts directos
recorriendo la máquina legal, y avisa con `DERIVE_FACT_RUN_RPC_ABSENT`.

## 10. Evaluation State Separation

**`PASS`.**

`AuditEvaluationEnvelopeV1` separa `decision`, `evidence`, `policy`, `system` y
`review`, con reason codes separados. Dos consecuencias concretas:

- `missingFacts` **no** activa `MISSING_EVIDENCE`. La ausencia de evidencia no es
  evidencia en contra: es un bloque distinto con su propio código.
- Un conflicto normativo **no** se convierte en evidencia contradictoria. Son capas
  distintas por construcción de tipos, no por convención.

`EvaluationSystemReasonCode` y `EvaluationReasonCode` son tipos disjuntos: un fallo del
sistema no puede disfrazarse de decisión política indeterminada.

## 11. Fact Provenance Model

**`PASS` para el contrato shadow.**

`FactProvenanceV1` conserva evidence, artifact, hash, timestamps, source text, método,
extractor ID/version y confianza cuando existe. Los campos obligatorios existen por una
razón concreta cada uno: sin hash no se puede provingir integridad; sin extractor
version no se puede atribuir el resultado; sin `documentRole` no se puede aplicar la
barrera ciega.

## 12. Fact State Model

**`PASS` para contratos shadow.**

Estados `OBSERVED`, `INFERRED`, `UNKNOWN` y `CONTRADICTORY`. **`UNKNOWN` conserva
`value: null` y no se transforma en `false`.** Es la aplicación directa de
`UNKNOWN_IS_NOT_FALSE` y está protegido por test: el caso
`partial-contact-collections` falla si una collection vacía se convierte en `FALSE`.

## 13. Extraction Tool Contract

**`PASS`.**

Zod valida input y output. El output es `.strict()` y **sólo admite `{ facts }`**. Existe
metadata estable, `deterministic`, versiones de schema y validación en runtime.

## 14. Extraction Tool Registry

**`PASS`.**

`register`, `get`, `list` y `execute`; metadata congelada, duplicados rechazados,
validación de input y de output. `execute` es un pipeline de 9 pasos: obtener
manifesto, validar referencias, extraer, validar referencias de nuevo, validar contrato,
aplicar firewall, comprobar provenance, devolver.

**`createDefaultExtractionToolRegistry` no tiene caller productivo** — verificado por
grep en la §3.2, exit 1.

## 15. Policy Firewall

**`PASS`.**

Se rechazan campos normativos en el nivel superior **y recursivamente** dentro de
`value`, objetos, arrays y records. No se permiten outcomes, decisions, rule IDs ni
policy decisions como salida de una herramienta.

Hay **dos** barreras independientes, y por eso no es una: `superRefine` sobre `value` en
el momento de la ejecución, e inspección del schema en `register()`. Una segunda
herramienta registrada con un schema que permita un outcome se rechaza en el registro,
sin llegar a ejecutarse nunca.

## 16. Reference Extraction Tools

**`PASS` como shadow / sólo test. `NOT_STARTED` como producto.**

- `extract_dates`: fechas ISO estructuradas, incluido `YYYY-MM-DD`. `deterministic: true`.
- `extract_contact_attempts`: reutiliza `extractFactsFromArtifacts` y filtra sólo
  contactos permitidos; collections vacías se mantienen `UNKNOWN`, nunca `FALSE`.

Los dos tienen **cero llamadores** en `apps/web/src/app` ni en
`apps/web/src/server/jobs` (§3.2).

Una distinción que importa: los dos no se comportan igual ante lo que no pueden
afirmar. `extract_dates` **omite** un hecho que no puede fechar (no lo afirma);
`extract_contact_attempts` lo emite con `state: 'UNKNOWN'`. No es la misma regla
aplicada dos veces.

## 17. LLM Tool Boundary

**`PASS` como frontera. `NOT_STARTED` como integración.**

El contrato de salida exige validación Zod, provenance y referencias. OpenRouter **no
fue conectado ni usado como autoridad normativa**; existe
`apps/web/src/server/ai/openrouter.ts` y no forma parte del camino de extracción.

## 18. Evidence Reference Validation

**`PASS`.**

`validateEvidenceReferences` comprueba existencia, allowlist, auditoría, artifact
asociado, hash, roles `BLIND`, referencias huérfanas y modo runtime inválido. Las
herramientas validan **antes y después** de extraer, no sólo al final.

## 19. Blind Sanitization

**`PASS` en estructura. No es una garantía criptográfica.**

El manifest es fail-closed: sólo admite `document_role = 'EVIDENCE'`, excluye roles
humanos, desconocidos y vacíos, valida las relaciones artifact-evidence antes de
filtrar, y rechaza facts/candidates inconsistentes antes de llegar al grafo y al
reasoner. La última rama del `filter` es `return false`.

Lo que la barrera **no** promete, y conviene no disfrazar: es fail-closed en el sentido
estructural (el rol manda sobre el contenido, las heurísticas sólo restan, y el
defaults es rechazar), pero no es criptográfica y no cubre el caso de una respuesta de
la IA influida por el contenido de la evidencia.

## 20. Fingerprint Determinism

**`PASS`.**

`blindCanonicalInputV1` excluye audit ID, fact run ID, UUIDs operativos y `createdAt`;
ordena por code points e incluye artifacts, facts y candidates relevantes. Repetir la
misma ejecución da la misma huella, que es lo que hace que una comparación sea
significativa.

## 21. Shadow Engine Preparation

**`PASS` como frontera. `NOT_STARTED` como uso.**

`ShadowPolicyEngine` expone únicamente `id`, `version` y `evaluate`. El runner fuerza
`authoritative: false` y `source: 'DECLARATIVE_SHADOW'`, está `Object.freeze`d y **no
tiene método de persistencia**. Sin DB, sin pathway oficial, y —verificado por
grep— **sin caller productivo**.

## 22. Tests Added

Delta de la fase completa: **225 → 319 tests (+94)**.

| Suite | Recovery | Final | Delta |
|---|---|---|---|
| `packages/domain` | 14 | 14 | 0 |
| `packages/db` | 8 | 14 | +6 |
| `packages/policy-engine` | 56 | 56 | 0 |
| `packages/reporting` | 26 | 26 | 0 |
| `apps/web` | 121 | **209** | +88 |
| **Total** | **225** | **319** | **+94** |

Añadidos por Tasks 8–12: `ai-decision-snapshot.test.ts` (36, Task 8),
`fact-run-snapshot.test.ts` (13), `human-correction.test.ts` (7),
`evaluation-persistence.test.ts` (6), `evaluation.test.ts` (6),
`fact-run-freeze.test.ts` (6, `packages/db`), `fact-reviews/route.test.ts` (4),
`fact-runs/route.test.ts` (5), `handlers.freeze.test.ts` (4),
`fact-run-snapshot.dev-e2e.test.ts` (1, `BLOCKED`).

El Golden Master sigue en 13/13 con la fixture **sin tocar**.

## 23. Regression Results

**Matriz final ejecutada en esta sesión. Códigos de salida reales.**

| # | Comando | Exit | Veredicto | Conteo |
|---|---|---|---|---|
| 1 | `pnpm.cmd typecheck` | **0** | `PASS` | 5 paquetes, `apps/web tsc --noEmit` limpio |
| 2 | `pnpm.cmd lint` | **0** | `PASS` | `eslint . --max-warnings=0` → 0 errores, 0 warnings |
| 3 | `pnpm.cmd test` | **0** | `PASS` | **319 tests** (domain 14, db 14, policy-engine 56, reporting 26, web 209 / 27 archivos) |
| 4 | `pnpm.cmd build` | **0** | `PASS` | Next 15.5.26, `✓ Compiled successfully`, 39 rutas |
| 5 | `pnpm.cmd --filter @cancelaciones/policy-engine exec vitest run src/golden-master.test.ts` | **0** | `PASS` | **13/13** tests, fixture sin tocar |
| 6 | `pnpm.cmd --filter @cancelaciones/web run test:audit:e2e` | **0** | `PASS` | **5/5** tests |
| 7 | `pnpm.cmd --filter @cancelaciones/web run test:audit:dev-e2e` | **1** | **`BLOCKED`** | 1 test, `DEV_INFRA_NOT_CONFIGURED` |
| 8 | `pnpm.cmd --filter @cancelaciones/web run test:governance:dev-e2e` | **1** | **`BLOCKED`** | 1 test, `DEV_INFRA_NOT_CONFIGURED` |
| 9 | `pnpm.cmd --filter @cancelaciones/web run test:policy-foundation:dev-e2e` | **1** | **`BLOCKED`** | 1 test, `DEV_INFRA_NOT_CONFIGURED` |

**Resumen: 6 `PASS`, 0 `FAIL`, 3 `BLOCKED`.**

Sobre las filas 7–9, que es donde es fácil engañarse: **el resultado correcto y esperado
es exit no-cero con `DEV_INFRA_NOT_CONFIGURED`.** No es un fallo que haya que explicar
ni un `PASS` que haya que disfrazar. Es `BLOCKED`, y esa es la única lectura honesta. El
mensaje literal es:

```
DEV_INFRA_NOT_CONFIGURED: NEXT_PUBLIC_INSFORGE_URL, NEXT_PUBLIC_INSFORGE_ANON_KEY,
INSFORGE_DEV_API_KEY e INSFORGE_DEV_ACTOR_ID son obligatorios. No hay fallback.
```

Las suites 7 y 8 fallaban **ya antes** de la remediación (guard `requireDevEnv`
byte-idéntico al de `410275e`): no son regresiones. La 9 es nueva de esta fase y falla
por la misma causa de entorno.

**Regresiones reales: 0.** Criterio: el diff de `packages/policy-engine/src/index.ts`
sobre `410275e` es 4 líneas añadidas y 0 borradas, el cuerpo normativo es byte-idéntico,
y el Golden Master pasa sin haber tocado la fixture.

Nota: aparece el warning preexistente «The CJS build of Vite's Node API is deprecated».
Preexistente y no afecta a la validación.

## 24. Database Validation

### **`DB VALIDATION: BLOCKED`**

No es una falta de esfuerzo: es una decisión documentada del propietario, y es la
razón por la que este reporte puede afirmar cosas que ningún test de integración
sostendría hoy.

**Por qué está bloqueado:**

- El único backend InsForge configurado en `.insforge/project.json` es el proyecto
  **base / producción**: appkey `4pw4jdzv`, host `4pw4jdzv.us-west.insforge.app`.
- La rama DEV `4pw4jdzv-cif` —que es la que exigen los guards `requireDevEnv` de los tres
  E2E, que además rechazan cualquier URL que no contenga ese appkey— **no tiene
  credenciales** en `.env`, `.env.local` ni `.insforge/project.json`.
  `INSFORGE_DEV_API_KEY` e `INSFORGE_DEV_ACTOR_ID` están ausentes.
- `@insforge/cli` **no está instalado**.

**La decisión:** escribir la migración y **no aplicarla**. Aplicar a producción, sin
credenciales DEV, sin poder ejecutar el E2E que la valida, y con dos roturas de
producción ya conocidas y documentadas en el propio SQL, habría sido actuar fuera de
autoridad. La migración queda como artefacto revisable, lista para que el propietario la
apliegue a DEV.

**Ningún secreto se imprimió.** Cuando hubo que confirmar un hecho de entorno se
reportaron únicamente el hostname y el appkey del proyecto, que no son credenciales.

**Lo que queda sin verificar, y no debe leerse como verificado:**

| Afirmación | Estado real |
|---|---|
| La sintaxis SQL es válida contra Postgres | `BLOCKED` — verificado sólo estructuralmente |
| Los triggers bloquean lo que deben | `BLOCKED` — ninguno ejecutado |
| La ACL deja a `authenticated` sin `UPDATE`/`DELETE` | `BLOCKED` — la sonda que lo comprobaría es `policy_foundation_acl_probe` y no se ha invocado |
| Los RPC funcionan | `BLOCKED` — ninguno llamado contra un Postgres |
| Las políticas RLS dejan pasar/denegar lo correcto | `BLOCKED` |

La primera ejecución real (`test:policy-foundation:dev-e2e` con credenciales DEV)
reportará probablemente alguna discrepancia de forma o tipo. **Es exactamente por eso
que la migración no se aplicó a ciegas.**

**Comandos que NO se ejecutaron en toda la fase:** `npx @insforge/cli` (ningún
subcomando, incluido `db migrations list`, `new` y `up`), `psql`, cualquier cliente de
base de datos, cualquier conexión de red a una base de datos.

## 25. Normative Divergences Discovered

**Ninguna fue corregida. Todas siguen `REQUIRES_OWNER_DECISION` y todas son del
propietario**, por `POLICY_IS_IMMUTABLE` y `ONLY_OWNER_PROVIDED_POLICY_SOURCES`.

| # | Divergencia | Estado | Disposición |
|---|---|---|---|
| 1 | **5.2 permanece parcial.** La condición no se evalúa de forma completa. | `REQUIRES_OWNER_DECISION` | **No corregida.** No tocada. |
| 2 | **5.7.e no tiene efecto de outcome conectado** en el motor actual. | `REQUIRES_OWNER_DECISION` | **No corregida.** El Golden Master congela el comportamiento actual, no el criterio. |
| 3 | **5.8.a clasifica cualquier nivel no vacío distinto de `LICENCIATURA`** como no-licenciatura. | `REQUIRES_OWNER_DECISION` | **No corregida.** La forma de la rama y sus condiciones son decisión del propietario. |
| 4 | **V2 se produce reetiquetando V5.** No es una política distinta. | `REQUIRES_OWNER_DECISION` | **No corregida.** `policySets` mapea `'2': v2Rules, '5': v5Rules` y `v2Rules` es un reetiquetado. |
| 5 | **`READY_TO_APPROVE` no considera automáticamente** todos los *software coverage gaps*. | `REQUIRES_OWNER_DECISION` | **No corregida.** `decision_status` tiene su propio CHECK y su DEFAULT. |
| 6 | La fuente local `GDM_GAM_PRD_MLG_003` sigue `PENDING_VERIFICATION`; no hay fuente `CANONICAL`. | `REQUIRES_OWNER_DECISION` | **No corregida.** Ningún documento de la fase marca una fuente como canónica. |
| 7 | Las 11 secciones del documento no están formalmente separadas en el motor. | `REQUIRES_OWNER_DECISION` | **No corregida.** |

**Los casos del Golden Master que tocan 5.7.e y 5.8.a describen lo que el motor hace
hoy** — eso es comportamiento congelado, no criterio normativo. Ningún caso afirma que
ese comportamiento sea el correcto.

## 26. Remaining Risks

Los seis concerns abiertos, cada uno con su disposición. **Ninguno se suavizó.**

### 26.1 Un Fact Run FROZEN legacy no tiene ruta de escritura de su snapshot
**`BLOCKED` — decisión del propietario.**

`freeze_fact_run_v1` exige `state = 'PROCESSING'`, y un run ya `FROZEN` no tiene salida
(`guard_fact_run_transition` no permite volver atrás). El único actor que puede hacer
ese `INSERT` hoy es el propietario de la tabla o un cliente admin. Con la migración
aplicada, el rol `authenticated` lo tiene revocado, así que la captura cae al aviso
`FROZEN_SNAPSHOT_CAPTURE_NOT_PERSISTED` y **el snapshot no queda sellado**: las
revisiones humanas **siguen aplicándose en vivo** para esos runs y
`effective_facts_fingerprint` sigue `NULL`.

Dos salidas posibles, ninguna elegida: un RPC nuevo que acepte un run `FROZEN` bajo
autorización del dueño de la auditoría, o un backfill con DDL. Es una migración
posterior.

### 26.2 `delete_audit` fallará con un Fact Run FROZEN
**`BLOCKED` — sin decidir.**

`public.delete_audit` borra la fila de `audits` y deja que el FK arrastre en `CASCADE`.
Con los triggers de inmutabilidad, la cascada aborta. En orden: `fact_run_frozen_snapshots_append_only` → `ai_decision_snapshots_append_only` → `audit_evaluation_envelopes_append_only` → `facts_guard_frozen_run_mutation`. **En cuanto una auditoría tenga cualquiera de los tres snapshots, `delete_audit` falla.**

Las dos opciones, con su coste:

| Opción | Coste | Beneficio |
|---|---|---|
| **(a) Aceptar que no se puede borrar** un audit con fact run FROZEN | No hay ruta para el caso real de «esta auditoría se creó por error» — que es justo el motivo de existencia de `delete_audit`. Exige una segunda vía (archivar/anular) que hoy no existe. | Coherente con `PRESERVE_MACHINE_DECISION`. Cero riesgo de perder evidencia de máquina. |
| **(b) Ruta de purga explícita y registrada** que escriba el inventario en `audit_log` antes de borrar, y que requiera flag/`reason` explícito y quizá rol OWNER | Abre una vía de borrado de evidencia de máquina. Hay que diseñar quién puede activarla, con qué condiciones y qué se registra. | Conserva la capacidad de borrar duplicados reales. |

**No se eligió entre (a) y (b).** Es política de borrado de evidencia, no código. No se
añadió ninguna puerta trasera, flag de bypass ni GUC de escape. Efecto colateral ya
visible: el cleanup del E2E de DEV pasa a ser no-op silencioso y dejará residuo.

### 26.3 El propietario de la tabla puede borrar un `fact_extraction_runs` FROZEN
**`BLOCKED` — documentado, mecanismo abierto.**

`REVOKE DELETE … FROM authenticated` cierra al rol de cliente, así que **la app no puede
borrarlos**. Lo que queda abierto es el propietario de la tabla / DDL / el cliente
admin. No se añadió trigger de `BEFORE DELETE` a propósito: el cleanup del E2E de
pipeline borra `fact_extraction_runs` y depende de que eso funcione. Cerrarlo exige
coordinar un trigger con una migración que actualice ese cleanup.

### 26.4 Las suites E2E de DEV están `BLOCKED` y excluidas del `test` por diseño
**`BLOCKED` — por diseño, no por descuido.**

`apps/web` excluye los tres E2E de DEV del script `test` explícitamente, para que
`pnpm test` siga siendo una señal verde sin infraestructura DEV. Se ejecutan a mano y se
reportan por separado; los tres dan `BLOCKED`. El coste es real y conviene decirlo: si
alguien rompe una aserción de un E2E de DEV, `pnpm test` no se entera.

### 26.5 El `integrity_hash` de una captura legacy no es comparable con el del servidor
**Mitigado, no resuelto.**

`freeze_fact_run_v1` calcula el hash en el servidor con
`jsonb_build_object(...)::text`. La captura legacy, al no haber RPC, lo calcula la
aplicación con
`sha256(stableFingerprint({ auditId, factRunId, extractorVersion, policySourceId, canonical, effective, facts, provenance, factReviews }))`.
**Son fórmulas distintas, así que los dos hashes no son comparables entre sí.**
Mitigación: esos snapshots llevan `provenance.origin = 'IMPORTED'`, que los distingue de
los sellados por el servidor. **No verificado contra un Postgres real** — `BLOCKED`.

### 26.6 `POLICY_SOURCE_ID` está cableado en tres ficheros
**Abierto, decisión del propietario.**

`'gdm-gam-prd-mlg-003-local-unverified'` está hardcodeado en
`apps/web/src/server/jobs/handlers.ts:31`,
`apps/web/src/app/api/audits/[auditId]/fact-runs/route.ts:12` y
`apps/web/src/app/api/audits/[auditId]/fact-reviews/route.ts:12`. Debería resolverse por
código y versión desde `policy_source_registry`. No se cambió porque implicaría una
consulta en cada congelado y una decisión sobre cuál de varias fuentes registradas manda.
Consecuencia honesta: con la migración aplicada, congelar exigiría que ese documento esté
registrado, y si el propietario lo purga el congelado fallará con
`POLICY_SOURCE_NOT_REGISTERED`.

## 27. Remaining Blockers

| # | Blocker | Tipo | Quién lo resuelve |
|---|---|---|---|
| 1 | **DB validation.** La migración no aplicada, ningún trigger/ACL/RPC ejecutado, tres E2E DEV `BLOCKED`. | Entorno | Propietario (credenciales DEV) |
| 2 | **Fact Run FROZEN legacy sin snapshot** (§26.1). | Diseño | Propietario (RPC nuevo o backfill) |
| 3 | **`delete_audit` incompatible con FROZEN** (§26.2). | Diseño | Propietario (a o b) |
| 4 | **DELETE de FROZEN por el propietario de la tabla** (§26.3). | Diseño | Propietario |
| 5 | **Fuente normativa sin verificar** — no hay fuente `CANONICAL`. | Normativo | Propietario |
| 6 | **7 divergencias normativas** sin corregir (§25). | Normativo | Propietario |
| 7 | **`api/dev/synthetic-case` inserta directo en `engine_runs`**, que con la migración aplicada estará revocado. No se tocó: fuera del alcance. | Código | Propietario, antes de aplicar la migración |
| 8 | **Tres sitios se romperán al aplicar la migración** si no secoordinate: el RPC de persistencia (ya integrado en Task 10), `freezeRun` (ya corregido en Task 10) y `synthetic-case` (sin tocar). | Código | Propietario |

Sobre el punto 7, conviene ser explícito: **es el tercer sitio que se romperá al
aplicar la migración** y no se ha corregido. No estaba en el alcance de ninguna tarea.

## 28. Readiness for Declarative Rules

**`NO`.**

Golden Master, shadow boundary, contratos y evidencia están listos como base técnica.
Pero:

1. La fuente normativa continúa `PENDING_VERIFICATION`.
2. Los invariantes DB de inmutabilidad **existen sólo como SQL sin aplicar**.
3. No hay ninguna validación real: 3 E2E `BLOCKED`, 7 divergencias normativas abiertas.

**Ninguna de estas tres condiciones se resuelve escribiendo más código.** Son
decisiones y credenciales.

## 29. Readiness for LLM Extraction Tools

**`NO` como producto. `YES` como frontera técnica.**

La frontera LLM está especificada, probada y deliberadamente desconectada. Las dos
herramientas son `deterministic: true` y no hay caller productivo de ninguna.

Lo que falta y **no** se puede resolver con código: aplicar la migración, validar en
DEV, y cerrar los blockers 1–4 de la §27. La frontera está lista; las garantías de
producción no.

## 30. Recommended Next Phase

### **La fase está CERRADA.**

Tasks 1–12 completadas. El reporte final existe. Este documento es el entregable para
revisión humana y **no inicia ninguna fase posterior**.

```text
EXTRACTION TOOLS + DECLARATIVE SHADOW ENGINE
```

**`EXTRACTION TOOLS + DECLARATIVE SHADOW ENGINE` NO DEBE EMPEZAR hasta que una persona
revise este reporte.** Concretamente, hasta que se decida:

1. Aplicar o no la migración `20260925120000_policy-foundation-immutability.sql` a DEV,
   y qué se hace con `synthetic-case` antes de hacerlo (§27.7).
2. El hueco del Fact Run FROZEN legacy (§26.1).
3. `delete_audit`: opción (a) u opción (b) (§26.2).
4. Las 7 divergencias normativas (§25) y la verificación de la fuente (§27.5).

Orden recomendado cuando haya autorización:

1. Credenciales DEV → aplicar la migración → correr
   `test:policy-foundation:dev-e2e` y arreglar lo que falle.
2. Cerrar los blockers de diseño 2, 3 y 4.
3. Sólo entonces, y sólo con autorización explícita, la fase siguiente.

---

## Matriz de readiness

| Capability | Status | Evidence |
|---|---|---|
| Policy source canonical | **BLOCKED** | registry existe (4 tests); la fuente local sigue `PENDING_VERIFICATION`. Ningún documento la marca `CANONICAL`. |
| Golden Master | **PASS** | `golden-master.test.ts` **13/13** exit 0; 12 casos; fixture hash LF `38e29f44…d76` verificado por 2 métodos. Debilidad documentada en §5.2. |
| Frozen Fact Runs immutable | **BLOCKED** | 4 triggers + RPC + tabla append-only **escritos** en la migración; **no** ejecutados. En código, máquina de estados legal recorrida y `DRAFT→FROZEN` corregido (test). |
| AI_DECISION_V1 durable | **BLOCKED** | `appendAiDecisionV1` + hash de 16 campos existen y tienen 36 tests. La **tabla no existe**; unicidad = check-then-act, no restricción. |
| AI_DECISION_V1 immutable | **BLOCKED** | `REVOKE` + trigger + índice único escritos. **Ninguno ejecutado.** |
| Human corrections versioned | **BLOCKED** | `deriveFactRunFromReviews` + ruta de API existen (7 + 4 tests); padre intacto afirmado por test. El RPC y la tabla de snapshot no existen. |
| State separation | **PASS** | `evaluation-envelope.test.ts` **6/6**; tipos disjuntos `EvaluationSystemReasonCode` / `EvaluationReasonCode`. |
| Full fact provenance | **PASS** | contratos de dominio (7 tests) + validación de referencias (8 tests) + campos de provenance en el contrato de tools. |
| Tool contract | **PASS** | `contracts.test.ts` **3/3** — Zod `.strict()`, sólo `{ facts }`. |
| Tool registry | **PASS** | `registry.test.ts` **11/11** — `register`/`get`/`list`/`execute`, duplicados rechazados. |
| Policy firewall | **PASS** | dos barreras: `superRefine` recursivo + inspección de schema en `register()`. |
| Evidence ref validation | **PASS** | `evidence-reference-validation.test.ts` **8/8` — allowlist, roles BLIND, huérfanas, hash de artifact. |
| Blind sanitization | **PASS** | `blind-evidence-sanitizer.test.ts` **11/11** — manifest fail-closed, `return false` por defecto. No es garantía criptográfica (§19). |
| Stable fingerprints | **PASS** | fingerprints reproducibles sin IDs/timestamps operativos; aserción por caso en el Golden Master. |
| Golden tests | **PASS** | **13/13** con la fixture sin tocar; hash verificado. |
| Shadow engine boundary | **PASS** | `shadow-engine.test.ts` **4/4**; `authoritative: false` forzado, runner `Object.freeze`d sin persistencia, **cero caller productivo** (grep exit 1). |
| Declarative migration ready | **NO** | SQL escrito y commiteado pero **no aplicado**; DB validation `BLOCKED`; fuente normativa sin verificar; 7 divergencias abiertas. |
| LLM extraction tools ready | **NO** | Frontera técnica lista, pero las 2 herramientas tienen **cero callers** y las garantías de producción (migración, RLS, E2E DEV) siguen sin verificar. |

**Totales: 11 `PASS`, 0 `FAIL`, 7 `BLOCKED`, 2 `NO`.**

### Verificación de la matriz de comandos (ejecutada, no inferida)

| Veredicto | Comandos | Conteo |
|---|---|---|
| `PASS` | typecheck, lint, test, build, golden master, `test:audit:e2e` | **6** |
| `FAIL` | — | **0** |
| `BLOCKED` | `test:audit:dev-e2e`, `test:governance:dev-e2e`, `test:policy-foundation:dev-e2e` | **3** |
| `NOT_STARTED` | migración aplicada, validación RLS/ACL real, callers productivos de tools y shadow engine | **4** |
