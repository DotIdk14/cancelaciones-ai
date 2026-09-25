# Pipeline Recovery + Cost Guard

**Fecha**: 2026-09-25
**Incidente**: runaway job loop, auditoría `4956e983-ba50-418a-b831-d6b2cca249ea`
**Alcance**: pipeline, jobs, máquina de estados, reintentos, idempotencia, telemetría de proveedor, coste, observabilidad
**Fuera de alcance (inviolable)**: `evaluatePolicy`, `v5Rules`, umbrales, outcomes, rule IDs, coverage gaps, Golden Master

---

## 1. Executive Summary

La causa raíz **no era el bucle**. El bucle era el síntoma.

Descubrí que el estado `PROCESSING` **no existía en el esquema real**: el
`CHECK` de `fact_extraction_runs` en producción era `('DRAFT','FROZEN','FAILED')`,
sin `PROCESSING`. Y `freeze_fact_run_v1` exige `state = 'PROCESSING'`. Por lo
tanto **el congelado podía fallar siempre**, el job se reintentaba para siempre,
quedaba en `RETRY_SCHEDULED`, y ese estado era exactamente lo que la UI
repetía en bucle.

Y el `CHECK` no se estrechó por una decisión posterior: nadie en el ledger de
migraciones lo modifica. `fact_extraction_runs` se creó **fuera** del registro, y
el `CREATE TABLE IF NOT EXISTS` de phase-5 fue un no-op silencioso para una tabla
que ya existía. El sistema de migraciones era estructuralmente incapaz de
detectar que el esquema real difería del declarado.

Estado final:

- Causa raíz de fondo corregida y **probada contra la base real**.
- Bucle corregido (era el síntoma, pero había que pararlo igualmente).
- `ai_usage` instrumentado de verdad; el coste dejó de ser invisible.
- Desplegado en producción con `AI_PROCESSING_ENABLED=false`.
- Motor normativo **byte-idéntico**.

**Lo que NO está demostrado**: la prueba de navegador (§18) y la auditoría real
controlada (§24) requieren una sesión autenticada que esta sesión no tiene. Ver
§27.

## 2. Starting State

```text
main @ f3b643e  "fix: stop the runaway job-processing loop"   (local, NO desplegado)
origin/main @ 57d84ae                                        (lo que estaba vivo)
```

El hotfix del bucle existía, estaba commiteado, y **no estaba desplegado**: lo
confirmó que `/api/audits/x/decision-trace` seguía respondiendo con el
comportamiento de `57d84ae`. El handoff decía que el último deploy era
`1aa0a34`; era cierto que ése había sido el último *registrado por él*, pero
había uno posterior.

## 3. Runaway Loop Hotfix

Se conserva íntegro (`f3b643e`). Resumen de la semántica:

```text
QUEUED           -> POST process          (único caso que lo justifica)
RUNNING          -> esperar y consultar   (ya lo tiene un worker; el claim es de la DB)
RETRY_SCHEDULED  -> esperar available_at  (está en backoff; POSTear es no-op)
SUCCEEDED        -> done
FAILED           -> propagar el error
```

Decisión extraída a `queue-drain.ts` (función pura, testeable sin React) y
endpoint con estado discriminado: `processed`, `nothing_to_process`,
`already_running`, `retry_scheduled`, `terminal_failure`,
`ai_processing_disabled`. 20 tests, uno de los cuales demuestra explícitamente
que la lógica antigua postea 200 veces y la nueva 0.

## 4. Fact Run Lifecycle Root Cause

Medido contra producción, no inferido:

```sql
-- lo que DECLARA el diseño (20260923220000_phase-5-fact-model-shadow.sql:8)
CHECK (state IN ('DRAFT', 'PROCESSING', 'FAILED', 'FROZEN'))

-- lo que TENÍA la base
CHECK (state IN ('DRAFT', 'FROZEN', 'FAILED'))

-- estados realmente presentes
DRAFT = 1,  FROZEN = 9      (nunca hubo una fila PROCESSING)
```

El trigger de la migración Foundation (`20260925120000:249-253`) **ya asumía**
`PROCESSING`:

```sql
IF OLD.state = 'DRAFT'      AND NEW.state IN ('PROCESSING','FAILED') THEN ...
IF OLD.state = 'PROCESSING' AND NEW.state IN ('FROZEN','FAILED')    THEN ...
```

Es decir: el trigger gobernaba un estado que el CHECK prohibía. La invariante
estaba escrita a medias, en dos lugares que se contradecían, y nadie lo probó
porque leer SQL no ejecuta CHECK.

### Cadena causal completa

```text
CHECK sin PROCESSING
  -> PROCESSING inalcanzable
    -> freeze_fact_run_v1 exige PROCESSING  (20260925120000:859)
      -> FACT_RUN_NOT_PROCESSING: DRAFT
        -> executeClaimedJob: catch -> SYNTHETIC_TRANSIENT_ERROR -> retry
          -> job en RETRY_SCHEDULED (2/3 intentos)
            -> UI: activeStatuses incluía RETRY_SCHEDULED -> POST process
              -> claim_next_job lo rechaza (backoff vigente) -> 200
                -> la UI repite a ~700 ms
```

Job exacto: `ac2cd20b-afd6-4a07-8741-8665860e1b5b`, `FACT_EXTRACTION`,
`RETRY_SCHEDULED`, `attempts 2/3`, `available_at 2026-09-25T21:39:44.395Z`.

## 5. DRAFT -> PROCESSING Fix

Dos migraciones forward-only. **Ninguna migración aplicada fue editada.**

### `20260925161000_restore-fact-run-processing-state.sql`

Restituye `PROCESSING` al `CHECK`, que es lo que el diseño declara y lo que el
trigger de Foundation ya gobernaba.

Seguro porque: no hay ninguna fila en `PROCESSING` que pueda quedar huérfana
(no existe ninguna); no se abre ninguna transición nueva (FROZEN sigue terminal
porque el trigger lo bloquea); el CHECK sólo deja de impedir un estado que el
trigger ya permitía.

### `20260925160000_...` — `begin_fact_run_processing_v1`

Transición **autoritativa**, atómica (`FOR UPDATE`) e idempotente:

```text
DRAFT      -> PROCESSING   out_transition = 'PROCESSING'
PROCESSING -> PROCESSING   out_transition = 'ALREADY_PROCESSING'
FROZEN     -> sin cambios  out_transition = 'ALREADY_FROZEN'   (respuesta, no error)
```

Sustituye al `UPDATE` disperso que vivía **sólo** en el camino local de
`freezeFactRunWithSnapshot` (línea 487) y que desaparecía al activarse el RPC.
Un solo sitio decide la transición.

`FROZEN` no es error a propósito: quien llama necesita poder preguntar «¿en qué
estado está?» sin distinguir un fallo de una respuesta.

### Prueba contra la base real

```text
1) DRAFT -> PROCESSING   -> transition=PROCESSING
2) repetir               -> transition=ALREADY_PROCESSING   (idempotente)
3) estado en la tabla    -> PROCESSING
```

Y el `CHECK` en producción ahora es
`('DRAFT','PROCESSING','FAILED','FROZEN')`.

**Corrección que debo hacer pública**: el bloque de verificación de
`20260925161000` dice «Se revierte», y eso es **falso**. En plpgsql un bloque
`BEGIN…EXCEPTION` sólo revierte si se lanza una excepción; como el `UPDATE`
tuvo éxito, la subtransacción se confirmó. Consecuencia: el Fact Run de la
auditoría del incidente quedó en `PROCESSING`. Es un estado que necesitaba y que
no se pierde nada, pero **no era la intención documentada**, y no puedo
re-escribir la migración porque ya está aplicada. Queda aquí dicho.

## 6. FACT_EXTRACTION Flow

```text
claim job (lease en DB)
  -> load fact run
  -> ¿ya FROZEN y sellado?  -> ALREADY_COMPLETED, complete, return
  -> assertEvidenceDependenciesReady
  -> ensureFactRunProcessing()        <-- la transición que faltaba
  -> extraer desde artifacts
  -> facts idempotentes por conjunto
  -> freeze_fact_run_v1
  -> FROZEN
  -> complete + encolar AUDIT_EVALUATION
```

`ensureFactRunProcessing` va **antes** de extraer, no justo antes de congelar: si
el proceso muere a mitad de extracción, el run queda en `PROCESSING` y el
reintento sabe que ya empezó, en lugar de volver a empezar como si fuera nuevo.

## 7. Resume / Retry Semantics

Tolerante a refresh de navegador, retry del job, restart de serverless, request
duplicado, worker duplicado:

| Situación | Comportamiento |
|---|---|
| Run `FROZEN` con facts/snapshot | `ALREADY_COMPLETED`. No extrae, no llama proveedores, no crea segundo snapshot |
| Run ya `PROCESSING` | Continúa. No crea otro run |
| `begin_fact_run_processing_v1` repetida | Idempotente |
| Evidencias en curso | `DEPENDENCY_NOT_READY` (reintentable con sentido) |
| Evidencia fallada terminal | `DEPENDENCY_TERMINAL_FAILURE`, explícito, **no** retry ciego |
| Request duplicado | El `idempotencyKey` de `enqueue_job` + `UNIQUE (fact_run_id)` en el snapshot |

## 8. Error Taxonomy

Sustituye a `catch → SYNTHETIC_TRANSIENT_ERROR → retry` para todo.

**Retryable**: `TRANSIENT_PROVIDER_ERROR`, `RATE_LIMITED`, `TIMEOUT`,
`NETWORK_ERROR`, `DEPENDENCY_NOT_READY`.

**Terminal**: `DETERMINISTIC_STATE_ERROR`, `VALIDATION_ERROR`, `SCHEMA_ERROR`,
`AUTH_ERROR`, `PERMISSION_ERROR`, `INVALID_INPUT`, `PERSISTENCE_ERROR`,
`PROVIDER_PERMANENT_ERROR`, `PROVIDER_RESULT_UNKNOWN`, `UNSUPPORTED_JOB_TYPE`.

Cada entrada sale de un `RAISE EXCEPTION` real leído del SQL, no de suponer.
`TERMINAL` se evalúa **antes** que `RETRYABLE`, para que un 4xx dentro de un
error de proveedor no se lea como transitorio.

**El fallback importa**: un error NO reconocido se clasifica **TERMINAL**. La
alternativa («reintentar por si acaso») es la que causó el incidente. Ante la
duda, parar es reversible: una persona relanza. Cobrar dos veces, no.

`EVIDENCE_NOT_FOUND` y `ENOENT` se clasificaron `DEPENDENCY_NOT_READY`
(reintentables), que es lo que ya hacían antes — cambia la honestidad del
etiqueta, no el comportamiento. `FACT_RUN_NOT_FOUND` sigue siendo terminal.

## 9. Retry Policy

**Verificado, no rehecho**: ya era correcto y no lo toqué.

```sql
-- claim_next_job
AND available_at <= now()
AND attempt_count < max_attempts

-- schedule_job_retry
CASE WHEN attempt_count >= max_attempts THEN 'FAILED' ELSE 'RETRY_SCHEDULED' END
```

Backoff exponencial con tope: 30 s → 60 → 120 → … → 900 s. El original usaba 30 s
fijos.

## 10. Job Idempotency

Lease en DB: `claim_next_job` con `lease_owner` / `lease_expires_at` y
`FOR UPDATE`. Un `RUNNING` con lease vigente no es reclamable. La garantía está
en la base, no en React.

**Facts**: no se puede añadir `UNIQUE (run_id, fact_type)` — se comprobó en la
base y hay **8 Fact Runs con dos facts del mismo tipo**, así que ese constraint
rechazaría datos legítimos. La identidad real de un fact extraído es «el conjunto
completo del run», así que converge por conjunto: si lo que hay no es exactamente
lo que se extrajo, se reemplaza. `deleteFactsByRun` **se niega** a tocar un run
`FROZEN` en vez de confiar en que el llamador se porte bien.

## 11. Provider Operation Idempotency

`request_fingerprint = sha256(auditId | jobId | stage | input)`. **No incluye el
intento**, a propósito: el reintento del mismo trabajo debe producir la misma
huella, que es lo que permite reutilizar en vez de pagar.

| Estado previo en el ledger | Respuesta | Se paga |
|---|---|---|
| `SUCCEEDED` con esa huella | `shouldExecute: false` | **No** |
| `SUBMITTED` sin cerrar | `RESULT_UNKNOWN`, **para** | **No** |
| `POLL` (`billable=false`) | `shouldExecute: true` | No es pagada |

El caso `SUBMITTED` sin cerrar es el que más importa: el proceso murió **después**
de enviar al proveedor y **antes** de guardar el resultado. No se puede saber si
el proveedor aceptó, así que se para y se marca. Es preferible detener una
auditoría que cobrarla varias veces sin saberlo.

## 12. AI Usage Instrumentation

Las tablas **ya existían** y tenían las columnas correctas. El problema era que
nadie escribía en ellas.

```text
ai_usage        -> 0 filas
provider_operations.provider -> NULL
grep de "ai_usage" en código no-test -> 0 escrituras
```

`record_ai_usage_v1` con `ON CONFLICT (provider, operation,
request_fingerprint) DO NOTHING` convierte el índice único preexistente en
**garantía** de que un reintento no duplica la fila de coste.

## 13. OpenRouter Usage

El código original **descartaba el campo `usage` entero**, que es exactamente por
lo que el coste era invisible. Ahora se lee y se persiste.

Se lee de forma **defensiva**: un `as` que presupone la forma convierte un campo
que falte en un `undefined` silencioso que acaba guardándose como dato. Lo que no
está se devuelve `NULL` y por tanto «desconocido».

## 14. AssemblyAI Usage

La unidad facturable real de AssemblyAI es `audio_duration` (segundos de audio),
no tokens. Se registra como `AUDIO_SECONDS`.

**El poll no es una operación pagada.** Se registra `billable: false` y no genera
fila de coste. Contarlo como coste inflaría el gasto y haría inútil el control.

Si se agota el timeout esperando, la transcripción **pudo facturarse**: se marca
`RESULT_UNKNOWN`, no `FAILED`. «No sé si se cobró» y «no se cobró» llevan a
decisiones opuestas.

## 15. Cost Calculation

Prioridad, sin inventar precios:

```text
1. provider reported cost     -> cost_source = 'PROVIDER_REPORTED'
2. usage + pricing configurado -> 'CALCULATED' / 'ESTIMATED'
3. sin dato fiable            -> 'UNKNOWN', estimated_cost_usd = NULL
```

```text
NULL = DESCONOCIDO
0    = GRATIS
```

Poner 0 cuando no se sabe el precio es afirmar algo falso, y un ledger lleno de
ceros falsos es **peor** que uno vacío: parece que se controló el gasto cuando
sólo se midió parte. AssemblyAI no devuelve coste por operación, así que sin
pricing configurado queda `NULL`.

## 16. Cost Summary UI

`AuditCostPanel` en el tab de trazabilidad. Con coste desconocido:

```text
$0.0500 USD conocidos
+ 1 operación con coste desconocido
```

**Nunca** un total único, porque sería falso. `GET /api/audits/<id>/cost` con
autorización idéntica al resto de la auditoría; no expone claves ni payload crudo
del proveedor.

## 17. Kill Switch

`AI_PROCESSING_ENABLED`: `false`/`0`/`no`/`off` → sin procesamiento de pago.
Default **encendido**, a propósito: un despliegue sin la variable debe procesar
con normalidad, porque si el default fuera apagado un `forgot` de
configuración dejaría el producto sin dictamen y nadie sabría por qué.

Apagado: lectura funciona, Decision Trace funciona, coste se puede leer, no se
reclama ningún job, no se consume ningún intento, y el endpoint devuelve
`200 {status:'ai_processing_disabled'}` — estado controlado, **no 500**.

**Estado en producción: OFF.** Fijado vía API de Vercel en `production`,
`preview` y `development` **antes** del push.

## 18. Browser Network Regression

**NOT EXECUTED — y esto es un hueco real, no un PASS.**

Requiere una sesión autenticada y un navegador, y esta sesión no tiene ninguno de
los dos. Los tests de `queue-drain` son de **lógica de decisión**, que es donde
estaba el bug, pero **no prueban el comportamiento de red del componente**.

Para cerrarlo hace falta Playwright o equivalente, con un job en
`RETRY_SCHEDULED` y conteo de `POST /api/jobs/process` sobre varios ciclos de
polling. Es trabajo pendiente, y lo digo en vez de darlo por bueno.

## 19. Database Validation

Todo aplicado y medido en **producción** (`Cancelaciones` / `4pw4jdzv`):

| Verificación | Resultado |
|---|---|
| 4 funciones nuevas creadas | 4/4 |
| `anon` con DML en tablas de coste | **8 → 0** |
| `authenticated` con INSERT/UPDATE/DELETE en coste | **→ 0** |
| `CHECK` de estado | `('DRAFT','PROCESSING','FAILED','FROZEN')` |
| `DRAFT -> PROCESSING` | funciona |
| Repetir la transición | idempotente |
| Datos tras aplicar | 9 audits, 73 jobs, 10 runs, 87 facts — **sin cambios** |
| Backup previo | `pre-policy-foundation-20260925` (fase anterior) |

## 20. Golden Master

```text
14 / 14 PASS
Hash 38e29f441498b72137fcb6bda49b0aa00ff6f4f898c2c7f6504b46a378ea0d76  MATCH
Fixture sin tocar
```

## 21. Regression Results

| Check | Antes | Después | Veredicto |
|---|---|---|---|
| `pnpm test` | 364 | **497** (+133) | PASS |
| `pnpm typecheck` | PASS | PASS | PASS |
| `pnpm lint` | PASS | PASS | PASS |
| `pnpm build` | PASS | PASS | PASS |
| `pnpm guard:ci` | PASS | PASS | PASS |
| Golden Master | 14/14 | 14/14 | PASS |
| `git diff -- packages/policy-engine` | — | **vacío** | NO NORMATIVE CHANGE |

**Regresiones: 0.** Dos tests existentes se actualizaron, no porque dejaran de
ser verdad, sino porque codificaban la arquitectura antigua:

- `handlers.freeze.test.ts` afirmaba un `UPDATE` DRAFT→PROCESSING en el camino
  local. Ya no existe: la transición es del RPC. La aserción nueva fija el
  contrato **mejor** (un solo sitio decide).
- `audit-queue.e2e.test.ts` afirmaba `SYNTHETIC_TRANSIENT_ERROR`. Ahora afirma
  `DEPENDENCY_NOT_READY`. El comportamiento —retry— no cambia.

## 22. Commits

```text
f3b643e  fix: stop the runaway job-processing loop                    (ya existía)
7c73214  fix: restore the fact run processing lifecycle
3c59291  feat: make provider cost visible and impossible to double-charge
```

## 23. Vercel Deployment

```text
Proyecto   cancelaciones-ai-main  (prj_eyXZmqV5auQIcPFyhJ7c1lvDXNRw)
Commit     3c59291bf37cc2fe2993a9f70d9a424299e41b93
Estado     READY
Target     production
Previo     57d84ae  (y antes 1aa0a34)
```

**Verificado por comportamiento, no por alias**: `/api/audits/x/cost` devolvía
`404` (ruta inexistente) y pasó a `401` (ruta existente, pide sesión). Un 404 que
se vuelve 401 sólo puede significar que el build nuevo está sirviendo. Además se
Ademas se confirmo por API que el deployment de produccion apunta a 3c59291.

## 24. Controlled Production Audit

**NOT EXECUTED — bloqueada deliberadamente.**

`AI_PROCESSING_ENABLED=false` impide el procesamiento con proveedores, así que
una auditoría real no puede completarse hasta reactivar. Reactivar es una
decisión del OWNER con implicaciones de coste, y la Fase 1 (§45) era
explícitamente «desplegar apagado y comprobar que la app levanta».

Estado del incidente preparado para reanudación:

```text
audit 4956e983  run 92e7ff98-41e3-4269-82e4-7ccab1caccc8  -> PROCESSING  (ya transicionado)
job FACT_EXTRACTION  RETRY_SCHEDULED  2/3  backoff elapsed = true  (ya reclamable)
6 EVIDENCE_PROCESSING  SUCCEEDED      (los artifacts ya existen)
```

Al reactivar, la reanudación debería ser: run ya `PROCESSING` → el handler ve
`ALREADY_PROCESSING` → usa los artifacts existentes → `FROZEN` → `SUCCEEDED`,
**sin volver a procesar las 6 evidencias**. Eso no lo he verificado en ejecución;
lo he dejado en el estado correcto y documentado.

## 25. Decision Trace Result

Sin cambios en esta fase. Sigue funcionando: `GET /api/audits/<id>/decision-trace`
→ 401 sin sesión. Validado en la fase anterior contra 7 de 8 auditorías reales.

## 26. Cost Result

`ai_usage` sigue en **0 filas**, y es lo correcto: no se ha hecho ninguna llamada
de proveedor desde que existe la instrumentación, porque el interruptor está
apagado. La instrumentación no se ha podido **demostrar en producción** sin
reactivar.

## 27. Remaining Risks

| # | Riesgo | Estado |
|---|---|---|
| 1 | **Prueba de navegador/red no ejecutada** | abierto. Hueco real. |
| 2 | **Auditoría real controlada no ejecutada** | abierto, bloqueada por el interruptor. |
| 3 | `ai_usage` no demostrado en producción | abierto, depende de (2). |
| 4 | El run del incidente quedó en `PROCESSING` por un efecto no intencionado | documentado, sin pérdida |
| 5 | La verificación de `20260925161000` no revierte pese a documentar que sí | documentado; migración ya aplicada, no reescribible |
| 6 | `FACT_EXTRACTION` ya en `PROCESSING` que nunca extracted | abierto, se resolverá al reactivar |
| 7 | `EVIDENCE_PROCESSING` no tiene coste de AssemblyAI conocido (NULL) | abierto: requiere pricing configurado y versionado |
| 8 | Segundo audit de `HUMAN_CORRECTION_PARENT_SEMANTICS` sigue colisionando | abierto, de otra fase |
| 9 | `AUDIT_ARCHIVAL_STATE` sin decidir | abierto, de otra fase |
| 10 | Historial Git con PII + token de Vercel en conversación | `OWNER_ACTION` |

## 28. OWNER_ACTION

| # | Acción | Prioridad |
|---|---|---|
| 1 | **Rotar el token de Vercel** que se usó aquí. Quedó expuesto en conversación. | **HIGH** |
| 2 | Rotar las credenciales de InsForge expuestas en fases anteriores | **HIGH** |
| 3 | Reescribir el historial Git (PII del estudiante en `5d2d4ba`, 5 refs) | **HIGH** |
| 4 | **Decidir si se reactiva `AI_PROCESSING_ENABLED`**. Es lo que bloquea las pruebas 2 y 3. | **HIGH** |
| 5 | Configurar pricing versionado de AssemblyAI si se quiere coste conocido | MEDIA |

## 29. Ready for Real Audit Testing

**NO — y por dos razones concretas, no por prudencia vaga:**

1. La prueba de navegador (§18) no se ejecutó. El bivel lo paré por lógica
   testada, pero **no por red real**.
2. La auditoría real controlada (§24) no se ejecutó, porque el interruptor está
   apagado y `ai_usage` no ha demostrado registrar un solo evento en producción.

Lo que sí es cierto: la causa raíz de fondo está corregida y probada contra la
base real; el bucle no puede reproducirse por lógica; el motor normativo está
intacto; y la aplicación está desplegada y estable.

Para declarar `YES` hace falta: reactivar el interruptor, una sola auditoría
controlada, y conteo de red verificando `POST /api/jobs/process` = lo necesario
y nada más.

---

## Matriz final

| Capability | Status | Evidence |
|---|---|---|
| Runaway POST loop | PASS | 20 tests; lógica antigua 200 POST vs 0 |
| QUEUED edge-trigger | PASS | `decideDrainAction` → `process` sólo con QUEUED |
| RUNNING no reprocess | PASS | `wait/RUNNING`; lease en DB |
| RETRY_SCHEDULED no reprocess | PASS | `wait/RETRY_SCHEDULED` + espera `available_at` |
| DRAFT -> PROCESSING | PASS | **probado en BD real**; CHECK restaurado |
| PROCESSING -> FROZEN | PARTIAL | transición disponible y run en PROCESSING real; el freeze completo no se ejecutó |
| Resume after worker failure | PARTIAL | lógica cubierta; ejecución real pendiente |
| Facts idempotent | PASS | convergencia por conjunto; `deleteFactsByRun` niega FROZEN |
| Max attempts | PASS | `claim_next_job` + `schedule_job_retry` verificados |
| Deterministic error terminal | PASS | 28 tests de taxonomía |
| Transient retry | PASS | 429/timeout/network/dependency |
| Provider operation idempotency | PASS | 19 tests; no cobra dos veces |
| OpenRouter usage logging | PASS (código) | lee `usage` real; no ejercitado en prod |
| AssemblyAI usage logging | PASS (código) | `audio_duration`; poll no facturable |
| ai_usage populated | **FAIL** | 0 filas: interruptor apagado, sin llamadas |
| Cost summary | PASS (código) | conocido/desconocido separados |
| Kill switch | PASS | apagado en producción, verificado por API |
| Browser/network regression | **FAIL** | no ejecutado: sin sesión ni navegador |
| Decision Trace | PASS | 401 correcto; validado antes contra 7 auditorías |
| Controlled real audit | **FAIL** | bloqueada por el interruptor |
| Golden Master | PASS | 14/14, hash MATCH |
| Normative engine unchanged | PASS | `packages/policy-engine` sin cambios |
| Ready for OWNER audit testing | **NO** | faltan browser regression y auditoría real |
