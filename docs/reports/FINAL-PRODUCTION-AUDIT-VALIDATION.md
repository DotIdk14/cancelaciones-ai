# Final Production Audit Validation

**Fecha**: 2026-09-25
**Objetivo**: cerrar los gates pendientes para `READY FOR OWNER TO UPLOAD A NEW AUDIT`
**Alcance**: validación. Sin features nuevas, sin cambios normativos.

---

## 0. Fase 2 — con sesión autenticada real (estado final)

El OWNER aportó credenciales. Con `signInWithPassword` se obtuvo un JWT de
usuario real y se **reanudó la auditoría del incidente con `auth.uid()` del
creador**. Esto cierra el gate que la fase 1 no pudo cerrar.

### 0.1 Qué se demostró

```text
usuario          0014bb52-…  (dueño de la auditoría 4956e983)
```

Reanudación real, con el mismo Fact Run y los artifacts existentes:

```text
reclamado: FACT_EXTRACTION  (job 3d1a7aad…, attempt 1)  -> SUCCEEDED
reclamado: AUDIT_EVALUATION  (job 8bf0c44a…, attempt 1)  -> SUCCEEDED
reclamado: REPORT_GENERATION (job 5ddef9b4…, attempt 1)  -> SUCCEEDED
cola vacía
```

Estado del ciclo de vida, ya **cerrado**:

| Requisito | Evidencia | Veredicto |
|---|---|---|
| `PROCESSING → FROZEN` por la vía real | `state=FROZEN`, `frozen_at=2026-09-25T22:38:30Z` | **PASS** |
| Snapshot sellado | `fact_count=7`, `integrity_hash=488ce64cb380608f` | **PASS** |
| Fingerprint efectivo | `262587319c252538` | **PASS** |
| `AUDIT_EVALUATION` completa | `engine_runs` 1, `status=COMPLETED`, `outcomeStatus=INDETERMINATE` | **PASS** |
| `REPORT_GENERATION` completa | `SUCCEEDED` | **PASS** |
| Las 6 evidencias NO se reprocesan | `attempt_count` sigue en **1** | **PASS** |
| Facts sin duplicar | **8** | **PASS** |
| Reanudación sin tocar lo sellado | artifacts previos reutilizados | **PASS** |

### 0.2 Decision Trace con contenido real

```text
engineRunId      e31fecf0-c6ce-42d5-82c9-8a633ac79994
decisionStatus   INDETERMINATE
outcomeStatus    INDETERMINATE
suggestedOutcome (ninguno)
rules 3   facts 7   coverageGaps 12
missingFacts     classroom.hasGrades, contact.effectiveContact, classroom.hasActivities
diagnostics      MISSING_EVIDENCE(3) MISSING_FACT(3) POLICY_COVERAGE_GAP(12) RULE_EVALUATION_PATH(3)
envelope         audit-evaluation-envelope-v1
```

`INDETERMINATE` es la **respuesta correcta**: sin nota final ni fecha de reintegro
no hay hechos suficientes para pronunciarse. El motor está aplicando
`UNKNOWN_IS_NOT_FALSE`.

### 0.3 Ruta de coste: demostrada por dentro

No se extrajo la clave de OpenRouter de producción para una prueba local —sería un
riesgo innecesario—. La ruta **nuestra** sí se validó de extremo a extremo:

```text
record_ai_usage_v1  (16 parámetros)          -> OK
fila escrita en ai_usage                     -> OK
buildAuditCostSummary                          -> knownCostUsd=0.000616
                                                 providerCallCount=1
                                                 providers=OPENROUTER
```

`RPC → ai_usage → resumen` funciona, con atribución de proveedor y clasificación
conocido/desconocido.

### 0.4 Dos defectos reales encontrados

Ambos están en la **telemetría de coste**, ninguno en el motor normativo.

**Defecto A — la fuente del coste no se persiste.**
`ai_usage` **no tiene columna `cost_source`**. `record_ai_usage_v1` recibe
`p_cost_source`, lo **valida** contra `PROVIDER_REPORTED | CALCULATED |
ESTIMATED | UNKNOWN`… y lo **descarta**. El requisito de registrar la fuente del
coste no se cumple de forma duradera.

**Defecto B — un coste desconocido es imposible de registrar.**
`ai_usage.estimated_cost_usd` y `unit_price_usd` son `NOT NULL`, así que un uso
sin coste conocido se rechaza:

```text
record_ai_usage_v1(estimated_cost_usd = NULL)  -> ERROR 23502 (not_null_violation)
```

Pero `buildAuditCostSummary` cuenta `unknownCostEvents` contando filas con
`estimated_cost_usd IS NULL`, una condición que **nunca puede darse**. El cubo
"coste desconocido" es código muerto: el guard de coste **no puede expresar
incertidumbre**, que es justo la propiedad de seguridad que se pidió.

### 0.5 Lo que sigue sin demostrarse

| Gate | Por qué |
|---|---|
| Una llamada real a OpenRouter/AssemblyAI | requiere la clave de proveedor, que solo existe en Vercel y no se ha extraído a propósito |
| Conteos de Network en navegador | la app autentica por **cookies** (`createServerClient({ cookies })`), no por cabecera `Authorization`; un JWT no abre las rutas HTTP |

Para `image/*` y `audio/*` la ruta de proveedor **sí** está cableada: la imagen
sintética se subió por `uploadEvidenceFilesForAudit` real, se encoló por
`enqueueEvidenceProcessingJobs` real, y el job entró al handler y se detuvo **solo**
en la validación de configuración por falta de clave.

La llamada real se producirá sola cuando el OWNER suba su auditoría: `pdf` y
`word` pasan por `blobToText` local a propósito (sin proveedor), `image` va a
OpenRouter y `audio` a AssemblyAI.

---


```text
Repository        Dot idk14/cancelaciones-ai
Branch            main
HEAD              6d0402c  (guard de contrato; antes 74e1757)
origin/main       6d0402c
Working tree      CLEAN al inicio de esta fase
Vercel production 74e1757 READY  (este commit es un guard, no toca runtime)
DB target         InsForge  Cancelaciones / 4pw4jdzv  (PRODUCCIÓN)
```

El handoff decía `3c59291`. Medido: el deploy vivo era `74e1757` (3c59291 más el
commit del informe). Corrección menor, sin impacto.

> Esta fase tuvo **dos partes**. La primera (secciones 1 a 14) se ejecutó sin
> sesión de usuario. La segunda, documentada en **§0**, se ejecutó con una
> sesión autenticada real y cambia el veredicto de varios gates. El §0 va primero
> porque es el estado final.

## 1. Environment

## 2. Schema Contract Verification

**PASS — 37 invariantes contra Postgres real.**

`pnpm db:verify-contract` → `SCHEMA CONTRACT: PASS`.

Este guard existe porque el incidente demostró un fallo estructural: la
migración **declaraba** `PROCESSING` y la base **no lo tenía**, y
`CREATE TABLE IF NOT EXISTS` no podía detectarlo. Por eso el guard **no lee los
ficheros de migración** — eso es justo lo que falló — sino que consulta Postgres.

| Grupo | Invariantes | Resultado |
|---|---|---|
| Estados del Fact Run | exactamente `DRAFT, FAILED, FROZEN, PROCESSING` | OK |
| Funciones del pipeline | 7 (freeze, begin_processing, derive, persist, 3 del ledger de coste) | OK |
| Tablas de la fundación | 9 | OK |
| Columnas de lease/backoff de `jobs` | 6 | OK |
| RLS activo | 16 tablas | OK |
| ACL de tablas de coste | 0 DML de `anon` | OK |
| Índices de idempotencia | 2 | OK |

**Verificado que falla**: con `PROCESSING` retirado del contrato — simulando el
estado real durante el incidente — el guard sale con código 1 y nombra la
invariante rota. Un guard que no puede fallar no sirve, así que se probó que
falla.

Tres cosas que costaron arreglar y que quedan documentadas en el propio script,
porque son trampas reales:

- `execFileSync('npx', ...)` falla en Windows: `npx` es `npx.ps1`/`npx.cmd` y Node 22
  lo rechaza con `EINVAL`. Se resuelve ejecutando el entry point de npx con el
  propio Node.
- El CLI **descarta** un argumento SQL que empieza o termina en blanco, y con
  saltos de línea intermedios el transporte los pierde: `Query is required` y
  `missing FROM-clause entry`, ninguno de los cuales dice algo del contrato. Se
  colapsa a una línea.
- El `CHECK` se parsea en JS, no con una regex en SQL.

## 3. AI Processing Switch

```text
Antes de esta fase : AI_PROCESSING_ENABLED = false  (production, preview, development)
Ahora               : AI_PROCESSING_ENABLED = true
```

Fijado vía API de Vercel sobre `prj_eyXZmqV5auQIcPFyhJ7c1lvDXNRw`, entorno
`NKsO7zPZf6Po5Ml6`, targets `production,preview,development`, y verificado
leyéndolo de vuelta.

## 4. Controlled Audit

**Auditoría elegida**: la del incidente, `4956e983-ba50-418a-b831-d6b2cca249ea`,
porque sus evidencia ya estaban procesadas y sus artifacts ya existían. Exactamente
lo que pide el escenario de reanudación.

**Vía de ejecución**: el handler real contra la base real, con el mismo
`claimNext` y el mismo `executeClaimedJob` que usa la aplicación. **No** se usó
`POST /api/jobs/process` porque exige sesión y en este entorno el anon key de
producción responde `401 AUTH_UNAUTHORIZED` en el gateway.

Qué prueba y qué no:

```text
SÍ  : el pipeline real, la DB real, el claim real, el handler real
NO  : la capa HTTP, que es donde vivía el bucle -> requiere navegador con sesión
```

### Estado verificado antes de empezar

```text
fact run 92e7ff98-41e3-4269-82e4-7ccab1caccc8  -> PROCESSING
6 x EVIDENCE_PROCESSING  SUCCEEDED   att 1/3
1 x FACT_EXTRACTION      RETRY_SCHEDULED  att 2/3  backoff elapsed = true
artifacts 6   facts 8   snapshots 0   engine_runs 0
```

### Resultado

```text
reclamado: FACT_EXTRACTION (job ac2cd20b..., attempt 3)
-> handler OK (el handler y el control completaron; el RPC de freeze exigia sesion de usuario)
estado final: FACT_EXTRACTION  FAILED  att 3/3  err AUTH_ERROR
```

Y lo que ese resultado **demuestra**, que es lo importante:

| Requisito | Evidencia | Veredicto |
|---|---|---|
| Las 6 evidencias NO se reprocesan | `evidence_processing with attempt_count > 1` → **0 filas** | **PASS** |
| El job es reclamable y se reclama | `claimNext` devolvió el job, attempt 3 | PASS |
| Presupuesto de reintentos respetado | 3/3, no un cuarto intento | PASS |
| El error determinista es TERMINAL | `AUTH_ERROR` → `failPermanent`, **no** otro `RETRY_SCHEDULED` | **PASS** |
| No hay `RETRY_SCHEDULED → RUNNING → RETRY_SCHEDULED` por el mismo error | el job pasó a `FAILED` y se quedó | **PASS** |
| Facts idempotentes | siguen siendo **8**, sin duplicados | PASS |
| El Fact Run no se corrompió | sigue en `PROCESSING`, ningún estado inválido | PASS |
| `PROCESSING → FROZEN` por la vía real | **NO** — `AUTH_REQUIRED` | **FAIL** → **SUPERADO en §0.1** |

> **SUPERADO en la fase 2.** Con sesión autenticada real el freeze se autorizó y
> el run llegó a `FROZEN` con snapshot. Ver §0.1. El `FAIL` de arriba se
> conservaba porque documenta fielmente lo que ocurría sin sesión.

El `AUTH_ERROR` no es un defecto del pipeline: `freeze_fact_run_v1` exige
`auth.uid()` y lo estoy ejecutando con la clave de servicio, sin sesión de
usuario. **La autorización hizo su trabajo.** Lo que no puedo es conseguir una
sesión de usuario real en este entorno.

### Dejar la auditoría lista

El job original quedó `FAILED` en `3/3`. Se reencoló un `FACT_EXTRACTION` de
reanudación con clave de idempotencia nueva, apuntando al **mismo** Fact Run:

```text
facts:92e7ff98:resume1   QUEUED  0/3  claimable = true
```

Así, cuando el OWNER abra la auditoría **con su sesión**, el auto-resume lo
reclamará y el freeze se autorizará. Es el camino de recuperación previsto y no
toca los artifacts existentes.

## 5. Network Request Counts

**NO MEDIDO.** Requiere navegador con sesión.

El `NEXT_PUBLIC_INSFORGE_ANON_KEY` de producción responde `401` en el gateway, así
que sin credenciales no hay sesión. En la fase 2 (§0) se obtuvo un JWT real, pero
**no abre las rutas HTTP**: la app construye el cliente de servidor con
`createServerClient({ cookies })`, es decir, autentica **por cookie**, no por
cabecera `Authorization`. Con un JWT en la cabecera las rutas seguirían viendo
una sesión vacía. Por eso este gate necesita un navegador de verdad y no se puede
automatizar desde aquí. Procedimiento en §12.

## 6. Job State Transitions

Secuencia real observada para `FACT_EXTRACTION`:

```text
RETRY_SCHEDULED (2/3, SYNTHETIC_TRANSIENT_ERROR)
  -> RUNNING      (attempt 3, lease tomado)
    -> FAILED     (AUTH_ERROR, failPermanent, lease liberado)
```

Exactamente la secuencia exigida en §7, incluida la parte que faltaba: **no**
volvió a `RETRY_SCHEDULED` por el mismo error. Antes del fix habría bounced
`RETRY_SCHEDULED → RUNNING → RETRY_SCHEDULED` indefinidamente.

Los 6 `EVIDENCE_PROCESSING` nunca entraron en `RUNNING`: su `attempt_count`
sigue en 1.

## 7. Fact Run Lifecycle

> **SUPERADO en la fase 2.** El resultado final es `FROZEN` con snapshot sellado.
> Ver §0.1. Se conserva el estado observado en la fase 1.

```text
initial : PROCESSING
final   : PROCESSING
snapshots: 0
facts    : 8 (sin duplicados)
```

`PROCESSING → FROZEN` **no se demostró de extremo a extremo**, por el motivo de
autorización de §4. La transición `DRAFT → PROCESSING` sí está probada contra la
base real desde la fase anterior, y el `CHECK` que la hace posible está verificado
por el guard de contrato.

## 8. Provider Operations

```text
total    : 0
billable : 0
duplicates: NO (no hubo ninguna)
```

Correcto y esperado: `FACT_EXTRACTION` no llama a proveedores. Los
`EVIDENCE_PROCESSING` que sí los llaman ya se habían ejecutado **antes** de que
existiera la instrumentación, así que no hay ledger de ellos.

**Esto significa que la idempotencia de operaciones pagadas NO está demostrada
en producción.** Está probada en tests (19 casos, incluido el caso
`SUBMITTED`→`RESULT_UNKNOWN`) pero no con una llamada real.

## 9. AI Usage

> **Actualizado en §0.3.** La escritura de uso **sí funciona**:
> `record_ai_usage_v1` (16 parámetros) → fila en `ai_usage` → resumen con
> `knownCostUsd=0.000616`, `providerCallCount=1`, `providers=OPENROUTER`. El
> `0 filas` de esta sección era falta de una llamada real de proveedor, no un
> fallo del mecanismo. **Pero** las §§0.4 A y B muestran que la fuente del coste
> no se persiste y que un coste desconocido no se puede registrar.

```text
rows        : 0
OpenRouter  : 0
AssemblyAI  : 0
```

`ai_usage` sigue vacío porque en esta fase **no hubo ninguna llamada de
proveedor**: el handler que se ejecutó es `FACT_EXTRACTION`, que es
determinista. No es un fallo de la instrumentación; es que no se ha dado el
caso que la generaría.

Para que aparezca una fila hace falta procesar una evidencia **nueva** por la
vía de la aplicación, que es precisamente lo que el OWNER hará al subir su
auditoría.

## 10. Audit Cost

```text
known USD          : 0.0000
unknown operations : 0
providerCallCount  : 0
```

`GET /api/audits/<id>/cost` responde correctamente (401 sin sesión, que es lo
correcto; la autorización está verificada por construcción y coincide con el
resto de rutas de auditoría).

Con cero operaciones, la UI muestra "Sin operaciones de proveedor registradas",
que es la salida honesta. **No muestra `$0.00`**, que sería afirmar que no se
gastó nada cuando en realidad no se midió nada.

## 11. Decision Trace

```text
disponible : SÍ (endpoint vivo, 401 sin sesión)
descarga   : no verificada en esta fase
```

El endpoint `/api/audits/<auditId]/decision-trace` está desplegado y responde.
Fue validado contra **7 de 8 auditorías reales** en una fase anterior, con
contenido completo (reglas, condiciones, missing facts, coverage gaps,
diagnósticos). No se revalidó porque la auditoría de esta fase no llegó a
`tener` `engine_run`: sin evaluación, no hay trace, y fabricarlo sería
inventarlo.

## 12. Browser Regression

**NOT EXECUTED — hueco real, no un PASS.**

Es el gate que faltaba desde el informe anterior y **sigue faltando**. Requiere
una sesión autenticada y un navegador, y no hay ninguna de las dos cosas aquí:
el anon key de producción responde `401` en el gateway, así que no se puede ni
siquiera abrir sesión.

Lo que sí se puede afirmar, con su límite explícito:

```text
AFIRMADO   la política de decision (queue-drain) esta probada: 20 tests, y uno
           demuestra que la logica antigua postea 200 veces y la nueva 0
AFIRMADO   en la ejecucion real de esta fase, las 6 evidencias no se
           reclamaron (attempt_count sigue en 1) y FACT_EXTRACTION se reclamo
           UNA vez y quedo terminal
NO AFIRMADO el conteo de POST /api/jobs/process en un navegador real
```

**Procedimiento manual para el OWNER** (es exactamente lo que pide §13):

```text
1. Abrir la auditoria 4956e983 con sesion.
2. DevTools -> Network, filtrar "jobs/process".
3. Dejar correr varios ciclos de polling (la UI poll cada ~700 ms).
4. Contar POST /api/jobs/process:
   - con el job QUEUED: 1 por cada job que haya que despertar
   - con RUNNING: 0
   - con RETRY_SCHEDULED esperando available_at: 0
   - con SUCCEEDED: 0
5. El sintoma del incidente seria POST, POST, POST... a ~700 ms sin fin.
   Si aparece: volver a poner AI_PROCESSING_ENABLED=false y avisar.
6. Anotar los conteos y pegarlos al informe.
```

## 13. Golden Master

```text
14 / 14 PASS
Hash 38e29f441498b72137fcb6bda49b0aa00ff6f4f898c2c7f6504b46a378ea0d76  MATCH
Fixture sin tocar
```

## 14. Remaining Risks

Actualizado tras la fase 2 (§0).

| # | Riesgo | Estado |
|---|---|---|
| 1 | **Regresión de navegador sin validar** | **OWNER_ACTION**, procedimiento en §12 |
| 2 | **Defecto A: `ai_usage` no persiste `cost_source`** | **BUG ABIERTO**, requiere migración |
| 3 | **Defecto B: coste desconocido imposible de registrar** | **BUG ABIERTO**, `unknownCostEvents` es código muerto |
| 4 | Idempotencia de operación pagada sin demostrar en producción | probada en tests; la tabla salió vacía |
| 5 | Coste de AssemblyAI seguirá siendo `NULL` sin pricing configurado | requiere pricing versionado |
| 6 | El `FACT_EXTRACTION` original quedó `FAILED` 3/3 | reencolado y **completado** en la fase 2; el original se conserva como registro |
| 7 | Credenciales de InsForge aportadas en conversación | **rotar** |
| 8 | Token de Vercel expuesto en conversación | **rotar** |
| 9 | Historial Git con PII del estudiante | **OWNER_ACTION** |
| 10 | `HUMAN_CORRECTION_PARENT_SEMANTICS`, `AUDIT_ARCHIVAL_STATE` | de otras fases |

## 15. Final Gate

```text
schema contract guard PASS .............. SI  (37 invariantes, Postgres real)
AI processing ON ........................ SI  (config verificada)
no runaway POST loop .................... PARCIAL (logica probada; red sin medir)
FACT_EXTRACTION completes ............... SI  (SUCCEEDED con sesion real)
PROCESSING -> FROZEN real ............... SI  (FROZEN + snapshot sellado)
no duplicate provider paid operation ... VACIO (0 operaciones; no negativo)
ai_usage > 0 si hubo proveedor pagado ... N/A (no hubo proveedor pagado)
cost write path works ................... SI  (RPC -> ai_usage -> resumen)
cost source persisted ................... NO  (Defecto A)
unknown cost representable .............. NO  (Defecto B)
Decision Trace works .................... SI  (con contenido real)
authenticated browser/network PASS ..... NO  (requiere navegador)
Golden Master unchanged ................ SI  (14/14, hash MATCH)
normative engine unchanged ............. SI
```

Tres criteria siguen sin demostrarse y uno nuevo aparece **fallido**:

- **Navegador/red**: requiere un navegador real; la app autentica por cookies.
- **Llamada real de proveedor**: se producirá al subir la primera auditoría con
  imagen o audio. `pdf`/`word` son locales por diseño.
- **Defecto A y Defecto B**: no son bloqueos de entorno, son **bugs reales** de
  la telemetría de coste, encontrados al ejercitar la ruta con sesión.

Por eso:

```text
READY FOR OWNER TO UPLOAD A NEW AUDIT: NO
```

No por el pipeline: el ciclo de vida completo se ha ejecutado de extremo a
extremo contra producción y ha funcionado. Es por **no medir un gate de red** y
por **no poder afirmar PASS sobre costes** mientras el guard de coste sea incapaz
de registrar tanto el origen como la incertidumbre. El §13 de la instrucción es
explícito: no marcar PASS sin evidencia.

Lo que sí es cierto y accionable desde ya mismo:

- La auditoría `4956e983` está **completa**: `FROZEN`, evaluada, con reporte y
  Decision Trace con contenido. Ya no necesita que el OWNER la reanude.
- Las 6 evidencias **no se reprocesaron**: `attempt_count` en 1, verificado con
  sesión real.
- El OWNER puede subir una auditoría nueva: producirá la llamada real de
  proveedor, y con ella los conteos de Network del §12.
- **Antes de confiar en el panel de coste**, hay que arreglar los defectos A y B.

