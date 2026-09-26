# Cableado de tools, resolución estimada y simplificación de auditoría

**Fecha:** 2026-09-25
**Fuente normativa:** `GDM_GAM_PRD_MLG_003` (inmutable)
**Estado del repositorio al iniciar:** rama `feature/policy-foundation-remediation`, commit `becfa9d`

---

## 1. Diagnóstico: por qué el sistema no producía diferencia visible

El hallazgo central de esta auditoría es que **la capacidad pedida ya existía en el repositorio y estaba desconectada**. No era un requisito nuevo, era un requisito cableado a medias.

### 1.1 La capa de estimación existe y está muerta

`packages/policy-engine/src/adjudication.ts` ya implementa la resolución probabilística solicitada:

- `adjudicate()` — cuyo docstring dice literalmente *"Nunca se oculta tras INDETERMINATE"*.
- `computeConfidence()` — con fórmula documentada y explicable:
  `0.35·ruleSupport + 0.25·graphConsistency + 0.20·sourceCoverage + 0.10·factConfidence + 0.10·evidenceCoverage`,
  más penalización de `0.08` por contradicción y `0.30`/`0.12` por validación `FAIL`/`PARTIAL`.
- `validateCandidateDecision()` — impide que un candidato cite reglas inexistentes o contradiga reglas formales satisfechas.

**Único consumidor en todo el repositorio:** `apps/web/src/server/policy/blind-audit.ts` → `runBlindMachineAudit()`. Esa función **no tiene entrypoint productivo**: ningún job, ninguna ruta API, ningún componente la invoca.

### 1.2 El flujo real termina antes de la estimación

El pipeline productivo es:

```
apps/web/src/server/jobs/handlers.ts :: auditEvaluation
  → runPolicyEngineForAudit (apps/web/src/server/policy/evaluation.ts)
    → evaluatePolicy (packages/policy-engine/src/index.ts)
      → engine_runs.evaluation
```

`evaluatePolicy` devuelve `suggestedOutcome = null` cuando una regla decisiva queda `UNKNOWN`, lo que produce `outcomeStatus: 'INDETERMINATE'` y `decisionStatus: 'INDETERMINATE'` (`packages/policy-engine/src/index.ts:263-264`). La UI lo refleja literalmente en `apps/web/src/app/(private)/auditorias/[auditId]/AuditWorkflow.tsx:114`:

```ts
setMessage(`Dictamen listo: ${evaluation?.suggestedOutcome ?? 'INDETERMINADO'}.`);
```

`adjudicate()` nunca se invoca. De ahí que el resultado fuera siempre `INDETERMINADO` y que las tools no parecieran afectar nada.

### 1.3 Inventario de subsistemas muertos o huérfanos

| Subsistema | Archivo | Evidencia de no alcanzabilidad |
|---|---|---|
| Registry de extracción | `server/extraction/registry.ts` + `tools/extract-dates.ts` + `tools/extract-contact-attempts.ts` | Solo referenciado en `registry.test.ts` y tests de tools. Producción usa `server/facts/extract.ts` directamente. |
| Intérprete de evidencia | `server/policy/evidence-interpreter.ts` | Solo alcanzable desde `blind-audit.ts`. |
| Grafo de evidencia | `server/policy/evidence-graph.ts` | Ídem. |
| Razonador de política | `server/policy/reasoner.ts` + `prompts/policy-reasoner/` | Ídem. |
| Motor shadow | `packages/policy-engine/src/shadow-engine.ts` | Solo su propio test. |
| Worker de cola | `server/jobs/worker.ts` (`runJobWorker`) | Sin llamadores. La cola la mueve el navegador. |
| Job `METADATA_PROBE` | tipo en `packages/domain/src/index.ts` + handler `metadataProbe` en `handlers.ts` | Nadie lo encola. Es la tool de extracción de metadata solicitada, ya diseñada. |
| Escrituras de `ai_usage` | — | **Cero llamadores.** La tabla y la RPC `record_ai_usage` existen (migración phase-4). 0 filas en producción. |

### 1.4 Bugs reales confirmados en producción

1. **🔴 Cuatro políticas RLS sin el `GRANT` SQL correspondiente.** Hay política para el rol `authenticated` pero falta el privilegio, así que la operación falla con `permission denied` en lugar de un 403 de RLS:

   | Tabla | Política | Privilegios actuales |
   |---|---|---|
   | `fact_extraction_runs` | `UPDATE` | `INSERT, SELECT` |
   | `engine_runs` | `INSERT` | `SELECT` |
   | `engine_rule_results` | `INSERT` | `SELECT` |
   | `policy_source_registry` | `INSERT` | `SELECT` |

   Confirmado en producción: `postgres.logs` → `permission denied for table fact_extraction_runs` (2026-09-26T00:09:51Z), inmediatamente después de una extracción de hechos exitosa. **Esto rompe el congelamiento del fact run.**

2. **🟠 Loop de jobs confirmado.** `AuditWorkflow.tsx::waitForJobs` ejecuta `POST /api/jobs/process` seguido de `setTimeout(700)`, hasta 60 intentos. Es el loop de ~700 ms observado. No hay worker de fondo: si el navegador se cierra, la cola queda `QUEUED` indefinidamente. Contradice la invariante `NO_PROCESS_LOCAL_DURABILITY`.

3. **🟠 Un job FAILED en producción:** `FACT_EXTRACTION` / `AUTH_ERROR` / `AUTH_REQUIRED` (2026-09-25T21:38:41Z). De 50 jobs, 49 `SUCCEEDED`.

4. **🟠 No existe botón ni endpoint de Decision Trace.** La trazabilidad vive en `engine_runs.evaluation` y `report_snapshots.rule_trace`, pero no hay exportación. Lo único descargable es el PDF del dictamen.

5. **🟡 `vercel.json` sin bloque `headers`.** Solo `strict-transport-security` (default de Vercel). Faltan CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.

6. **🟡 Inconsistencia de códigos HTTP.** `/api/audits/{id}` responde 404 para un UUID inexistente mientras `/api/audits/{id}/dictamen` responde 401. El orden de chequeo de autenticación no es uniforme.

7. **🟡 Campos del formulario exigidos y descartados.** `studentId` y `classStartDate` se validan como obligatorios y luego no se persisten. `ticketStartDate` —el único campo que se conservará— tampoco se persiste.

8. **🟠 Agujeros de autorización.** `/api/audits/[auditId]/jobs` y `/api/audits/[auditId]/evidences` validan sesión + existencia del recurso, pero **no** exigen `createdBy === user.id`. `/api/evidences/[evidenceId]/download` tampoco valida propiedad. Cualquier usuario autenticado puede leer la cola, subir evidencias y descargar archivos de expedientes ajenos. `/api/jobs/process` permite a cualquier autenticado reclamar el siguiente job global.

---

## 2. Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Acceso | **C — RLS intacta, solo se oculta el login** | El usuario eligió explícitamente conservar el modelo de autorización. |
| Estimación | **C — híbrida escalonada** | Respetar `POLICY_ENGINE_DECIDES` y atacar la causa raíz en vez de decorar el síntoma. |
| Formato del JSON | **A — `normative.resolution` y `estimate.resolution` separados** | Impide que una estimación se lea como dictamen. |
| Probabilidad | Numérica internamente (`0.72`), texto en UI (`72%`) | Calculable y comparable, sin que la UI invente nada. |
| Ejecución de jobs | **Drenaje de cola en cada visita al workspace** | Vercel Hobby da ~2 ejecuciones de cron/día, insuficiente para ~50 auditorías. Un worker externo contradice `KEEP_IT_SIMPLE`. |
| Distribución | Los **6 outcomes reales** del motor | No inventar categorías alternativas. |
| Orden | Fix RLS primero, luego Trace, luego extracción+estimación, luego login+formulario, luego purga | Un riesgo ya materializado se atiende antes de construir encima. |

### 2.1 Consecuencias aceptadas de la decisión C

- **Todos los expedientes compartirán `created_by`.** La trazabilidad de *quién* se vuelve constante; *qué* y *cuándo* se conservan íntegros en `audit_log`.
- **La URL de Vercel queda abierta** a cualquiera que la conozca, con acceso a PII de estudiantes.
- **La identidad técnica no puede ser un flag de entorno tipo `LOCAL_DEMO=1`.** El repositorio ya tiene ese bypass (`apps/web/src/middleware.ts` y `getCurrentUser()` lo respetan), y convertirlo en el comportamiento por defecto crearía una ruta de evasión de autenticación alcanzable en producción. Se sustituye por una identidad técnica fija **solo en servidor**, sin flag de entorno que pueda activarse por accidente.

---

## 3. Arquitectura objetivo

### 3.1 Flujo

```
Nueva auditoría (solo fecha de ticket + evidencias)
  → upload + SHA-256 + storage
  → jobs: evidencia → hechos
  → extracción determinista          → hechos con source + confidence
  → [NUEVO] resolveUnknownConditions  → resuelve condiciones UNKNOWN   ← SE CONECTA
  → evaluatePolicy                   → status normativo (nunca se altera)
  → [NUEVO] estimateResolution        → resolución probable + % + base  ← SE CONECTA
  → [NUEVO] buildDecisionTrace        → JSON persistido                 ← NUEVO
  → UI: resolución estimada arriba, estado normativo aparte, botón rojo
```

**Invariante central:** `evaluatePolicy` es la autoridad. La capa de estimación **lee** su resultado y jamás lo modifica. Ninguna regla se reinterpreta, se flexibiliza ni se completa.

### 3.2 Componente 1 — `resolveUnknownConditions`

Reubicado desde `server/policy/evidence-interpreter.ts` (hoy muerto) a un módulo con frontera explícita. Entrada: `PolicyEvaluation` + artefactos. Salida: hechos verificables con `source`, `evidenceId` y `extractionConfidence`.

Reglas duras:

- Solo produce hechos **presentes en los artefactos**. Nada inferido sin respaldo textual.
- Si no encuentra nada, devuelve vacío. El caso permanece `INDETERMINATE`.
- No puede crear hechos que no estén en `POLICY_FACT_INVENTORY`.
- Su salida se convierte en facts y se **re-evalúa con las mismas reglas**. Si las reglas se cierran, el caso se cierra normativamente de verdad. Si no, sigue `INDETERMINATE` con mejor base probabilística.

### 3.3 Componente 2 — `estimateResolution`

Reutiliza `computeConfidence()` y `validateCandidateDecision()` existentes. Añade lo que falta:

1. **Distribución entre alternativas.** Reparte la masa de probabilidad entre los 6 `Outcome` reales del motor, en lugar de un número suelto. La suma es 1.
2. **Lista concreta de evidencia faltante**, derivada de `missingFacts`, `evidenceGaps` y `nextActions` del engine.
3. **Nivel de confianza** derivado de umbrales documentados (no de un número mágico).
4. **Explicación** que enlaza regla, condición, hecho y evidencia.

**Regla de predominio:** se elige el outcome con mayor soporte. Nunca se convierte esa elección en dictamen normativo.

**Distribución — método:** reparto ponderado por efecto de regla. Cada outcome recibe un peso = número de reglas evaluadas que lo produjeron, ponderado por el estado de la regla (`SATISFIED`=1.0, `UNKNOWN`=0.4, `NOT_SATISFIED`=0, `NOT_APPLICABLE` se excluye) y por la confianza de extracción de los facts que consume. Se normaliza a 1. Es determinista, reproducible y explicable regla por regla.

**Restricción adicional:** cuando `normative.status === 'DETERMINATE'`, `estimate` es `null` y no hay contradicción posible entre ambos.

### 3.4 Componente 3 — `buildDecisionTrace`

Ensambla el JSON de la sección 4 y lo persiste. **El endpoint de descarga sirve exactamente este artefacto**, de modo que botón y archivo no pueden desincronizarse.

### 3.5 Contrato del Decision Trace

```json
{
  "auditId": "…",
  "generatedAt": "2026-09-26T…",
  "policy": {
    "code": "GDM_GAM_PRD_MLG_003",
    "version": "5",
    "rulesFingerprint": "…",
    "factsFingerprint": "…"
  },
  "normative": {
    "status": "INDETERMINATE",
    "resolution": null,
    "decisiveRules": ["R-04", "R-11"],
    "blockingRules": [
      { "ruleId": "R-11", "missingFacts": ["classroom.hasGrades"] }
    ],
    "conflicts": [],
    "softwareCoverageGaps": []
  },
  "estimate": {
    "resolution": "CANCELACION_VENTA",
    "alternatives": { "CANCELACION_VENTA": 0.72, "RETENCION": 0.28 },
    "confidence": 0.72,
    "confidenceLevel": "MEDIA",
    "basis": {
      "ruleSupport": 0.80,
      "graphConsistency": 1.0,
      "sourceCoverage": 0.50,
      "factConfidence": 0.71,
      "evidenceCoverage": 0.60
    },
    "rationale": [
      "ruleSupport=0.80 (peso 0.35): reglas citadas satisfechas/validadas",
      "evidenceCoverage=0.60 (peso 0.10): …"
    ],
    "missingEvidence": ["evidencia de calificaciones en aula virtual"],
    "humanReview": "RECOMMENDED"
  },
  "explanation": "…"
}
```

Campos obligatorios: auditoría, evidencias, tools ejecutadas, tool results, facts, reglas, inputs, outputs, reglas satisfechas, reglas pendientes, contradicciones, coverage gaps, estado normativo, resolución estimada, probabilidad, base del porcentaje, evidencia faltante y razón.

**Nunca** incluye secretos ni API keys.

Cuando el caso cierra: `normative.status = "DETERMINATE"` con su `resolution`, y `estimate = null`.

---

## 4. Formulario de creación

**Único dato manual obligatorio:** fecha de inicio del ticket.

**Se eliminan:** CaVe manual, nombre manual, matrícula manual, inicio de clases manual.

**Extracción automática de metadata** desde los artefactos: matrícula, nombre, CaVe, fecha de inicio de clases.

- La **matrícula** es el identificador visual principal del caso.
- Si no se detecta: `Matrícula no detectada`. **Nunca** se inventa, nunca se toma del filename sin validación.
- `ticketStartDate` **debe persistirse**; hoy se valida y se descarta.
- Todo hecho extraído conserva fuente, evidencia y confianza.

---

## 5. Ejecución de jobs

Se elimina el loop de 700 ms. El drenaje ocurre en cada visita al workspace:

- **1** procesamiento por job `QUEUED`.
- **0** reprocesamientos de `RUNNING` o `SUCCEEDED`.
- `RETRY_SCHEDULED` respeta su programación (`next_attempt_at`).
- El cliente pide un drenado acotado y el servidor decide claim_atómico. El navegador deja de ser el motor de la cola.

Se aprovechan las primitivas ya existentes: `claim_next_job` (atómico) e idempotencia por `provider_op_id` / fingerprints.

---

## 6. `ai_usage`

| Tipo de evidencia | Comportamiento esperado |
|---|---|
| `image/*` | Registra `ai_usage` (OpenRouter visión). |
| `audio/*` | Registra `ai_usage` (AssemblyAI). |
| `PDF` | Procesado localmente → `ai_usage = 0`. Correcto. |
| `Word` | Procesado localmente → `ai_usage = 0`. Correcto. |

Cada consumo enlaza audit, evidence, job, tool, provider, model, operación, tokens si existen, y coste conocido o `null` si se desconoce.

**Unificar el cliente de OpenRouter:** `handlers.ts::analyzeEvidence` hace `fetch` directo mientras `server/ai/openrouter.ts` maneja errores y parseo. Se consolida en el helper, que es lo que permite aplicar timeout, reintento y registro de forma uniforme.

---

## 7. Esquema de base de datos

### 7.1 Migración correctiva (nueva, no destructiva)

Otorgar los `GRANT` faltantes a `authenticated` en las 4 tablas de la sección 1.4.1. Se aplica primero y de forma independiente.

### 7.2 Persistencia nueva

- `decision_traces`: `audit_id`, `engine_run_id`, `trace` (JSONB), `trace_hash`, `created_at`. Hash y origen para preservar provenance.
- `audit.ticket_start_date`: persiste el único dato manual del formulario.
- Campos de metadata extraída (matrícula, nombre, CaVe, inicio de clases) con su `evidence_id` y confianza. Se respeta el principio de que la ausencia de metadata no se convierte en dato inventado: se distingue `null` de un valor no detectado.

### 7.3 Limpieza

Se hace **después** de verificar el flujo, y tabla por tabla con referencias reales buscadas en todo el repositorio (imports, SQL, scripts, tests, CI). Clasificación: `ACTIVE` / `LEGACY` / `POSSIBLY_UNUSED` / `SAFE_TO_REMOVE` / `DO_NOT_REMOVE`.

**No se borra una tabla solo por tener 0 filas.** Las migraciones ya aplicadas no se eliminan. Si conviene consolidar migraciones para desarrollo desde cero, se documenta aparte, sin romper entornos existentes.

Script de limpieza de datos de desarrollo: diferencia datos reales de prueba. **Prohibido** `TRUNCATE` masivo.

---

## 8. Seguridad

- **Eliminados** el bypass de `LOCAL_DEMO` como ruta de producción, la pantalla de login y el redirect del middleware. Se conservan la sesión técnica, las 47 tablas con RLS y las 107 políticas.
- **Agujeros de autorización a cerrar:** `jobs`, `evidences` y `download` deben exigir propiedad o rol `OWNER`. `/api/jobs/process` requiere rol de worker.
- **Headers de seguridad** en `vercel.json`: CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- **Rate limiting** en la creación de auditorías y en cualquier endpoint expuesto ahora que no hay login.
- **Logging** sin PII, tokens ni secretos. El Decision Trace tampoco los incluye.
- **Errores** sin stack traces en producción.

---

## 9. UI

**Jerarquía en la pantalla de resultado:**

1. **Resolución estimada** como titular grande, con su porcentaje.
2. Aviso de que es probable y el procedimiento aún no cierra.
3. **Falta para confirmar**: lista concreta de evidencia faltante.
4. **Estado normativo** en bloque separado y claramente etiquetado.
5. Reglas, tools utilizadas, evidencias, costes, logs.
6. **🔴 Botón rojo `Descargar Decision Trace JSON`** — texto blanco, buen contraste, visible directamente junto al resultado, sin depender de hover ni de menú.

`INDETERMINADO` se muestra como **estado normativo**, nunca como ausencia de resolución.

Si el trace debería existir pero falló, la UI lo dice claramente y el error queda registrado. Nunca desaparece en silencio.

---

## 10. Pruebas

**Unitarias y de integración:** extracción → hecho verificable disponible para el motor; estimador produce distribución que suma 1; la distribución nunca contradice un `DETERMINATE`; `INDETERMINATE` produce siempre `estimatedResolution`; el trace enumera evidencia faltante específica; los `GRANT` de RLS existen.

**UI:** el botón rojo aparece junto al resultado y descarga JSON válido; con el componente presente pero fallando, muestra el estado de indisponibilidad.

**Jobs:** existe un test que falla si se detecta un loop de `POST /api/jobs/process`.

**Login:** la aplicación abre el dashboard directamente, sin redirección.

**Formulario:** solo exige fecha de inicio del ticket y evidencias.

**Metadata:** matrícula, CaVe y nombre se extraen cuando existen. Test explícito de **no alucinación**: si la matrícula no aparece, el resultado es `No detectada` y jamás un valor inventado.

**E2E (obligatorio, en orden):** abrir app sin login → crear auditoría → fecha de inicio del ticket → subir evidencias → procesar → observar jobs → **demostrar tools ejecutadas** → comprobar facts → ejecutar policy engine → generar resolución estimada → mostrar resultado → descargar Decision Trace → validar JSON → comprobar DB.

Si el entorno impide algún paso: `BLOCKED` con la explicación exacta. **Nunca** un `PASS` inventado.

---

## 11. Reportes de salida

- `docs/reports/tools-audit-remediation-final.md` — informe final con las 15 secciones requeridas.
- `docs/reports/database-cleanup-report.md` — inventario antes/después.
- `docs/reports/tools-runtime-matrix.md` — matriz de ejecución real de tools.

---

## 12. Criterio de aceptación

`PASS` solo si se demuestra **todo** lo siguiente simultáneamente:

tools conectadas · al menos una tool ejecutada con evidencia real · facts llegando al engine · Decision Trace generado · botón rojo visible · descarga JSON funcional · resolución estimada visible · probabilidad visible con su base · evidencia faltante enumerada · estado normativo separado · sin loop de jobs · login eliminado · formulario simplificado · metadata extraíble · DB limpiada de estructuras demostrablemente obsoletas · tests en verde · E2E completo.

Si algo falla: `FINAL STATUS: PARTIAL` o `FAIL`. Los resultados no se maquillan.
