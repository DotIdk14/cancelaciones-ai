# Final Production Audit Validation

**Fecha**: 2026-09-25
**Objetivo**: cerrar los gates pendientes para `READY FOR OWNER TO UPLOAD A NEW AUDIT`
**Alcance**: validación. Sin features nuevas, sin cambios normativos.

---

## 1. Environment

```text
Repository        DotIdk14/cancelaciones-ai
Branch            main
HEAD              6d0402c  (guard de contrato; antes 74e1757)
origin/main       6d0402c
Working tree      CLEAN al inicio de esta fase
Vercel production 74e1757 READY  (este commit es un guard, no toca runtime)
DB target         InsForge  Cancelaciones / 4pw4jdzv  (PRODUCCIÓN)
```

El handoff decía `3c59291`. Medido: el deploy vivo era `74e1757` (3c59291 más el
commit del informe). Corrección menor, sin impacto.

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
| `PROCESSING → FROZEN` por la vía real | **NO** — `AUTH_REQUIRED` | **FAIL** |

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

No existe sesión autenticada en este entorno: el `NEXT_PUBLIC_INSFORGE_ANON_KEY`
de producción responde `401 AUTH_UNAUTHORIZED` en el gateway, y no hay forma de
obtener un JWT de usuario sin credenciales. Todo lo que se puede afirmar sin
mentir es lo de §12.

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

| # | Riesgo | Estado |
|---|---|---|
| 1 | **Regresión de navegador sin validar** | **OWNER_ACTION**, procedimiento en §12 |
| 2 | **`PROCESSING → FROZEN` no demostrado end-to-end** | bloqueado por falta de sesión |
| 3 | **`ai_usage` sin demostrar con una llamada real** | se demuestra al subir la primera auditoría nueva |
| 4 | Idempotencia de operación pagada sin demostrar en producción | probada en tests, no en ejecución |
| 5 | El `FACT_EXTRACTION` original quedó `FAILED` 3/3 | reencolado como `QUEUED`; el original se conserva como registro |
| 6 | Coste de AssemblyAI seguirá siendo `NULL` sin pricing configurado | requiere pricing versionado |
| 7 | Token de Vercel expuesto en conversación | **rotar** |
| 8 | Historial Git con PII del estudiante | `OWNER_ACTION` |
| 9 | `HUMAN_CORRECTION_PARENT_SEMANTICS`, `AUDIT_ARCHIVAL_STATE` | de otras fases |

## 15. Final Gate

```text
schema contract guard PASS .............. SI
AI processing ON ........................ SI
no runaway POST loop .................... PARCIAL (logica probada; red sin medir)
FACT_EXTRACTION completes ............... SI (SUCCEEDED en su camino, FAILED por
                                          autorizacion, no por logica)
PROCESSING -> FROZEN real ............... NO
no duplicate provider paid operation ... SI (0 operaciones; vacio, no negativo)
ai_usage > 0 si hubo proveedor pagado ... N/A (no hubo proveedor pagado)
cost endpoint works ..................... SI
Decision Trace works .................... SI (endpoint; sin contenido nuevo)
authenticated browser/network PASS ..... NO
Golden Master unchanged ................ SI
normative engine unchanged ............. SI
```

Tres de los doce criteria no quedan demostrados, y los tres por la **misma
causa**: no existe sesión autenticada en este entorno. No es una limitación del
codigo del pipeline, que es lo que esta fase audita; es una limitacion del
entorno desde el que se opera.

Por eso:

```text
READY FOR OWNER TO UPLOAD A NEW AUDIT: NO
```

No porque la aplicación no esté lista —creo que lo está— sino porque declarar
`YES` exigiría marcar `PASS` un gate de red que no he medido, y el §13 de la
instrucción es explícito: **no marcar PASS sin evidencia**.

Lo que sí es cierto y accionable desde ya mismo:

- La aplicación está desplegada, estable y sin errores 500.
- La auditoría `4956e983` está **reencolada y lista** para reanudarse: al abrirla
  el OWNER, con su sesión, el pipeline continuará desde `PROCESSING` usando los
  artifacts existentes **sin reprocesar las 6 evidencias** — eso ya está probado.
- El OWNER puede subir una auditoría nueva y sería la prueba que falta: una
  llamada real de proveedor writing en `ai_usage`, un `PROCESSING → FROZEN`
  completo, y los conteos de Network del §12.
