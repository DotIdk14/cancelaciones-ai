# Cost Telemetry Closure + Owner Test Ready

**Fecha**: 2026-09-25 / 2026-09-26
**Alcance**: recuperación, esquema, telemetría de coste, despliegue, observabilidad, preparación de la prueba final
**Fuera de alcance (inviolable)**: `evaluatePolicy`, `v5Rules`, umbrales, outcomes, rule IDs, coverage gaps, Golden Master

---

## 1. Recovery State

Entré sin contexto confiable de la sesión anterior, así que **todo se verificó contra Git y contra la base real** antes de actuar. Los claims del handoff se sostenían donde debía y no donde no debía.

| Comprobación | Resultado medido |
|---|---|
| Rama | `main` |
| `HEAD` al inicio | `6bdbbae72ced4e1883ba55ed7a28dc85acc09874` |
| `origin/main` al inicio | `6bdbbae` — **idéntico** |
| `git worktree list` | 1 solo worktree |
| `git stash list` | vacío |
| Working tree | limpio al inicio |

**Clasificación: `LOCAL_HEAD == ORIGIN_MAIN`. Sin divergencia, sin trabajo sin commitear, sin stashes.**

El commit reportado como último en `main` (`6bdbbae`) **sí era** `HEAD`. No hubo que reconstruir nada desde otro sitio.

Existe una rama local `backup-local-snapshot-75d19af` (commit único, "chore: snapshot inicial del proyecto Cancelaciones AI"). **No se tocó ni se fusionó**: es un snapshot, no trabajo pendiente.

No ejecuté `git reset --hard`, `git clean -fd`, `git restore .` ni `git checkout .`. No había nada que recuperar, y destruye trabajo local sin motivo.

### Corrección material a un claim del informe anterior

El informe de `6bdbbae` (§0.3) afirma:

```text
record_ai_usage_v1  (16 parametros)  -> OK
fila escrita en ai_usage              -> OK
buildAuditCostSummary -> knownCostUsd=0.000616
```

Consultado contra producción, `public.ai_usage` tiene **0 filas**. Ese camino se validó contra un doble de test, no contra la base real, y se concluyó que la ruta de coste funcionaba. **No funcionaba.** La sección 6/C de este informe explica por qué, y era un tercer defecto que el informe anterior no detectó.

## 2. Git / Deployment

```text
Commits creados
0fc1aa5  fix: persist ai usage cost source and unknown costs
685b6dd  test: enforce durable cost telemetry contract   (HEAD, origin/main)

Push      6bdbbae..685b6dd  main -> main
Deployment Vercel  DZgQxXqzXyusNwtH8ttz5SESgUDY
Estado    success   2026-09-26T00:00:39Z   (leído del status que Vercel publica en GitHub)
```

**Límite honesto de la verificación de despliegue**: en esta máquina **no hay credenciales de Vercel** (`vercel whoami` → `Logged out`, sin `.vercel/`, sin `VERCEL_TOKEN`). Por tanto:

- **MEDIDO**: existe un deployment `success` para `685b6dd`, con id y timestamp.
- **MEDIDO**: el alias de producción responde sanamente (ver §16).
- **NO VERIFICABLE sin token**: qué deployment sostiene el alias `cancelaciones-ai-main` ahora mismo, y el estado `READY`/`ERROR` de ese deployment.

El alias del deployment específico (`dzgqxqxzxyusnwth8ttz5sesgudy.vercel.app`) devuelve **404**, así que tampoco se puede comparar su build con el del alias de producción. **No afirmo que producción sirva `685b6dd`; afirmo que el build de `685b6dd` se desplegó con éxito.** La confirmación definitiva la da el OWNER con `vercel ls cancelaciones-ai-main`.

## 3. Prior Controlled Audit Verification

Auditoría `4956e983-ba50-418a-b831-d6b2cca249ea`, **solo lectura**. No se reejecutó ni se tocó su estado.

| Requisito | Medido | Veredicto |
|---|---|---|
| `fact_extraction_runs.state` | `FROZEN` | PASS |
| `frozen_at` | `2026-09-25T22:38:30.383Z` (no nulo) | PASS |
| Snapshot existe | 1 fila | PASS |
| Snapshot `fact_count` | **7** | PASS |
| Snapshot `integrity_hash` | `488ce64cb380608f…` (prefijo coincide) | PASS |
| `engine_run` existe | 1 fila, `e31fecf0-c6ce-42d5-82c9-8a633ac79994` | PASS |
| `engine_run.status` | `COMPLETED` | PASS |
| `decision_status` | `INDETERMINATE` | PASS |
| `FACT_EXTRACTION` | `SUCCEEDED` (attempt 1) | PASS |
| `AUDIT_EVALUATION` | `SUCCEEDED` (attempt 1) | PASS |
| `REPORT_GENERATION` | `SUCCEEDED` (attempt 1) | PASS |
| `EVIDENCE_PROCESSING` ×6 | `SUCCEEDED`, **`attempt_count = 1`** las 6 | PASS |

El `FACT_EXTRACTION` original quedó `FAILED 3/3` con `AUTH_ERROR` durante la fase sin sesión, y se conserva como registro. El job de reanudación lo completó. **Los dos conviven en la tabla**, que es lo correcto: un ledger de intentos no se reescribe.

**Resultado: PASS.** No hay divergencia con el handoff. No reinterpreto el `INDETERMINATE`.

## 4. Cost Bug A

**Estado: CONFIRMADO y CORREGIDO.**

Verificado en el código **y** en el catálogo de producción:

```sql
-- information_schema.columns, ai_usage: 17 columnas, ninguna llamada cost_source
-- pg_get_functiondef(record_ai_usage_v1):
IF p_cost_source NOT IN ('PROVIDER_REPORTED','CALCULATED','ESTIMATED','UNKNOWN') THEN
  RAISE EXCEPTION 'COST_SOURCE_INVALID: %', p_cost_source;
END IF;

INSERT INTO public.ai_usage (
  audit_id, job_id, ..., currency, recorded_at       -- <-- cost_source NO esta
) VALUES ( ... );
```

Se validaba un parámetro para luego perderlo. El requisito "registrar de dónde sale el número" no se cumplía.

**Arreglo**: columna durable `cost_source text NOT NULL DEFAULT 'UNKNOWN'` con `CHECK` de los cuatro valores **del contrato real del código** (`cost-ledger.ts:38` los declara y `record_ai_usage_v1` los validaba). No se inventó un quinto valor ni se renombró nada.

## 5. Cost Bug B

**Estado: CONFIRMADO y CORREGIDO.**

```sql
-- real, antes de la migración
estimated_cost_usd  is_nullable = NO
unit_price_usd      is_nullable = NO
```

El diseño establece `NULL = desconocido`, `0 = conocido igual a cero`. Con `NOT NULL`, un coste desconocido se rechazaba con `23502`, y `buildAuditCostSummary` contaba `unknownCostEvents` con `estimated_cost_usd IS NULL`: **una condición que con `NOT NULL` no puede darse**. El cubo de coste desconocido era código muerto.

**Arreglo**: `DROP NOT NULL` en `estimated_cost_usd` y `unit_price_usd`. Los `CHECK >= 0` preexistentes siguen siendo válidos: en SQL un `CHECK` solo rechaza cuando la expresión es `FALSE`, y `NULL >= 0` es `NULL`.

## 6. Schema Migration

`migrations/20260925200000_cost-telemetry-contract.sql`, **forward-only**. No se editó ninguna migración aplicada. Ningún fichero de `migrations/` anterior fue tocado.

```text
Aplicación    npx @insforge/cli db migrations up --to 20260925200000
              -> Applied 1 migration file(s)
Ledger        system.custom_migrations: 20260925161000 era la última; ahora 20260925200000
Backup        .backups\pre-cost-telemetry-20260925-schema.sql (esquema, antes de aplicar)
Target        InsForge "Cancelaciones" / 4pw4jdzv  (PRODUCCIÓN)
```

**No se usó `--all`**, que el propio repo prohíbe (`POLICY-FOUNDATION-MIGRATION-PLAN.md:90`): se aplica una, se verifica, se detiene.

### El runner dijo `success` y no me servió de nada

§17 pide no inferir éxito del runner. Se inspeccionó el esquema real después de aplicar:

```text
cost_source          is_nullable=NO   default='UNKNOWN'    OK
provider_request_id  is_nullable=YES                     OK
estimated_cost_usd   is_nullable=YES                     OK
unit_price_usd       is_nullable=YES                     OK
input_units          is_nullable=YES                     OK
output_units         is_nullable=YES                     OK

ai_usage_cost_source_check
  CHECK (cost_source = ANY (ARRAY['PROVIDER_REPORTED','CALCULATED','ESTIMATED','UNKNOWN']))
ai_usage_unknown_cost_not_zero_check
  CHECK ((cost_source <> 'UNKNOWN') OR (estimated_cost_usd IS NULL) OR (estimated_cost_usd <> 0))
ai_usage_provider_reported_requires_cost_check
  CHECK ((cost_source <> 'PROVIDER_REPORTED') OR (estimated_cost_usd IS NOT NULL))
```

### Defecto C — encontrado al verificar A y B, misma clase

`cost-ledger.ts:222` envía **`p_unit_price_usd: null` siempre**, incluso con coste conocido. Y `readAssemblyAiUsage` devuelve `outputUnits: null` en el **100%** de las llamadas de AssemblyAI. Contra columnas `NOT NULL`, eso es un `23502` en **todas** las escrituras, no solo en las de coste desconocido.

**Por eso `ai_usage` está vacía.** La ruta de escritura de coste nunca funcionó contra la base real, con independencia de si la llamada era de coste conocido o de coste desconocido. El informe anterior la dio por buena.

Se corrige en la misma migración porque es el mismo defecto: lo desconocido se guarda como desconocido, no como `0`.

### Backfill

`ai_usage` tiene 0 filas, así que el backfill no movió nada. Se escribió igualmente, y de forma honesta: las filas anteriores guardarían un número **del que no se conservó la procedencia**, y para eso la etiqueta honesta es `UNKNOWN`. `UNKNOWN` con coste no nulo es un estado coherente —significa procedencia desconocida, no cifra inexistente—. Lo que queda prohibido es `UNKNOWN` con `0`, y eso lo hace cumplir un `CHECK`.

## 7. record_ai_usage_v1

**La firma no cambia.** Cambiar la firma de un RPC ya desplegado rompe al cliente en producción en lugar de arreglarla. Se mantiene idéntica y se corrige el cuerpo.

```text
ANTES                          DESPUES
p_cost_source validado         p_cost_source validado Y PERSISTIDO
p_cost_source descartado       -> columna cost_source
p_provider_request_id          -> columna provider_request_id
                                (tambien se descartaba)
23502 opaco                    AI_USAGE_UNIT_TYPE_REQUIRED
                               AI_USAGE_REQUEST_FINGERPRINT_REQUIRED
                               AI_USAGE_PROVIDER_REQUIRED / _OPERATION_ / _AUDIT_ID_
                               COST_UNKNOWN_CANNOT_BE_ZERO
                               COST_PROVIDER_REPORTED_REQUIRES_AMOUNT
sin COALESCE(..., 0)           sin COALESCE(..., 0)   <- explicito
```

`NULL` entra como `NULL`. **No hay ningún `COALESCE(..., 0)` en campos de coste ni de unidades, y no debe haberlo**: sería exactamente el defecto que esta migración viene a corregir.

## 8. Unknown Cost Contract

```text
cost_source = PROVIDER_REPORTED  -> el coste puede venir del proveedor
                                    Y tiene que traer cifra (constraint)
cost_source = CALCULATED         -> calculado con pricing conocido y versionado
cost_source = ESTIMATED          -> estimacion explicita
cost_source = UNKNOWN            -> estimated_cost_usd puede ser NULL
                                    unit_price_usd puede ser NULL
                                    Y NO puede ser 0                (constraint)
```

Las dos últimas constraints no son "permitir `NULL`": son **impedir la mentira**. `UNKNOWN` con `0` significaría afirmar que se conoce un coste de cero cuando lo que se sabe es que no se sabe. Y `PROVIDER_REPORTED` sin cifra se contradice a sí mismo.

Un `0` **real** sigue aceptándose si la fuente lo sostiene (`PROVIDER_REPORTED` con `0`): lo prohibido es el cero sin procedencia, no el cero.

## 9. OpenRouter

`readOpenRouterUsage` se mantiene. Se verifica por tests, **sin ninguna llamada pagada**:

| Respuesta del proveedor | `costUsd` | `costSource` |
|---|---|---|
| devuelve `usage.cost` | el número | `PROVIDER_REPORTED` |
| usage sin coste, sin pricing versionado | `null` | `UNKNOWN` |
| respuesta vacía / campos ausentes | `null` | `null` en unidades y modelo |

La lectura es **defensiva** a propósito: un `as` que presupone la forma convierte un campo ausente en un `undefined` silencioso que acaba guardado como dato.

Se persisten cuando están disponibles: `model`, `input_units`, `output_units`, `provider_operation_id` (FK), `job_id`, `attempt_id`, y ahora `cost_source` y `provider_request_id`.

**No se extrajo ni se imprimió ninguna clave de producción.** No se hizo ninguna llamada pagada para probar esta migration: la ruta se valida con tests y contra el RPC real vía SQL, que es lo que permite demostrar el contrato sin gastar.

## 10. AssemblyAI

Se mantiene todo lo acordado:

- Unidad facturable: `audio_duration` → `unitType: 'AUDIO_SECONDS'`. No tokens.
- **El polling no es una operación pagada nueva**: `operationType: 'POLL'` con `billable: false`, sin fila de coste. Contarlo inflaría el gasto y volvería inútil el control.
- Si no devuelve coste y no hay pricing configurado: `cost_source = 'UNKNOWN'`, `estimated_cost_usd = NULL`.
- **Debe poder persistirse sin `23502`.** Verificado directamente contra la base (§14, fila de prueba): `ASSEMBLYAI` / `AUDIO_SECONDS` / coste `NULL` → `out_recorded = true`, y la fila queda con `estimated_cost_usd = null`, `unit_price_usd = null`, `cost_source = 'UNKNOWN'`.

## 11. Cost Summary

`GET /api/audits/[auditId]/cost` con la semántica pedida:

```ts
knownCostUsd      // SUMO solo de costes conocidos
unknownCostEvents // COUNT de eventos cuyo coste NO se conoce
providerCallCount // operaciones de proveedor registradas
```

Ejemplo del §14, verificado por test:

```text
OpenRouter  0.021 USD  PROVIDER_REPORTED
AssemblyAI  desconocido
            -> knownCostUsd = 0.021
            -> unknownCostEvents = 1
            -> providerCallCount = 2
```

UI: `$0.0210 USD conocidos` + `+ 1 operación con coste desconocido`. **Nunca** un total único.

### Defecto D — honestidad en la lectura (encontrado al revisar la ruta)

`buildAuditCostSummary` tenía su propio `try/catch` que devolvía ceros, así que **un fallo de lectura del ledger llegaba al cliente como `200` con `$0.00`** — y la UI lo pintaba como coste cero. Eso afirma que se midió el gasto cuando no se midió nada: el mismo error que esta fase viene a corregir, en la capa de lectura. El propio comentario de la ruta decía "No se devuelve un 0 falso", y el código hacía justo eso.

**Arreglo**: `readFailed: boolean` en el resumen; la ruta responde **503** controlado cuando la lectura falla, y el panel dice que no se muestra ninguna cifra porque no se midió nada. Cubierto por dos tests (error devuelto y excepción).

## 12. Schema Contract Guard

Existe y se **amplió**. Sigue consultando Postgres real, no los ficheros de migración, que es lo que falló en el incidente.

```text
ANTES   37 invariantes
AHORA   55 invariantes   (18 nuevas de contrato de coste)
```

Las nuevas comprueban:

- existencia de `cost_source` y `provider_request_id`
- `estimated_cost_usd`, `unit_price_usd`, `input_units`, `output_units` admiten `NULL`
- `cost_source` es `NOT NULL`; `provider`, `operation`, `request_fingerprint`, `unit_type` siguen `NOT NULL`
- los cuatro valores del `CHECK` de `cost_source`, leídos del catálogo y parseados en JS
- las tres constraints que impiden mentir

**Se verificó que el guard puede fallar**: antes de aplicar la migración salió con **6 invariantes rotas**, incluidas las de coste. Un guard que no puede fallar no sirve, así que se probó que falla.

Lo que ya estaba cubierto y se confirmó: `fact_extraction_runs` CHECK con los 4 estados, `record_ai_usage_v1`, `provider_operations`, `fact_run_frozen_snapshots`, `begin_fact_run_processing_v1`, `freeze_fact_run_v1`.

**Límite que conviene no olvidar**: `pnpm db:verify-contract` **no corre en CI** (`ci.yml` no lo invoca) porque necesita credenciales del backend. Cubre el entorno, no el pull request. Un cambio de esquema solo puede detectarse mirando Postgres, y eso lo hace el guard, no el fichero de migración — pero si nadie lo ejecuta, el guard no protege nada. **Es `OWNER_ACTION` colgarlo de una credencial de CI.**

## 13. RLS / Authorization

No se abrió `ai_usage`. Verificado:

| Requisito | Estado |
|---|---|
| `ai_usage` con RLS habilitado | OK (guard de contrato) |
| `anon` con DML en tablas de coste | **0 privilegios** (guard de contrato) |
| `authenticated` con INSERT/UPDATE/DELETE en coste | revocado; solo `SELECT` |
| Escritura de coste | pasa por `record_ai_usage_v1`, `SECURITY DEFINER` |
| Ownership en la ruta | `audit.createdBy !== user.id` → 403; 404 si no existe; 401 sin sesión |
| RLS de `ai_usage` | `audits.created_by = auth.uid() OR current_app_role() = 'OWNER'` |

El endpoint **no** devuelve claves, cabeceras `Authorization` ni payload crudo del proveedor: solo metadatos de coste. `error` es genérico, sin stack trace.

**Usuario A no puede leer costes de audit B**: lo impiden dos capas independientes — la comprobación de la ruta y la política RLS. No es una u otra.

## 14. Tests

### El hueco que estos tests cierran

`cost-ledger.test.ts` usa un doble que **stubbea el RPC**: acepta cualquier valor, no aplica restricciones de esquema, y su proyección **ni siquiera devuelve `cost_source`**. Consecuencia medida, no hipotética:

> **Con el esquema roto de producción, TODOS los tests de coste existentes PASABAN.**

Un doble que no reproduce las restricciones del servidor no puede detectar que el servidor las tiene. Ese es el agujero, y por eso el doble nuevo **modela el esquema real**: `NOT NULL` por columna con su `23502`, el `CHECK` de `cost_source`, la regla `UNKNOWN` ≠ `0`, `PROVIDER_REPORTED` con cifra obligatoria, y `ON CONFLICT DO NOTHING`.

### Los dos tests críticos que pedía el encargo

```text
§12  UNKNOWN + coste NULL  -> INSERT SUCCESS, cost_source=UNKNOWN, estimated_cost_usd=NULL
     Y la MISMA llamada contra el esquema anterior devuelve false y no escribe fila.
     El contrato viejo se guarda como constante EJECUTABLE (NOT_NULL_BEFORE), no
     como comentario, para que la regresión se pueda demostrar.

§13  PROVIDER_REPORTED -> se escribe, se LEE de vuelta y sigue siendo
     PROVIDER_REPORTED. Las cuatro fuentes sobreviven al viaje de ida y vuelta.
     No basta con validar el parámetro: se afirma la lectura de la fila.
```

### Verificación contra la base real (§18)

| Caso | Esperado | Resultado |
|---|---|---|
| `ASSEMBLYAI`, `AUDIO_SECONDS`, coste `NULL`, `UNKNOWN` | INSERT SUCCESS | `out_recorded = true` |
| `OPENROUTER`, 1000/250 tokens, `0.021`, `PROVIDER_REPORTED` | INSERT SUCCESS | `out_recorded = true` |
| `cost_source = 'PAGADO_POR_EL_DUENIO'` | rechazado | `COST_SOURCE_INVALID` |
| `UNKNOWN` con coste `0` | rechazado | `COST_UNKNOWN_CANNOT_BE_ZERO` |
| `unit_type` nulo | rechazado | `AI_USAGE_UNIT_TYPE_REQUIRED` |

Filas leídas después de insertar:

```text
cost_source=UNKNOWN  estimated_cost_usd=null  unit_price_usd=null
output_units=null    input_units=120.5        provider_request_id=tr-contract-test
```

**Las 2 filas de prueba se eliminaron después** (`request_fingerprint LIKE 'contract-test-%'`). Las 3 rechazadas nunca se insertaron. No queda basura sintética en el ledger de coste, porque contaminaría justo la validación que el OWNER tiene que hacer.

## 15. Golden Master

```text
14 / 14 PASS
Hash 38e29f441498b72137fcb6bda49b0aa00ff6f4f898c2c7f6504b46a378ea0d76  MATCH
Fixture sin tocar
```

```text
git diff --stat -- packages/policy-engine packages/domain fixtures normative
(vacío)
```

**Sin cambios normativos.** Ni `evaluatePolicy`, ni `v5Rules`, ni umbrales, ni outcomes, ni rule IDs, ni coverage gaps, ni `UNKNOWN_IS_NOT_FALSE`, ni `GDM_GAM_PRD_MLG_003`.

La telemetría de coste no toca el motor: `cost-ledger.ts` no importa `evaluatePolicy` ni escribe en nada que el motor lea. Es una separación deliberada, y por eso corregir A, B, C y D no movió ningún hash.

## 16. Deployment

Smoke sobre el alias de producción, **sin sesión**:

| Path | Código | Lectura |
|---|---|---|
| `/login` | **200** | OK |
| `/auditorias` | **307** | redirect a login, correcto para anónimo |
| `/api/health/insforge` | **200** | `ok:true`, backend correcto |
| `/api/audits/x/cost` | **401** | ruta desplegada, exige sesión |
| `/api/audits/x/decision-trace` | **401** | ruta desplegada, exige sesión |
| `/api/audits/x/no-existe-ctrl` (control) | **404** | confirma que el 401 es real |

**Cero 500.** Sin sesión, `cost` y `decision-trace` exigen auth: no 404, no 500. El control 404 demuestra que el 401 no es un 404 genérico.

Límite de la verificación, repetido porque importa: **sin credenciales de Vercel no se puede confirmar qué deployment sostiene el alias**. Lo medido es que `685b6dd` se desplegó con éxito y que el alias responde sanamente.

## 17. AI Processing Switch

```text
AI_PROCESSING_ENABLED en producción:  NO VERIFICABLE
```

**No lo puedo determinar.** En esta máquina no hay credenciales de Vercel, y no las voy a extraer ni a fabricar. `AI_PROCESSING_ENABLED` no aparece ni en `.env.example` ni en `.env.local` (que solo traen URL, anon key, app URL y las dos claves de proveedor).

Por tanto **NO lo he modificado y NO puedo confirmar su valor efectivo**. En el informe anterior se fijó a `true` vía API de Vercel; es plausible que siga ahí, pero "plausible" no es "medido" y esta fase no lo da por bueno.

**No se ejecutó ninguna auditoría.** No se forzó ninguna llamada de pago para probar la migración.

**Acción del OWNER, antes de subir la auditoría**: confirmar `AI_PROCESSING_ENABLED=true` en production. Si está en `false`, la auditoría se quedará sin procesar y parecerá un fallo del pipeline.

## 18. Owner Browser Test Instructions

El login real usa **cookies** (`createServerClient({ cookies })`), no cabecera `Authorization`, así que un JWT no abre las rutas HTTP. Por eso esto necesita el navegador del OWNER y no se puede automatizar.

### Preparación

1. Vercel → `cancelaciones-ai-main` → confirmar el deployment vivo y `AI_PROCESSING_ENABLED = true`.
2. Abrir DevTools → **Network**.

### Prueba A — conteo de `POST /api/jobs/process` (el gate que sigue abierto)

1. Filtrar `jobs/process`.
2. Subir **una** auditoría nueva (la primera de este lote).
3. Contar los `POST` a lo largo de todo el procesamiento.

| Estado del job | `POST` esperados |
|---|---|
| `QUEUED` | 1 por cada job que haya que despertar |
| `RUNNING` | **0** |
| `RETRY_SCHEDULED` (esperando `available_at`) | **0** |
| `SUCCEEDED` | **0** |

**No se necesita 0 absoluto.** Se necesita que no exista esta secuencia:

```text
POST POST POST POST ... cada ~700 ms
```

mientras el job está `RUNNING`, `RETRY_SCHEDULED` o ya `SUCCEEDED`. Ese `POST` repetido era el incidente.

**Si aparece**: volver a poner `AI_PROCESSING_ENABLED=false` y avisar. Es el gate que ninguna fase ha podido cerrar, porque todas han sido sin navegador.

### Prueba B — resultado esperado de la auditoría

```text
Evidence processing   -> SUCCEEDED
Fact Run              -> DRAFT -> PROCESSING -> FROZEN
FACT_EXTRACTION       -> SUCCEEDED
AUDIT_EVALUATION      -> COMPLETED
REPORT_GENERATION     -> SUCCEEDED
Decision Trace        -> disponible (descargar decision-trace.json)
Cost                  -> disponible
Sin bucle de POST.
```

### Prueba C — panel de coste

Si la auditoría lleva `image/*` o `audio/*`, habrá coste de proveedor. Si lleva solo `pdf`/`word`, **no habrá filas en `ai_usage` y eso es lo correcto**: `pdf` y `word` pasan por `blobToText` local, a propósito, sin proveedor. No se debe forzar una llamada externa para generar gasto.

## 19. Remaining Risks

| # | Riesgo | Estado |
|---|---|---|
| 1 | **Conteo de Network en navegador sin medir** | **OWNER_ACTION**, procedimiento en §18. Requiere su sesión |
| 2 | **`AI_PROCESSING_ENABLED` no verificado** | **OWNER_ACTION**, §17. No hay credenciales de Vercel en esta máquina |
| 3 | **Qué deployment sostiene producción, no verificado** | **OWNER_ACTION**, §2 |
| 4 | `db:verify-contract` no corre en CI | **OWNER_ACTION**: requiere credencial del backend |
| 5 | Coste de AssemblyAI seguirá `UNKNOWN` sin pricing versionado | abierto. Deliberado: no se inventan precios |
| 6 | Idempotencia de operación pagada sin demostrar con llamada real | probada en tests y en el ledger; falta una llamada real |
| 7 | `provider` sigue `NULL` en `job_artifacts` | abierto, de otra fase |
| 8 | `HUMAN_CORRECTION_PARENT_SEMANTICS`, `AUDIT_ARCHIVAL_STATE` | de otras fases |
| 9 | Token de Vercel y credenciales de InsForge expuestos en fases anteriores | **rotar** (el OWNER) |
| 10 | Historial Git con PII del estudiante | **OWNER_ACTION** |

Ningún riesgo de esta lista se introduce con este cambio. El 1, 2 y 3 ya estaban abiertos y son de entorno o de decisión del OWNER.

## 20. Final Gate

```text
origin/main recuperado ................................. SI   (6bdbbae, verificado)
auditoria 4956e983 verificada completa ................... SI
  Fact Run FROZEN + snapshot ............................. SI
  engine_run COMPLETED ................................... SI
  REPORT_GENERATION SUCCEEDED ........................... SI
cost_source persistido durablemente ...................... SI  (defecto A)
UNKNOWN persistible como NULL ........................... SI  (defecto B)
UNKNOWN + 0 imposible por constraint ..................... SI
NULL + 0 imposibles en unidades .......................... SI  (defecto C)
fallo de lectura no se presenta como $0.00 .............. SI  (defecto D)
resumen entiende coste desconocido ...................... SI
schema contract guard ................................... SI  (55 invariantes)
  y se verifico que FALLA antes de la migracion ......... SI  (6 rotas)
tests .................................................... SI  (473)
typecheck ............................................... SI
lint .................................................... SI
build ................................................... SI
guard:ci ................................................ SI
Golden Master ........................................... SI  (14/14, hash MATCH)
cambios normativos ...................................... NO
deploy de 685b6dd ....................................... SI  (success)
produccion sirviendo 685b6dd ............................ NO VERIFICABLE
AI_PROCESSING_ENABLED ................................... NO VERIFICABLE
prueba de Network en navegador real ..................... NO  (OWNER_BROWSER_VALIDATION_REQUIRED)
```

```text
READY FOR OWNER TO UPLOAD ONE NEW AUDIT:  SI
OWNER_BROWSER_VALIDATION_REQUIRED:       SI
```

**Con dos condiciones, y las digo sin suavizar:**

1. El OWNER confirma `AI_PROCESSING_ENABLED = true` en producción (§17). Si está en `false`, la auditoría no se procesará.
2. El OWNER mide el conteo de Network (§18). Es el único gate que queda sin cerrar y no se puede cerrar desde aquí.

Todo lo demás está verificado contra la base real, no inferido de un informe previo. Y donde el handoff afirmaba un PASS que no se sostenía —la ruta de escritura de coste—, está dicho con el mismo detalle con el que se corrigen los defectos que sí eran reales.

---
