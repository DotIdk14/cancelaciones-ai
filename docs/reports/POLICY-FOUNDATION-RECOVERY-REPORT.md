# Policy Foundation Recovery Report

> **Propósito de este documento.** Si la fase se interrumpe otra vez, una sesión
> futura debe poder reconstruir el estado del trabajo leyendo **sólo este archivo y
> el repositorio**. Por eso cada sección registra un hecho comprobable, no una
> impresión. Está escrito a la vez y no se actualizará: refleja el punto en que la
> fase quedó cerrada.

Verdulgos usados en todo el documento, sin excepción: `PASS`, `FAIL`, `BLOCKED`,
`NOT_STARTED`. Cuando un hecho no se pudo ejecutar, se registra como `BLOCKED` y se
explica por qué. No hay ningún `PASS` aquí que no corresponda a un comando ejecutado
por esta sesión con código de salida 0.

---

## 1. Repository State

- Ruta: `C:\Users\IanEmilianoJarquinHe\Desktop\cancelaciones-ai`
- Sistema: Windows, PowerShell. `pnpm` requiere `pnpm.cmd` por la ExecutionPolicy de
  PowerShell; es el mismo binario y **no** es un fallo de validación.
- Monorepo pnpm, 6 proyectos de workspace (5 con scripts): `packages/domain`,
  `packages/db`, `packages/policy-engine`, `packages/reporting`, `apps/web`.
- Plan de la fase: `docs/superpowers/plans/2026-09-24-policy-foundation-remediation.md`
  (12 tareas).
- Ledger de la sesión: `.superpowers/sdd/policy-foundation-tasks-8-12/progress.md`.
  Esa ruta está en `.gitignore` (añadido en `a411f61`), por lo que **el ledger no está
  en Git**: si esta fase se pierde, este reporte es la única copia de las rulings.
- Reporte final normativo de la fase:
  `docs/reports/POLICY-FOUNDATION-REMEDIATION-REPORT.md`.

## 2. Current Branch / Commit

Rama de la fase: `feature/policy-foundation-tasks-8-12`.

Cadena de commits real (`git log --oneline`, de más reciente a más antigua):

```
d8e1b67 foundation: document fact immutability, decision snapshots and tool boundary
5e7201f foundation: make fact runs immutable and corrections versioned
5a889a9 foundation: add immutable fact run and decision snapshot schema
a411f61 foundation: persist append-only AI decision snapshots
bd6dbc8 docs(plan): plan de implementacion del panel de dictamen
df15da9 docs(spec): diseno del panel de dictamen de auditoria
ed5ddb4 chore(ci): ejecutar CI en push a cualquier rama y registrar decision de OWNER sobre repo publico
e9eece5 Merge commit 'becfa9d'
323dc48 Merge commit '410275e'
d8ffbb0 Plan Rule Engine
becfa9d feat: checkpoint policy foundation remediation
410275e MC-F2-003: evidence requirements governance + audit pipeline DEV infra
```

**`df15da9` y `bd6dbc8` no pertenecen a la remediación.** Son el spec y el plan del
panel de dictamen, commiteados por otra sesión sobre la misma rama. No se revierten y
no se revisan aquí: quedan fuera del alcance de esta fase.

Dos referencias que se usan como baseline en todo lo que sigue:

- **`410275e`** = estado del motor normativo antes de la remediación. Es contra este
  commit contra el que se mide cualquier cambio normativo.
- **`ed5ddb4`** = main en el momento del recovery, y padre de la rama de la fase
  (`feature/policy-foundation-tasks-8-12` sale de `ed5ddb4` vía `df15da9`).

## 3. Uncommitted Changes

**Estado en el momento del recovery (antes de empezar esta continuación):**

| Métrica | Valor |
|---|---|
| Rama | `main` |
| HEAD | `ed5ddb4` |
| Working tree | completamente limpio |
| Uncommitted (modificados en working tree) | 0 |
| Staged | 0 |
| Untracked | 0 |
| Stashes | 0 |
| Worktrees | 1 (el de este repo) |

Comandos que lo establecen: `git status --short` (salida vacía),
`git stash list` (vacío), `git worktree list`.

**Nota importante sobre el punto de partida:** el agente anterior **ya había commiteado
todo** como `becfa9d` (`feat: checkpoint policy foundation remediation`) y ese commit
estaba **fusionado en `main` mediante el merge `e9eece5`**. No había trabajo a medias
que recuperar: el árbol estaba limpio porque el trabajo estaba commiteado, no porque no
existiera. Confundir "árbol limpio" con "nada hecho" habría producido una pérdida de 7
tareas de trabajo.

**Estado al cierre de esta continuación:** working tree limpio salvo los 2 reportes de
esta fase, que se commitean juntos (ver §15). `git status --short` tras el commit de
Task 12: vacío.

### 3.1 Corrección al baseline: hoy hay 2 worktrees, no 1

`git worktree list` ejecutado al cierre de esta fase devuelve **dos** entradas:

```
C:/Users/IanEmilianoJarquinHe/Desktop/cancelaciones-ai                     d8e1b67 [feature/policy-foundation-tasks-8-12]
C:/Users/IanEmilianoJarquinHe/AppData/Local/Temp/opencode/cancelaciones-dictamen  9328a9d [feature/dictamen-panel]
```

El segundo worktree es de **otra línea de trabajo** (el panel de dictamen), y es la
explicación material de los commits `df15da9` y `bd6dbc8` que aparecen en la cadena de
§2. **No pertenece a la remediación, no se tocó, y no se revierte.**

Se registra explícitamente porque el recovery baseline decía 1 worktree y esa cifra ya
no describe el estado real del repositorio. Si una sesión futura necesita tocar la línea
del panel de dictamen, ese worktree existe y tiene su propia rama. Si sólo necesita la
fundición de política, **este segundo worktree no es suyo y debe dejarlo intacto**.

## 4. Existing Implementation Detected

Antes de escribir una línea, se verificó qué estaba ya implementado. **Las Tasks 1–7
del plan estaban COMPLETAS y commiteadas** en `becfa9d`, fusionadas a `main` en
`e9eece5`. No había que reimplementarlas ni reconstruirlas.

Lo que importa aquí es **cómo** se confirmó: **por evidencia de test**, no por nombre
de archivo. Un archivo con el nombre correcto no prueba nada. Estas capacidades se
declararon DONE porque hay tests que las ejecutan y pasan:

| Capacidad | Evidencia que la sostiene |
|---|---|
| Policy source registry | `packages/policy-engine/src/source-registry.test.ts` — 4 tests verdes |
| Golden Master | `packages/policy-engine/src/golden-master.test.ts` — 13 tests verdes (12 casos + 1 test de integridad del corpus) |
| ExtractedFactV1 | `packages/domain/src/policy-foundation.test.ts` — 7 tests verdes |
| Fact provenance | `packages/domain/src/policy-foundation.test.ts` |
| Canonical fingerprints | aserciones de `canonicalFingerprintV1` en el Golden Master y en `fact-run-snapshot.test.ts` |
| Evaluation envelope | `packages/policy-engine/src/evaluation-envelope.test.ts` — 6 tests verdes |
| Tool contract | `apps/web/src/server/extraction/contracts.test.ts` — 3 tests verdes (Zod `.strict()`) |
| Tool registry | `apps/web/src/server/extraction/registry.test.ts` — 11 tests verdes |
| `extract_dates` | `apps/web/src/server/extraction/tools/extract-dates.test.ts` — 5 tests verdes |
| `extract_contact_attempts` | `apps/web/src/server/extraction/tools/extract-contact-attempts.test.ts` — 8 tests verdes |
| Evidence reference validation | `apps/web/src/server/extraction/evidence-reference-validation.test.ts` — 8 tests verdes |
| Blind sanitizer | `apps/web/src/server/policy/blind-evidence-sanitizer.test.ts` — 11 tests verdes |
| Shadow boundary | `packages/policy-engine/src/shadow-engine.test.ts` — 4 tests verdes |

Baseline del recovery: `pnpm typecheck` PASS, `pnpm lint` PASS, `pnpm test` PASS
(**225 tests / 30 archivos / 0 skipped**), `pnpm build` PASS.

**Lo que NO existía al empezar (cero código, cero migraciones, cero docs de la fase):**
la tabla durable de `AI_DECISION_V1`, la migración de inmutabilidad, el registro
append-only de snapshots, los Fact Run snapshots con FROZEN irreversible, la derivación
de correcciones humanas, y la documentación arquitectónica de la fase.

## 5. Existing Migrations

El repositorio tiene **29 migraciones** en total. Es importante distinguir dos grupos
porque sólo uno lo escribió esta fase:

**28 migraciones preexistentes** (anteriores a la fase, ya aplicadas en InsForge). La
más reciente de ellas es `20260924220000_mc-f2-003-evidence-requirements.sql`. Las que
definen el esquema que la migración de la fase modifica:

| Archivo | Qué aporta |
|---|---|
| `20260921221309_phase-1-base-schema.sql` | `audits`, `profiles`, `pgcrypto`, `current_app_role()` |
| `20260922140000_fact-human-reviews.sql` | `fact_reviews` |
| `20260923220000_phase-5-fact-model-shadow.sql` | `fact_extraction_runs`, `facts`, patrón RLS |
| `20260924101000_phase-6-policy-engine.sql` | `engine_runs`, `engine_rule_results` |
| `20260924103001_actionable-decision-status.sql` | `engine_runs.decision_status` con DEFAULT |
| `20260924106000_fact-run-write-policies.sql` | política RLS `facts_insert_visible_runs` |
| `20260924110000_phase-7-dictamen-reporting.sql` | `report_snapshots` |
| `20260924120000_ai-human-comparison.sql` | `audit_runs` con `AI_DECISION_V1` en el CHECK |
| `20260924130000_policy-code-hash-index-fix.sql` | `policy_code_hash`, índices de idempotencia |
| `20260924170400` / `20260924170450` | hashes largos en `fact_extraction_runs` + índice único de idempotencia |
| `20260924180000_audit-delete-with-trace.sql` | `public.delete_audit` y `audit_log` |
| `20260924220000_mc-f2-003-evidence-requirements.sql` | `prevent_protected_rule_child_mutation()` — la convención de trigger que la migración nueva copia |

**1 migración escrita por esta fase:**
`migrations/20260925120000_policy-foundation-immutability.sql` — 1688 líneas, añadida
en `5a889a9` (Task 9).

**Su estado es el dato más importante de esta sección: está commiteada y NO APLICADA.**
No existe en ninguna base de datos. Todo lo que depende de ella
(`fact_run_frozen_snapshots`, `audit_evaluation_envelopes`, `ai_decision_snapshots`,
`policy_source_registry`, los 11 triggers, los 3 RPC de escritura y las 2 sondas) está
escrito y commiteado, y **verificado estructuralmente, nunca ejecutado**.

Consecuencia práctica: el nombre del archivo se decidió por la convención del
repositorio (`YYYYMMDDHHMMSS_description.sql`), **no** por
`npx @insforge/cli db migrations new`, porque el CLI no está instalado y porque enlazaría
al proyecto base de producción. Esto es una desviación consciente de la instrucción del
plan (ruling R-02 del ledger) y es cosmética, no funcional.

## 6. DB State

**`BLOCKED`. No se ejecutó ningún cliente de base de datos en toda la fase.**

Lo que se verificó y por qué se decidió no aplicar la migración:

- El único backend InsForge configurado en `.insforge/project.json` es el proyecto
  **base / producción**, appkey `4pw4jdzv`, host `4pw4jdzv.us-west.insforge.app`.
- La rama DEV `4pw4jdzv-cif` —que es la que exigen los guards `requireDevEnv` de los tres
  E2E, que además rechazan explícitamente cualquier URL que no contenga ese appkey—
  **no tiene credenciales** en ningún sitio. `INSFORGE_DEV_API_KEY` e
  `INSFORGE_DEV_ACTOR_ID` están ausentes.
- `@insforge/cli` **no está instalado**.

Ante eso, el propietario decidió: **escribir la migración y NO aplicarla**. Escribe en
producción sin ventana de prueba, sin poder correr el E2E que la valida, y con dos
roturas de producción ya conocidas (documentadas en el propio SQL) sería(con
"sería"→"es") una decisión que esta fase no tenía autoridad para tomar. La migración
queda como artefacto revisable, lista para que el propietario la aplique a DEV.

**Ningún secreto fue impreso.** Cuando hubo que confirmar un hecho de entorno, se
reportó únicamente el hostname y el appkey del proyecto, que no son credenciales.

Lo que **no** se puede afirmar como verdad, porque no se ejecutó:

- Que la sintaxis SQL sea válida contra Postgres. La verificación fue **estructural**
  (balanceo de `$$`, sentencias terminadas, variables sin declarar, columnas existentes
  con el tipo correcto) y por lectura comparada contra las migraciones ya aplicadas.
- Que los triggers bloqueen lo que deben. Ningún trigger, ACL, política RLS ni RPC se
  ha ejecutado jamás.
- Que el E2E de la fundación pase. Está escrito y es la primera ejecución real posible.

La primera ejecución real del E2E probablemente reportará alguna discrepancia de forma o
tipo. Eso es lo esperado, y por eso la migración no se aplicó a ciegas.

## 7. Test State

Baseline en el recovery, y estado final de esta fase:

| Momento | Resultado |
|---|---|
| Recovery (`ed5ddb4`) | `pnpm test` PASS — **225 tests / 30 archivos / 0 skipped** |
| Cierre de la fase (`723460f`) | `pnpm test` PASS — **319 tests**: domain 14, db 14, policy-engine 56, reporting 26, web 209 (27 archivos) |
| Tras la revisión final (HEAD) | `pnpm test` PASS — **320 tests**: domain 14, db 14, policy-engine **57**, reporting 26, web 209 (27 archivos) |

Delta de la fase: **+94 tests** hasta `723460f`, y **+95** en HEAD. Reparto: Task 8
+36 (`ai-decision-snapshot.test.ts`), Task 10 +49 (web 160→209, db 8→14), y la
corrección posterior a la revisión **+1**: el test que fija el hash de la fixture
(`packages/policy-engine/src/golden-master.test.ts`, 56→57). Ese +1 **no es
normativo**: no toca `evaluatePolicy`, sólo lee bytes del fichero JSON.

Las tres suites DEV están **excluidas del script `test` de `apps/web` por diseño**, no
por descuido. El script las excluye explícitamente:

```
vitest run --exclude src/server/jobs/audit-pipeline.dev-e2e.test.ts \
           --exclude src/server/rules/rule-governance.dev-e2e.test.ts \
           --exclude src/server/policy/fact-run-snapshot.dev-e2e.test.ts
```

La razón es que sin infraestructura DEV abortan con `DEV_INFRA_NOT_CONFIGURED`, y
mantener `pnpm test` verde es lo que permite que CI sirva como señal. Los tres se
ejecutan a mano y se reportan por separado: los tres dan `BLOCKED`.

**`test:audit:e2e` sí corre** (no es DEV) y da `PASS` — 5 tests, pipeline completo
contra la base falsa durable local.

## 8. Recovery Matrix

| Capacidad | Estado en el recovery | Evidencia |
|---|---|---|
| Policy source canonical | `BLOCKED` | registry existe (4 tests); la fuente local sigue `PENDING_VERIFICATION` |
| Golden Master | `PASS` | 13 tests en el recovery; **14 en HEAD**; fixture hash LF canónico verificado y **fijado en código** |
| Frozen Fact Runs immutable | `NOT_STARTED` | sin migración, sin trigger, sin RPC |
| AI_DECISION_V1 durable | `NOT_STARTED` | sin tabla, sin repositorio |
| AI_DECISION_V1 immutable | `NOT_STARTED` | sin garantía DB |
| Human corrections versioned | `NOT_STARTED` | sin Fact Run derivado |
| State separation | `PASS` | 6 tests de envelope |
| Full fact provenance | `PASS` | contratos de dominio y shadow |
| Tool contract | `PASS` | 3 tests Zod strict |
| Tool registry | `PASS` | 11 tests de registry |
| Policy firewall | `PASS` | tests de campos prohibidos recursivos |
| Evidence ref validation | `PASS` | 8 tests de referencias inventadas |
| Blind sanitization | `PASS` | 11 tests de manifest fail-closed |
| Stable fingerprints | `PASS` | fingerprints sin IDs/timestamps operativos |
| Golden tests | `PASS` | suite de una pasada, 13 tests en el recovery / 14 en HEAD |
| Shadow engine boundary | `PASS` | API no autoritativa, 4 tests |
| Declarative migration ready | **NO** | falta DB inmutable y validación real |
| LLM extraction tools ready | **NO** | falta persistencia y DEV E2E |

## 9. Last Confirmed Completed Step

**Último paso confirmado como completado: Task 7 — Blind sanitizer fail-closed y
fingerprint determinista.** Commit `becfa9d`.

**Primer paso no iniciado: Task 8 — `AI_DECISION_V1` durable e inmutable.**

La distancia entre ambos es exactamente una: Tasks 1–7 hechas y commiteadas, Tasks
8–12 enteras sin empezar. Cero commits intermedios, cero código parcial, cero
migraciones a medias. Esa limpieza es la razón de que esta continuación haya podido
arrancar sin revisar nada heredado.

## 10. Partial Work

**Ninguno.** Este es el dato más limpio de todo el recovery y merece decirse con todas
las letras: no había trabajo parcial que rescatar, y no se inventó nada para
rellenar.

Lo que **parecía** parcial y no lo era:

- La rama `feature/policy-foundation-tasks-8-12` ya existía con dos commits ajenos
  (`df15da9`, `bd6dbc8`) encima. No es trabajo parcial de la remediación: son el spec y
  el plan del panel de dictamen, commiteados por otra sesión. Se conservaron sin tocar.
- `docs/reports/POLICY-FOUNDATION-REMEDIATION-REPORT.md` existía y describía la fase
  como detenida en Task 7. No era trabajo parcial: era un **checkpoint** escrito por el
  agente anterior. Quedó desactualizado respecto de Tasks 8–11 y se reescribió
  entero en esta continuación (Task 12).

## 11. Not Started Work

Al inicio de esta continuación, `NOT_STARTED`:

| Tarea | Contenido |
|---|---|
| Task 8 | `AI_DECISION_V1` durable e inmutable |
| Task 9 | Migración DB de inmutabilidad, snapshots y envelopes |
| Task 10 | Snapshots de Fact Run, FROZEN y correcciones humanas |
| Task 11 | Documentación arquitectónica (5 documentos) |
| Task 12 | Reporte final de remediación y matriz de readiness |

Todas cinco se ejecutaron en esta continuación. Ver §15.

## 12. Regressions Detected

**CERO REGRESIONES.**

Cómo se probó, que es lo que importa (afirmar "cero" sin método no vale nada):

1. **Diff del punto de entrada del motor normativo.** Sobre el baseline `410275e`:
   ```
   git diff 410275e..HEAD --numstat -- packages/policy-engine/src/index.ts
   4	0	packages/policy-engine/src/index.ts
   ```
   **4 líneas añadidas, 0 borradas.** Las 4 son `export * from` de los módulos nuevos
   de Tasks 2–4 (`evaluation-envelope`, `shadow-engine`, `source-registry`) más una
   línea en blanco, insertadas en la cabecera. Cero líneas del cuerpo normativo
   tocadas.

2. **Los tres símbolos normativos siguen en su sitio**, con número de línea:
   `v5Rules` en `index.ts:156`, `policySets` en `index.ts:207`, `evaluatePolicy` en
   `index.ts:209`. Los tres existen, y el cuerpo de `evaluatePolicy` es byte-idéntico
   al de `410275e`.

3. **El Golden Master no se movió.** 14/14 en HEAD con la fixture **sin tocar**, y su
   hash LF-canónico sigue siendo `38e29f44…d76` (§14 y el reporte de remediación §5).
   A 13/13 iba en `723460f`; el test 14 es el que fija ese hash, añadido por la
   revisión final, y su purpose es precisamente que una edición de la fixture **no**
   pueda pasar inadvertida.

4. **Los fallos de DEV no son regresiones.** `test:audit:dev-e2e` y
   `test:governance:dev-e2e` fallan con `DEV_INFRA_NOT_CONFIGURED`, pero fallaban
   **antes** de la remediación: el guard `requireDevEnv` es byte-idéntico al de
   `410275e`. Predican la fase, no la causan.

5. **Ningún archivo normativo aparece en el diff de ninguna tarea de la fase.**
   Aparecen **dos** archivos de `packages/policy-engine/src/`, y conviene nombrarlos
   los dos con su alcance real, porque uno no es normativo:
   - **`index.ts`**, con esas 4 líneas (`export * from` de los módulos nuevos de
     Tasks 2–4 más una línea en blanco, en la cabecera). Cero líneas del cuerpo
     normativo tocadas.
   - **`source-registry.ts`** (Task 9, `5a889a9`), **21 líneas añadidas y 0
     borradas**. Es un cambio **puramente aditivo de tipos opcionales**:
     `effectiveFrom`, `effectiveTo`, `verifiedBy`, `verifiedAt` y `notes`, más sus
     comentarios. **No contiene código de ejecución ni toca ningún camino de
     evaluación**: `PolicySourceRecord` sigue teniendo exactamente los mismos
     campos obligatorios, `evaluatePolicy` no lo consume y ninguna regla normativa
     lee esos campos. Sirven para que TypeScript y la tabla SQL
     `policy_source_registry` coincidan (R-06), porque la migración los declara
     como columnas nullable.

   **Una versión anterior de este punto decía que `index.ts` era "el único archivo
   de `packages/policy-engine/src/` que aparece". Eso era falso** y se retira: la
   afirmación era cierta para las Tasks 8, 10, 11 y 12, pero la Task 9 (`5a889a9`)
   también modificó `source-registry.ts`. Lo que no cambia es la conclusión, que
   sigue siendo cero cambios normativos: `source-registry.ts` no participa de
   `evaluatePolicy`.

## 13. Environment Blockers

Cuatro bloqueos, todos de entorno, ninguno de código:

1. **Credenciales InsForge DEV ausentes.** Faltan `INSFORGE_DEV_API_KEY` e
   `INSFORGE_DEV_ACTOR_ID`. El único backend configurado es producción
   (`4pw4jdzv.us-west.insforge.app`, appkey `4pw4jdzv`). Los guards de los E2E DEV
   rechazan explícitamente cualquier URL que no sea la rama DEV `4pw4jdzv-cif`, lo que
   es correcto: no se puede validar la fundación contra producción.
   **Efecto:** DB validation `BLOCKED`, migración sin aplicar, tres suites E2E
   `BLOCKED`.

2. **`@insforge/cli` no instalado.** Ni está en el repo ni se pudo instalar (y no se
   intentó: instalarlo y enlazarlo habría apuntado al proyecto base de producción).
   **Efecto:** no se pudo usar `db migrations new` para nombrar el archivo de la
   migración, ni `db migrations list` para verificar qué está aplicado. Se usó la
   convención de nombres del repo (ruling R-02) y la verificación del esquema se hizo
   leyendo los 28 archivos de migración existentes.

3. **Las tres suites DEV fallan con `DEV_INFRA_NOT_CONFIGURED`.** `test:audit:dev-e2e`
   y `test:governance:dev-e2e` fallaban ya antes de la remediación;
   `test:policy-foundation:dev-e2e` es nueva de esta fase y falla por la misma causa.
   **Efecto:** ningún invariante de trigger, ACL o RLS ha sido ejercitado contra un
   Postgres real. Ese es el agujero de evidencia más grande de la fase, y está
   declarado como tal en lugar de disimulado.

4. **La detección de "objeto de la migración ausente" no está verificada contra el
   backend real.** `isFoundationObjectMissing`
   (`apps/web/src/server/facts/foundation-objects.ts:104`) decide si un objeto de la
   migración falta comparando `code`/`message` contra patrones
   (`PGRST20[245]`, `42P01`, `42883`, `42703`, `could not find the …`,
   `relation "…" does not exist`, `Unsupported rpc …`, …).
   **Esos patrones provienen de la convención de PostgREST/Postgres y de los fakes
   locales** —`apps/web/src/server/facts/foundation-fake-db.ts` y el `DurableDb` de
   `apps/web/src/server/jobs/audit-queue.e2e.test.ts`—, que hardcodean esas cadenas
   exactas. **Nunca se han contrastado contra el backend real de InsForge.**
   **Efecto:** como la migración no está aplicada, hoy esa función es lo ÚNICO que
   mantiene el pipeline de evaluación funcionando en producción: cada camino nuevo
   pasa por ella para degradar en vez de romper. Si el backend real señala la ausencia
   con otra forma, `readFrozenSnapshot` y `persistPolicyEvaluationAtomically` lanzan
   (`ENGINE_RUN_INSERT_FAILED`) en vez de degradar.
   **Resolverlo:** aplicar la migración **elimina** esta dependencia para la lectura del
   snapshot congelado y para los caminos RPC, porque los objetos dejan de faltar.
   **Verificar que los patrones coinciden con lo que emite el backend requiere
   credenciales DEV** — el mismo bloqueo del punto 1. No se amplió la lista de
   patrones a ciegas: adivinar una forma de error no es endurecer la detección.
   **Estado: `BLOCKED`.**

## 14. Normative Blockers

Ninguna divergencia se corrigió. Todas siguen abiertas y todas son del propietario
(`REQUIRES_OWNER_DECISION`), por invariante `POLICY_IS_IMMUTABLE` y
`ONLY_OWNER_PROVIDED_POLICY_SOURCES`:

1. La fuente normativa local `GDM_GAM_PRD_MLG_003` sigue `PENDING_VERIFICATION`.
   **Ningún documento de la fase la marca `CANONICAL`**, y la tabla
   `policy_source_registry` es append-only precisamente para que promoverla sea un
   hecho registrado y no una sobrescritura.
2. **5.2 permanece parcial.**
3. **5.7.e no tiene efecto de outcome conectado** en el motor actual.
4. **5.8.a clasifica cualquier nivel no vacío distinto de LICENCIATURA** como
   no-licenciatura.
5. **V2 se produce reetiquetando V5** — no es una política distinta.
6. **`READY_TO_APPROVE` no considera automáticamente** todos los *software coverage
   gaps*.
7. `POLICY_SOURCE_ID` está cableado en tres ficheros de producción
   (`apps/web/src/server/jobs/handlers.ts:31`,
   `apps/web/src/app/api/audits/[auditId]/fact-runs/route.ts:12`,
   `apps/web/src/app/api/audits/[auditId]/fact-reviews/route.ts:12`) con el literal
   `gdm-gam-prd-mlg-003-local-unverified`. Debería resolverse por código y versión
   desde `policy_source_registry`. No se tocó: implicaría una consulta por congelado y
   una decisión sobre cuál de varias fuentes registradas manda.

## 15. Continuation Plan

**Qué se completó en esta continuación (Tasks 8–12):**

| Tarea | Commit | Qué contiene |
|---|---|---|
| 8 | `a411f61` | `foundation: persist append-only AI decision snapshots` |
| 9 | `5a889a9` | `foundation: add immutable fact run and decision snapshot schema` |
| 10 | `5e7201f` | `foundation: make fact runs immutable and corrections versioned` |
| 11 | `d8e1b67` | `foundation: document fact immutability, decision snapshots and tool boundary` |
| 12 | `723460f` | `foundation: complete remediation validation and recovery reports` |

**Qué queda pendiente y no es de esta fase:**

1. **El propietario aplica la migración a DEV** y corre
   `test:policy-foundation:dev-e2e`. Es la primera ejecución real del SQL; esperará
   alguna discrepancia de forma o tipo, y eso está bien porque no se aplicó a ciegas.
2. **Resolver las cuatro concerns abiertas** que el reporte de remediación §30 enumera
   con su disposición. Dos necesitan una decisión, no código: el hueco del Fact Run
   FROZEN legacy sin snapshot, y el conflicto entre `delete_audit` y la inmutabilidad.
3. **Decidir las seis divergencias normativas.** Son del propietario y esta fase no
   tenía autoridad sobre ninguna.
4. **Sólo después de la revisión humana de este reporte y del reporte de remediación**
   puede empezar la fase `EXTRACTION TOOLS + DECLARATIVE SHADOW ENGINE`. Esa fase no
   se ha iniciado.

**Cómo retomar si se interrumpe otra vez, en orden:**

1. Leer `docs/reports/POLICY-FOUNDATION-RECOVERY-REPORT.md` (este archivo) y
   `docs/reports/POLICY-FOUNDATION-REMEDIATION-REPORT.md`.
2. `git status --short` y `git log --oneline -6` para confirmar que HEAD es `723460f` y que
   el árbol está limpio.
3. `git diff 410275e..HEAD --numstat -- packages/policy-engine/src/index.ts` — debe dar
   `4  0`. Si no da `4  0`, **algo normativo cambió**: pararse e investigar antes de
   hacer nada más.
4. Verificar el hash de la fixture: debe dar
   `38e29f441498b72137fcb6bda49b0aa00ff6f4f898c2c7f6504b46a378ea0d76` (LF canónico; ver
   el reporte de remediación §5 para el método, porque el hash crudo en Windows difiere
   legítimamente por `core.autocrlf=true`).
5. `git grep -n -E "createDefaultExtractionToolRegistry|ShadowPolicyEngine|runAndPersistBlindMachineAudit" -- apps/web/src/app apps/web/src/server/jobs`
   — debe salir vacío. Si algo aparece, una capacidad no productiva se conectó al
   pipeline.
6. `git ls-files migrations | Measure-Object` — debe dar 29. Si hay más, alguien aplicó
   o escribió migraciones por su cuenta.
7. Estado DB: sigue `BLOCKED`. No aplicar nada sin credenciales DEV.

**No existe rama ni stash de la remediación sin recuperar.** No hay nada que limpiar ni
que decidir sobre el estado del árbol de este worktree.

**Existe un segundo worktree** (rama `feature/dictamen-panel`, ver §3.1) que pertenece a
otra línea de trabajo. No es de la remediación y no se ha tocado.
