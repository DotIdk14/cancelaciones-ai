# Runaway Jobs Incident

**Fecha**: 2026-09-25
**Auditoría afectada**: `4956e983-ba50-418a-b831-d6b2cca249ea` ("Expediente prueba 2")
**Severidad**: ALTA — bucle de peticiones, con riesgo de coste externo
**Estado**: root cause encontrado y corregido en código. **NO desplegado.**

---

## 1. Root cause

**Una línea de condición en `AuditWorkflow.tsx`, más un endpoint que devuelve un 200
indiscriminable.**

```tsx
// apps/web/src/app/(private)/auditorias/[auditId]/AuditWorkflow.tsx (antes)
const activeStatuses = new Set(['QUEUED', 'RUNNING', 'RETRY_SCHEDULED']);
// ...
const active = jobs.some((job) => activeStatuses.has(job.status));
if (!active) return;                                    // <- sólo sale si NO hay nada activo
const processResponse = await fetch('/api/jobs/process', { method: 'POST' });
await new Promise((resolve) => setTimeout(resolve, 700));
```

El error conceptual es una sola cosa: **"hay trabajo" y "el cliente debe pedir
que se procese" se trataron como la misma pregunta.**

- `RUNNING` significa que el job **ya está en curso**. No es trabajo pendiente: es
  trabajo en manos de su worker. Pedirlo otra vez desde el mismo cliente no lo
  acelera, porque el claim vive en la base de datos, no en el cliente.
- `RETRY_SCHEDULED` significa que el job **está en backoff**. Tiene un
  `available_at`. POSTear antes de esa hora es un no-op.

Con cualquiera de los dos en ese estado, `active` era `true` para siempre, así
que el bucle no tenía condición de salida hasta agotar 60 iteraciones.

**Y el segundo defecto, sin el cual el primero no habría parado**: el endpoint
devolvía `200 { processed: 0 }` cuando no había nada reclamable, que es
**indistinguible** de `200 { processed: 1 }`. El cliente no podía decidir si
repetir, y repetía. Un 200 que no significa "sigue" es un 200 que invita a un
bucle.

## 2. Affected audit

```text
auditId          4956e983-ba50-418a-b831-d6b2cca249ea
displayName      Expediente prueba 2
externalCaseId   prueba 2
evidencias       6
fact_extraction_runs  1   (estado: DRAFT)
facts                8
engine_runs          0
```

## 3. Cadena causal completa, verificada

Cada eslabón comprobado contra el código y la base, no inferido:

```text
1.  fact_extraction_runs queda en DRAFT, nunca avanza a PROCESSING
        ↓  evidencia: consulta directa, run_states = "DRAFT"
2.  el job FACT_EXTRACTION ejecuta freeze_fact_run_v1
        ↓  evidencia: migrations/20260925120000:859
           IF v_run.state <> 'PROCESSING' THEN
             RAISE EXCEPTION 'FACT_RUN_NOT_PROCESSING: %', v_run.state;
3.  executeClaimedJob captura la excepción y la marca como reintentable
        ↓  evidencia: apps/web/src/server/jobs/handlers.ts:260-263
           await ...scheduleRetry(job.jobId, workerId,
             'SYNTHETIC_TRANSIENT_ERROR', message, 30);
4.  el job queda RETRY_SCHEDULED con available_at = ahora + 30 s
        ↓  evidencia: job ac2cd20b, attempts 2/3,
           available_at 2026-09-25T21:39:44.395Z,
           last_error_code SYNTHETIC_TRANSIENT_ERROR,
           last_error_message "FACT_RUN_NOT_PROCESSING: DRAFT"
5.  la UI ve RETRY_SCHEDULED ∈ activeStatuses  ->  "activo"  ->  POST process
        ↓  evidencia: AuditWorkflow.tsx línea 47-49
6.  claim_next_job rechaza correctamente el job (está en backoff)
        ↓  evidencia: jobs.lease_owner = null, claimNext usa el RPC
           claim_next_job(p_worker_id, p_lease_seconds)
7.  el endpoint devuelve 200 { processed: 0 }
        ↓  evidencia: route.ts línea 20, versión anterior
8.  la UI interpreta 200 como "sigue"  ->  repite a los ~700 ms
```

**El job que mantuvo el bucle vivo**: `ac2cd20b-afd6-4a07-8741-8665860e1b5b`,
`FACT_EXTRACTION`, `RETRY_SCHEDULED`, `attempts 2/3`, nunca llegó a terminal.

## 4. Request loop explanation

No fue un bucle infinito. Fue un bucle **acotado y patológico**:

```text
waitForJobs   -> máximo 60 iteraciones × ~700 ms  ≈ 60 POSTs por llamada
finishPipeline -> llama a waitForJobs OTRA vez  ≈ 60 POSTs más
cada montaje de página                          ≈ hasta 120 POSTs

y POST /api/jobs/process va acompañado de GET /api/audits/<id>
```

Eso explica los ~90 requests observados antes de cerrar el navegador: una
fracción de dos mounted `waitForJobs`. Un refresh resetea `resumedRef`, así que
el auto-resume volvía a arrancar el ciclo.

**El ritmo de ~1 s** encaja: 700 ms de sleep + latencia de red.

## 5. Jobs, attempts, artifacts

Consultado directamente en producción:

```text
UNIQUE_JOBS            = 7
  SUCCEEDED            = 6
  FAILED               = 0
  STILL_ACTIVE         = 1   <- el que mantenía el bucle
JOB_ATTEMPTS           = 8   (suma de attempt_count)
MAX_ATTEMPTS_USED      = 2   de un máximo de 3
ARTIFACTS              = 6
ARTIFACTS_PER_DISTINCT_JOB = 1  (6 artifacts en 6 jobs distintos)
```

Detalle de los 6 jobs completados: `EVIDENCE_PROCESSING`, `attempts: 1` cada uno,
`SUCCEEDED`, sin `last_error_code`.

```text
job_artifacts por tipo:  visual-transcription x 6   (provider = NULL)
distinct_jobs:          6
```

**Un artifact por job. Ninguna duplicación.**

## 6. External calls — y por qué esta respuesta tiene un asterisco

```text
HTTP_PROCESS_REQUESTS        ≈ 90        (observado en el navegador)
UNIQUE_JOBS                  = 7
JOB_ATTEMPTS                 = 8
EXTERNAL_AI_CALLS            = DESCONOCIDO
DUPLICATE_EXTERNAL_AI_CALLS  = NO (para trabajo duplicado) / NO VERIFICABLE (para gasto)
```

Aquí es donde tengo que ser preciso, porque la respuesta fácil sería mentir.

**Lo que sí está probado**: ningún job se ejecutó dos veces. La evidencia es
durable y de tres fuentes independientes:
- `attempt_count = 1` en los 6 jobs completados;
- 6 artifacts en 6 jobs distintos, ninguno repetido;
- `claim_next_job` con `lease_owner` / `lease_expires_at` es la garantía real, y
  **`lease_owner = null` en los 7** porque los jobs ya estaban terminados.

El bucle de HTTP **no** produjo trabajo duplicado. El claim en la base aguantó.

**Lo que NO está probado**: que no hubiera llamadas a proveedores. Porque
`EVIDENCE_PROCESSING` **sí** llama a proveedores externos:

```text
apps/web/src/server/jobs/handlers.ts:91-113   AssemblyAI upload + transcript + poll
apps/web/src/server/jobs/handlers.ts:125      OpenRouter chat/completions
```

Y la telemetría de coste **no existe**:

```text
public.ai_usage                -> 0 filas
job_artifacts.provider         -> NULL en los 6
grep de "ai_usage" en código no-test -> NINGUNA escritura
```

Es decir: **nadie está escribiendo en `ai_usage`.** La tabla tiene las columnas
correctas (`provider`, `model`, `input_units`, `output_units`, `estimated_cost_usd`,
`provider_operation_id`, `job_id`, `attempt_id`) y no las rellena nadie.

Por eso `EXTERNAL_AI_CALLS` es `DESCONOCIDO` y no un número. No puedo afirmar
cuánto se gastó, ni afirmar que no se gastó, porque el registro que lo diría no
se está llenando. La conclusión "no hubo duplicación" rests sobre el nivel de
job, que es sólido, pero **el coste real es invisible**.

Esto no es un detalle: es un agujero. Una fuga de coste por error de
programación sería **indetectable** con el sistema actual.

### ¿Se gastó dinero repetidamente?

**No hay evidencia de gasto repetido, y tampoco forma de saberlo.**

Lo honesto: los 6 jobs que terminaron lo hicieron una vez cada uno, con
`attempts: 1`. El bucle de POST no reclamó trabajo duplicado. Pero como
`ai_usage` está vacío, **no puedo confirmar que el número de llamadas al
proveedor coincida con el número de jobs**. Lo que puedo afirmar es que no
hay COSTO REPETIDO POR TRABAJO DUPLICADO, que es el riesgo concreto del
incidente.

## 7. Fix

Tres cambios, todos en el borde. Ninguno toca el motor normativo.

### 7.1 La decisión deja de estar en el componente

Nuevo módulo `apps/web/src/server/jobs/queue-drain.ts`. Función pura, sin React
ni red, testeable:

```ts
decideDrainAction(jobs) ->
  | { kind: 'done' }                                    // nada que hacer
  | { kind: 'failed', job }                             // propagar, no insistir
  | { kind: 'process' }                                 // SÓLO si hay QUEUED
  | { kind: 'wait', reason: 'RUNNING' | 'RETRY_SCHEDULED' }
```

**Separación polling / processing, explícita:**

```text
UI            -> consulta estado:  GET  /api/audits/<id>/jobs   (sólo lectura)
UI            -> pide trabajo:     POST /api/jobs/process       (sólo si hay QUEUED)
worker        -> procesa:          claim_next_job + handler
```

Cuando hay un job en `RETRY_SCHEDULED`, la UI **espera hasta su `available_at`**
(capped a 5 s) y consulta. Ya no POSTea.

### 7.2 El endpoint dice qué pasó

```ts
type status = 'processed' | 'nothing_to_process' | 'already_running'
            | 'retry_scheduled' | 'terminal_failure' | 'ai_processing_disabled'
```

Los cinco estados que **no** autorizan otro POST son la mitad del arreglo: un
200 seguido de "no hagas nada" tiene que ser legible, o el cliente lo
interpretará como permiso para seguir. `already_running` y `retry_scheduled` se
determinan leyendo la cola, porque `claim_next_job` no dice por qué devolvió
nada.

### 7.3 Kill switch

`AI_PROCESSING_ENABLED` — variable de entorno, no columna en la base, porque en
una emergencia tiene que cambiar en segundos sin deploy.

| Estado | Lectura | Decision Trace | Proveedores |
|---|---|---|---|
| `'false'`, `'0'`, `'no'`, `'off'` | apagado | **funciona** | **no se invocan** |
| ausente o cualquier otro valor | encendido | funciona | se invocan |

El **default es encendido**: un despliegue sin la variable debe procesar con
normalidad. Si el default fuera "apagado", un `forgot` de configuración dejaría
el producto sin dictamen y nadie sabría por qué.

Cuando está apagado el endpoint devuelve `200 { status: 'ai_processing_disabled' }`
— **estado controlado, no 500** — y no reclama ningún job, así que no se consume
ningún intento ni se toca la cola.

**Cómo activarlo** (documentado, **no ejecutado** — requiere decisión del OWNER):

```bash
# Vercel -> Project -> Settings -> Environment Variables
AI_PROCESSING_ENABLED = false      # redeploy
# o quitar la variable / ponerla en "false" -> apagar
```

### 7.4 Lo que NO se corrigió

`executeClaimedJob` sigue etiquetando **toda** excepción como
`SYNTHETIC_TRANSIENT_ERROR` (`handlers.ts:262`). Eso tiene dos consecuencias que
no son de este incidente pero que el incidente dejó visibles:

1. `FACT_RUN_NOT_PROCESSING: DRAFT` es **determinista** — el run seguirá en
   `DRAFT` en el reintento — y se trata como reintentable. Gastó 2 de 3 intentos
   en algo que no podía funcionar. Con un máximo de 3, un job como éste sí
   alcanzaría terminal, pero por accidente y no por diseño.
2. El nombre `SYNTHETIC_*` es de fixture de test y está en producción, lo que hace
   que un fallo real y uno sintético sean indistinguibles en los logs.

Clasificar error determinista vs. transitorio es un cambio de comportamiento del
pipeline. **No lo toqué**: es alcance de otro cambio y exige revisar cada handler.

## 8. Tests

`apps/web/src/server/jobs/queue-drain.test.ts` — **20 tests**.
`apps/web/src/server/jobs/processing-switch.test.ts` — **23 tests**.

El test de regresión incluye la demostración de que **la lógica antigua falla**:

```ts
it('LA LÓGICA ANTIGUA SÍ PRODUCE EL BUG: así se prueba que el test es una regresión real', () => {
  const legacyActive = new Set(['QUEUED', 'RUNNING', 'RETRY_SCHEDULED']);
  const legacyPosts = Array.from({ length: 200 }, () => job())
    .filter((entry) => legacyActive.has(entry.status)).length;
  expect(legacyPosts).toBe(200);            // <- la condición vieja postea 200 veces

  const newPosts = Array.from({ length: 200 }, () => job())
    .filter((entry) => decideDrainAction([entry]).kind === 'process').length;
  expect(newPosts).toBe(0);                 // <- la nueva, cero

  expect(legacyPosts).toBeGreaterThan(newPosts);
});
```

Cobertura frente a los puntos que pedía el encargo:

| Requisito | Test |
|---|---|
| audit con job pendiente | `pide procesar exactamente una vez por job QUEUED` |
| mientras RUNNING, polling no reprocesa | `NO pide procesar mientras un job está RUNNING` |
| después de SUCCEEDED, no llama process | `termina si todos han terminado bien` |
| refresh no duplica trabajo | `con el job atascado, 0 de 200 iteraciones piden procesar` |
| dos clientes no producen dos ejecuciones | `no pide procesar nunca para un job en curso` + garantía de lease en DB |
| retry respeta maxAttempts | `propaga el fallo en vez de seguir insistiendo` |
| kill switch | 23 tests, incluidos default encendido y typo no apaga |

**No verificado en navegador real.** Los tests son de la política de decisión,
que es donde estaba el bug. El comportamiento de red del componente no se
probó con un navegador.

## 9. Remaining risk

| # | Riesgo | Estado |
|---|---|---|
| 1 | **`ai_usage` nunca se escribe** | abierto. El coste de proveedores es invisible. Es el riesgo más serio que queda. |
| 2 | Todo error es `SYNTHETIC_TRANSIENT_ERROR` y reintentable | abierto. Un error determinista quema intentos. |
| 3 | Sin `terminal_failure` real: el job quedó en `RETRY_SCHEDULED` con 2/3 | abierto. Falta ver el comportamiento al agotar. |
| 4 | Un `fact_extraction_runs` en `DRAFT` no avanza solo | abierto. El run se queda en DRAFT y el freeze falla. Causa raíz de este incidente y **no** está arreglada: el arreglo fue que el bucle no se descontrolara, no que el job pueda progresar. |
| 5 | El UI sigue siendo quien "despierta" al processor | mitigado, no eliminado. Es edge-triggered y ahora sólo cuando hay `QUEUED`. |
| 6 | Sin contrato de idempotencia por `fact_run` para `FACT_EXTRACTION` | abierto. La garantía es el lease, que es de job, no de resultado. |
| 7 | `provider` NULL en `job_artifacts` | abierto. Impide atribuir coste por job. |
| 8 | El test es de lógica, no de red real | abierto. |

**El punto 4 es el que más me preocupa y conviene decirlo claro**: este arreglo
**detiene el bucle, no arregla la causa de fondo.** La auditoría
`4956e983` sigue con su job en `RETRY_SCHEDULED` y su fact run en `DRAFT`. Con
el hotfix, la UI lo mostrará y se detendrá; el job no progresará. La pregunta de
por qué un `FACT_EXTRACTION` encuentra el run en `DRAFT` sigue abierta y es un
cambio de pipeline, no de frontend.

## 10. Deployment recommendation

**No desplegar todavía** hasta que el OWNER decida estas dos cosas:

1. **¿Se activa el kill switch?** Si sí: `AI_PROCESSING_ENABLED=false` antes de
   desplegar, para que el hotfix aterrice con el procesamiento de coste apagado. Es la
   secuencia que recomiendo si hay cualquier duda sobre el coste pendiente.
2. **¿Se acepta desplegar sólo el frontend del bucle**, dejando abiertos los
   puntos 1, 2 y 4?

Argumento a favor de desplegar: el defecto está en el frontend, el arreglo es
localizado y está cubierto por 43 tests, y el estado actual permite que cualquier
auditoría con un job en backoff repita ~120 POSTs. El coste de seguir sin
desplegar es que el incidente se repita.

Argumento en contra: el punto 4 significa que el job sigue sin poder progresar, y
un cliente que abra esa auditoría verá el error en vez de un bucle. Eso es mejor
que un bucle, pero es un error visible.

**Mi recomendación: desplegar el hotfix, con el kill switch apagado, y tratar el
punto 4 como el siguiente trabajo.** El bucle es el daño urgente; el run en
`DRAFT` es el defecto de fondo y necesita su propio cambio.

## 11. Verificación

```text
pnpm test        407 PASS  (296 web, antes 253; +43 de este incidente)
                 domain 14, db 14, reporting 26, policy-engine 57
pnpm typecheck   PASS
pnpm lint        PASS
pnpm build       PASS
pnpm guard:ci    PASS
Golden Master    14/14
fixture hash     38e29f441498b72137fcb6bda49b0aa00ff6f4f898c2c7f6504b46a378ea0d76  MATCH
packages/policy-engine  0 cambios
```

`evaluatePolicy` y `v5Rules` intactos. **Desplegado: NO.**
