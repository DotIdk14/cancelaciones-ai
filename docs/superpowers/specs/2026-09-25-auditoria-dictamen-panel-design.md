# Diseño: Panel de Dictamen de Auditoría

## Estado

Aprobado por el propietario el 2026-09-25. Alcance de la conversación: 3 pestañas en el
inspector derecho del workspace de auditoría, botón «Volver a iniciar el dictamen con otros
hechos», y limpieza del código muerto que bloquea estas capacidades.

## Objetivo

Dejar el panel derecho del workspace con tres pestañas —`dictamen`, `reglas`, `comentarios`—
y hacer que el bloque de dictamen sea el lugar donde un humano puede (a) revisar los hechos
extraídos, (b) corregir cuáles cuentan, (c) incorporar evidencia nueva y recalcular, y
(d) elegir qué evidencias respaldan el PDF. Todo ello con el flujo durable de jobs ya
existente, sin depender de memoria de proceso y sin tocar la autoridad normativa.

## Alcance

### Dentro

- Reestructurar `InspectorTab` a tres pestañas.
- Migrar la carga de evidencia al botón `+ Agregar` del panel de archivos.
- Botón «Volver a iniciar el dictamen con otros hechos» con re-extracción condicionada por
  `artifactSetFingerprint`.
- Resucitar `EvidenceSelector` y `AuditTimeline`.
- Guard `HUMAN_REVIEW_STALE` en la aprobación del snapshot.
- Validación de forma de `correctedValue` en `POST /fact-reviews`.
- Mover la comparación IA vs humano a su propia ruta.
- Eliminar cinco componentes muertos y extraer `AuditWorkflow`.

### Fuera

- Relajar el índice único `report_snapshots_one_final_per_audit`. Un dictamen aprobado es
  definitivo.
- Persistir la comparación contra una línea base concreta (§11.1).
- Re-ejecutar la IA sobre evidencia ya procesada. La IA corre una vez por evidencia.
- Cualquier cambio en `evaluatePolicy` o en las reglas normativas.

## Invariantes

Se preservan las de `AGENTS.md` y las del spec `2026-09-24-policy-foundation-remediation-design.md`:

- `GDM_GAM_PRD_MLG_003` es la única autoridad normativa.
- Un Fact Run `FROZEN` es irreversible; un Fact Run derivado es un registro nuevo.
- Toda corrección humana crea otro Fact Run con `parentFactRunId` y motivo de derivación.
- Un `AI_DECISION_V1` completado es append-only; la línea base nunca se sobrescribe.
- `Dictamen.pdf` conserva su rol de plantilla canónica.
- `UNKNOWN` no se convierte en `FALSE`.
- `DO_NOT_DUPLICATE_IMPLEMENTATIONS`: una sola implementación por capacidad.
- `NO_PROCESS_LOCAL_DURABILITY`: nada de estado durable en memoria del proceso.
- `DO_NOT_REPROCESS_AI_UNNECESSARILY`: re-extracción solo si cambió el conjunto de artefactos.
- `NO_PII_IN_GIT`: los tests usan auditorías sintéticas.

## Estado actual (diagnóstico)

### Pestañas

`components/AuditWorkspace.tsx:15` declara cinco valores en `InspectorTab`; `:112` los pinta y
`:78` elige `carga` como valor inicial salvo que el estado sea `FROZEN`. `:137-141` monta un
inspector por pestaña.

### El pipeline depende del navegador

`POST /api/jobs/process` es el único worker del sistema. No hay cron en `vercel.json` ni worker
externo: solo lo invoca `AuditWorkflow.waitForJobs` (`AuditWorkflow.tsx:49`), y `AuditWorkflow`
solo se monta dentro de la pestaña `carga` (`AuditWorkspace.tsx:137`). Quitar esa pestaña sin
reemplazo deja la cola sin drenar.

### Los hechos nunca se muestran

`GET /api/audits/[auditId]/fact-runs` (`fact-runs/route.ts:18-27`) devuelve `factRuns`,
`selectedRun` y `facts`. Ningún componente lo consume. `HumanFactReview.tsx` —completo, con
`POST /fact-reviews` y sus dos botones de validación— nunca se importa, y su propio mensaje
(`:23`) instruye usar un botón «Rehacer auditoría» que no existe.

### La evidencia nueva nunca llega a los hechos

Dos cortocircuitos cortan en cuanto existe un run `FROZEN`:

- `handlers.ts:46-50` (`enqueueFactExtractionIfReady`) salta directo a evaluar el run viejo.
- `jobs/route.ts:53-54` (`EXTRACT_FACTS`) responde `{ reused: true }`.

Consecuencia: la evidencia nueva se almacena y se procesa, pero sus hechos nunca llegan al
motor, y el dictamen no cambia.

### Re-extracción ya aplicada a facts humanos

`policy/evaluation.ts:32-43` lee `fact_reviews`, excluye los facts con `decision = 'INVALID'`
y sustituye `corrected_value`. La capacidad de recalcular con otros hechos existe; le falta la
interfaz.

### Aprobación cruza revisiones obsoletas

`approveSnapshot` (`dictamen/service.ts:265-288`) solo exige que exista *alguna* revisión
humana (`:273-278`). `human_reviews` guarda `machineDecision` congelado
(`machineRefFromRun`, `:73-83`), pero nada compara ese `engineRunId` contra el del snapshot.
Tras un recálculo, `buildSnapshot` combinaría máquina nueva con revisión humana vieja y la
aprobación lo aceptaría.

### El PDF nunca referencia evidencias

`EvidenceSelector.tsx` (77 líneas, con validación de pertenencia en servidor vía
`saveEvidenceSelection`, `dictamen/service.ts:501-552`) nunca se montó. `buildSnapshot` toma
`selectedEvidence` de `audit_evidence_selection` (`:202`), que queda vacía. El PDF se emite
sin referencias de evidencia.

### Documentos: se toma el primero

`AuditWorkspace.tsx:85-87` y `DictamenWorkflow.tsx:48-49` usan
`documents.find((doc) => doc.kind === 'FINAL')`, es decir el primer elemento de
`listByAudit` (`db/src/index.ts:1263-1271`, ordenado por `created_at DESC`). Con más de un
snapshot, el botón de descarga del encabezado serviría el PDF viejo.

## Arquitectura

```text
SIDEBAR "+ Agregar"                     PESTAÑA DICTAMEN
  -> EvidenceUploader                     -> Resultado motor
     POST /evidences                        -> HumanReviewCard
     POST /jobs PROCESS_EVIDENCES           -> FactReviewPanel  ◀ NUEVO
     drainQueue()                             POST /jobs EXTRACT_FACTS
                                              drainQueue()
JobAutoResume (siempre montado)                   -> EvidenceSelector ◀ RESUCITADO
  POST /api/jobs/process (un solo worker)        -> DictamenWorkflow
  -> enqueueFactExtractionIfReady                    snapshot -> draft -> approve -> final
     -> selectFactRunForEvaluation
        -> FACT_EXTRACTION (determinista, sin IA)
        -> AUDIT_EVALUATION  (aplica fact_reviews)
        -> REPORT_GENERATION (buildSnapshot)
```

El botón de recálculo entra por la cola, no por HTTP directo. El pipeline de jobs ya está
cableado de punta a punta (`handlers.ts:189`, `:198`, `:201-207`), así que un solo disparo
produce fact run nuevo, engine run nuevo, línea base nueva y snapshot nuevo, todos durables y
trazables, sin orquestación duplicada en el cliente.

### `selectFactRunForEvaluation`

Decide qué Fact Run alimenta la evaluación. Los dos cortocircuitos actuales lo consumen, de
modo que la regla de frescura tiene una sola implementación. La resolución es *declarativa*:
devuelve la decisión y el material necesario, y es el llamador quien crea el run cuando
corresponde.

```ts
type FactRunSelection =
  | { action: 'REUSE_ACTIVE'; run: FactExtractionRun; currentArtifacts: ArtifactSet }
  | { action: 'REUSE_FROZEN'; run: FactExtractionRun; currentArtifacts: ArtifactSet }
  | { action: 'CREATE'; staleFrozen: FactExtractionRun | null; currentArtifacts: ArtifactSet };

type ArtifactSet = Set<`${string}:${string}`>; // `${artifactId}:${contentSha256}`
```

Orden de resolución:

1. `REUSE_ACTIVE` — un run `DRAFT|PROCESSING` cuyo conjunto de artefactos coincide con el
   actual. Evita duplicar extracciones cuando el botón se pulsa dos veces seguidas.
2. `REUSE_FROZEN` — un run `FROZEN` cuyo conjunto de artefactos coincide. Los hechos siguen
   vigentes: no se re-extrae. Es el caso que hoy cumple `DO_NOT_REPROCESS_AI_UNNECESSARILY`.
   Aun así se reencola `AUDIT_EVALUATION`, porque pudo cambiar `fact_reviews` sin que cambiara
   la evidencia.
3. `CREATE` — no hay run vigente. Se crea uno nuevo; `staleFrozen` referencia el anterior para
   trazabilidad.

Un run en `DRAFT|PROCESSING` cuyo conjunto de artefactos **no** coincide se trata como `CREATE`:
está obsoleto y no debe reutilizarse.

### Comparación del conjunto de artefactos

`artifactSetFingerprint` (`db/src/index.ts:720-723`) devuelve `stableFingerprint` del arreglo
`{id, type, sha256, evidenceId}` de los artifacts de línea base, y `stableFingerprint`
(`domain/src/index.ts:193-207`) es `JSON.stringify` con claves ordenadas recursivamente — un
string canónico, no un hash.

Dos cautelas:

- **El orden del arreglo no es un orden total.** `listArtifactsByAudit` (`db/src/index.ts:603-613`)
  ordena por `created_at DESC`, y dos artifacts pueden compartir timestamp. Por eso la
  comparación es **entre conjuntos** (`ArtifactSet`), no entre strings: se parsea el fingerprint
  almacenado y se indexan las entradas por artifact. Es además retrocompatible: la columna
  `artifact_set_fingerprint` no se modifica y las filas existentes siguen comparando bien.
- **Filas no parseables** (formato de una versión anterior) se tratan como `CREATE`: es la
  dirección fail-safe. Si el `INSERT` choca con
  `fact_extraction_runs_idempotency_hash_idx`
  (`migrations/20260924170450:32-38`, único sobre `audit_id, policy_code_hash,
  policy_version, extractor_version, artifact_set_fingerprint_hash`), releer y reutilizar el run
  existente en vez de fallar.

### Fingerprint de entrada de la evaluación

`enqueue_job` resuelve conflictos con `ON CONFLICT (operation_scope, idempotency_key) DO UPDATE
SET updated_at = jobs.updated_at` (`migrations/20260921225156:126-127`): **no reactiva el job**.
Es idempotencia por clave, no por estado.

La clave de `AUDIT_EVALUATION` es hoy
`evaluation:{auditId}:{factRunId}:{policyCode}:{policyVersion}` (`handlers.ts:60`), que no
incluye el estado de `fact_reviews`. Sin cambios, el botón sería un **no-op silencioso** en su
caso principal: recalcular por revisión humana sin evidencia nueva, donde la fact run es la
misma y por lo tanto la clave también.

La clave pasa a incluir un fingerprint de la entrada efectiva:

```
evaluation:{auditId}:{factRunId}:{evaluationInputFingerprint}

evaluationInputFingerprint = sha256(stableFingerprint({
  artifacts: <ArtifactSet ordenado>,
  reviews:  <ArtifactSet de revisiones>,   // `${factId}:${decision}:${correctedValueHash}`
}))
```

Es el mismo principio que ya usa `runPolicyEngineForAudit`, que deduplica por
`facts_fingerprint` en vez de por identidad de corrida (`policy/evaluation.ts:50-52`).
Consecuencias deseadas:

- Cambió una revisión o cambió la evidencia → clave nueva → el job corre.
- El botón se pulsa dos veces sin cambios → clave idéntica → no-op. Idempotencia correcta.
- `operationScope` se mantiene estable (`audit:{auditId}:evaluation:{factRunId}`) porque
  `GET /jobs` agrupa por scope y así la vista muestra siempre la evaluación más reciente.

### Aislamiento de línea base

`listBaselineArtifactsByAudit` (`db/src/index.ts:621-626`) incluye solo artifacts de evidencias
con `documentRole === 'EVIDENCE'`. El dictamen humano y las evidencias de adjudicación quedan
fuera del conjunto, así que subirlos no marca el run como obsoleto. Se mantiene.

## Migraciones

### 1. Derivar un Fact Run

El spec del 2026-09-24 declara «Toda corrección humana crea otro Fact Run con
`parentFactRunId` y motivo de derivación» como invariante, pero el esquema no lo implementa: ni
`fact_extraction_runs` ni el tipo `FactExtractionRun` (`db/src/index.ts:108-130`) tienen esos
campos. Este diseño crea runs derivados, así que cierra la brecha.

```sql
ALTER TABLE public.fact_extraction_runs
  ADD COLUMN IF NOT EXISTS parent_fact_run_id uuid
    REFERENCES public.fact_extraction_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS derivation_reason text;
```

`createRun` acepta `parentFactRunId` y `derivationReason` opcionales. Motivos previstos:
`EVIDENCE_SET_CHANGED` (cambió `artifactSetFingerprint`) y `HUMAN_FACT_REVIEW` (cambió
`fact_reviews`). Los runs previos al despliegue quedan con ambos campos en `NULL`; no se
backfillean porque no es posible reconstruir la derivación real.

## Componentes

### `JobAutoResume` (nuevo)

Se monta siempre en `AuditWorkspace` y en la vista de comparación. `return null`.

Responsabilidad única: si la cola tiene jobs `QUEUED|RUNNING|RETRY_SCHEDULED`, drenarla con
`POST /api/jobs/process` y dejar que el pipeline continúe solo.

Cambios respecto a `AuditWorkflow.tsx:124-145`: se eliminan los `waitVisible()` —delays de UI
sin sentido en un componente invisible— y los errores se reportan hacia arriba por callback en
lugar de pintarse en un panel, para que `AuditWorkspace` los muestre en la pestaña `dictamen`
como alerta. Nunca renderiza, nunca llama `alert`. No monta nada en `demoMode`.

### `EvidenceUploader` (nuevo)

Botón `+ Agregar` del panel de archivos (`AuditWorkspace.tsx:118`) más un `<input type="file"
multiple>` oculto y una franja de estado compacta. Extrae `run()` de `AuditWorkflow.tsx:147-180`.

Flujo: `POST /evidences` → `POST /jobs action=PROCESS_EVIDENCES` → `drainQueue()`. **No** toca
el dictamen: la evidencia queda almacenada y transcrita, y el mensaje final dice que los hechos
siguen congelados hasta que se use «Volver a iniciar el dictamen con otros hechos».

Reemplaza a `setTab('carga')`, que desaparece junto con la pestaña.

### `drainQueue` (nuevo, compartido)

`apps/web/src/lib/job-queue.ts`. Extrae `refreshQueue` + `waitForJobs`
(`AuditWorkflow.tsx:34-57`) para que `JobAutoResume`, `EvidenceUploader` y `FactReviewPanel` no
tripliquen el bucle. Firma:

```ts
drainQueue(auditId: string, opts?: { onTick?: () => void; maxAttempts?: number }):
  Promise<{ ok: true } | { ok: false; message: string }>
```

Devuelve error en vez de lanzar, para que cada consumidor lo presente según su contexto. El tope
de 60 intentos y la detención ante un job `FAILED` se conservan.

### `FactReviewPanel` (nuevo)

En la pestaña `dictamen`, entre `HumanReviewCard` y `DictamenWorkflow`.

Lista los facts del run vigente desde `GET /fact-runs`: `factType`, `value`, `confidence` y
`sourceRef`, para que el humano pueda juzgar el respaldo. Por fact: estado de revisión
(`VÁLIDO` / `NO RESPALDADO` / sin revisar) y edición inline del valor, que se envía como
`correctedValue` — capacidad que `HumanFactReview` no usaba.

El botón pide `confirm()` con el resumen de cuántos hechos se excluyen y cuántos se corrigen, y
luego hace **una sola llamada**:

1. `POST /api/audits/[auditId]/jobs` con `action=EXTRACT_FACTS`.
2. `drainQueue(auditId)`.
3. `router.refresh()`.

`EXTRACT_FACTS` cambia de semántica: pasa de «extrae hechos» a **«asegura que el motor haya
evaluado el conjunto de hechos vigente»**. La ruta resuelve el run con el helper y:

- si el run necesita extracción → encola `FACT_EXTRACTION`, cuyo handler encadena
  `AUDIT_EVALUATION` y `REPORT_GENERATION`;
- si el run ya está `FROZEN` y vigente → encola `AUDIT_EVALUATION` directamente, con el
  fingerprint de entrada (§ «Fingerprint de entrada de la evaluación») para que la clave no
  colisione con la evaluación anterior.

Con eso los hechos nuevos, el motor, la línea base y el snapshot los produce el pipeline, sin
orquestación duplicada en el cliente. Las revisiones de `fact_reviews` las aplica
`runPolicyEngineForAudit` en el momento de evaluar, sin pasos extra. El motor toma la revisión
**más reciente por `fact_id`** (`policy/evaluation.ts:34-35`), así que revisar de nuevo
supersede sin borrar el histórico.

No hace falta una acción `REEXTRACT_FACTS` separada: el fingerprint de entrada ya distingue
«cambió la evidencia» de «cambiaron las revisiones».

Si `snapshot.status === 'FINAL'`, el botón está deshabilitado con el aviso «El dictamen ya fue
aprobado. El re-dictamen no está disponible.» — el índice único
`report_snapshots_one_final_per_audit` (`migrations/20260924110000:157`) impide un segundo
FINAL, y este diseño no lo relaja.

Cuando el botón no produce cambios (se pulsó dos veces sin nada nuevo), la respuesta es un
`200` con `changed: false` y la UI lo dice en vez de fingir que recalculó.

### `EvidenceSelector` (resucitado)

Se reutiliza el archivo tal cual. Se monta en la pestaña `dictamen` dentro de un `<details>`
«Evidencias que respaldan el dictamen (N)».

El componente espera `selection?: string[]` —identificadores de evidencia—, no registros, así
que `page.tsx` proyecta `audit_evidence_selection` a `evidenceId[]` y reutiliza el tipo
`EvidenceSelectionRecord` que ya existe en `components/types.ts:92-100`. `page.tsx` añade la
consulta a su `Promise.all` actual, junto a las once que ya hace.

### Guard `HUMAN_REVIEW_STALE`

En `approveSnapshot` (`dictamen/service.ts:260-288`), después de la comprobación de existencia:

```ts
const reviewRunId = (review.machineDecision as { engineRunId?: string } | null)?.engineRunId;
if (!reviewRunId || reviewRunId !== snapshot.engineRunId) throw codeError(
  'HUMAN_REVIEW_STALE',
  'La revision humana corresponde a otra corrida del motor. Vuelve a registrar la revision.',
);
```

La ruta devuelve `409` con ese código. `DictamenWorkflow` deshabilita «3 · Aprobar snapshot» y
explica que hay que registrar de nuevo la revisión.

### Validación de `correctedValue`

`POST /fact-reviews` acepta hoy `correctedValue?: unknown` y lo inserta directo en `jsonb`
(`fact-reviews/route.ts:29`, `:34-39`). Como el motor lo inyecta en `fact.value`
(`policy/evaluation.ts:41-42`), una carga arbitraria envenena la entrada normativa.

Regla de forma, contra el `value` original del fact:

| `value` original | `correctedValue` admitido |
|---|---|
| `string`, `number`, `boolean`, `null` | Solo el mismo tipo primitivo |
| `object` plano | Mismo conjunto de claves, sin añadir ni quitar; valores validados recursivamente |
| `array` | `array`, de cualquier longitud (el humano aporta el reemplazo completo) |

Cualquier otra combinación → `400 INVALID_CORRECTED_VALUE`, con mensaje que nombra el
`factType` y nunca el valor. Se valida en el servidor; el cliente solo deshabilita el botón de
guardar cuando detecta una forma incompatible.

### Documentos: el más reciente, no el primero

`AuditWorkspace.tsx:85-87` y `DictamenWorkflow.tsx:48-49` pasan a ordenar por `generatedAt`
descendente. `DictamenWorkflow` lista todos los documentos del audit, no solo el primer
borrador y el primer final, rotulados con `snapshotId` abreviado para que un re-dictamen sea
legible.

### Vista de comparación

`components/ComparisonInspector.tsx` extraído de `AuditWorkspace.tsx:186-217`, más
`StatusPill` y `postJson`, en `app/(private)/auditorias/[auditId]/comparacion/page.tsx`. El
timeline inline se reemplaza por `AuditTimeline`, que existe y está muerto. Botón
«Comparación IA vs humano» en el encabezado del workspace. La vista monta `JobAutoResume` y
repite las consultas que `page.tsx` deja de necesitar para el workspace: `auditRuns`,
`humanDecisionExtract`, `comparison`, `adjudication` y `timelineEvents`.

## Archivos afectados

### Crear

| Archivo | Rol |
|---|---|
| `server/facts/run-selection.ts` | `selectFactRunForEvaluation`, única implementación de frescura |
| `server/facts/run-selection.test.ts` | Casos 1-3 y conflicto de índice |
| `lib/job-queue.ts` | `drainQueue` compartido |
| `components/JobAutoResume.tsx` | Auto-resume invisible |
| `components/EvidenceUploader.tsx` | Botón `+ Agregar` |
| `components/FactReviewPanel.tsx` | Facts, revisiones y botón de recálculo |
| `components/ComparisonInspector.tsx` | Extraído de `AuditWorkspace` |
| `app/(private)/auditorias/[auditId]/comparacion/page.tsx` | Vista de comparación |
| `migrations/20260925120000_fact-run-derivation.sql` | `parent_fact_run_id`, `derivation_reason` |

### Modificar

| Archivo | Cambio |
|---|---|
| `components/AuditWorkspace.tsx` | Tres pestañas; `+ Agregar` monta `EvidenceUploader`; monta `JobAutoResume`, `FactReviewPanel` y `EvidenceSelector`; documents por `generatedAt` |
| `components/DictamenWorkflow.tsx` | Guard `HUMAN_REVIEW_STALE`; lista todos los documentos |
| `app/(private)/auditorias/[auditId]/page.tsx` | Suma `audit_evidence_selection` proyectada a `evidenceId[]`; deja de pasar cinco props |
| `app/api/audits/[auditId]/jobs/route.ts` | Usa `selectFactRunForEvaluation`; `EXTRACT_FACTS`.ensure-current; encola `AUDIT_EVALUATION` al reutilizar un run frozen |
| `server/jobs/handlers.ts` | `enqueueFactExtractionIfReady` usa el helper; `enqueueAuditEvaluation` incluye `evaluationInputFingerprint` en la clave |
| `server/dictamen/service.ts` | `HUMAN_REVIEW_STALE` |
| `app/api/audits/[auditId]/fact-reviews/route.ts` | Validación de forma de `correctedValue` |
| `packages/db/src/index.ts` | `parentFactRunId` y `derivationReason` en tipo y `createRun` |
| `components/types.ts` | `FactRow` y `FactReviewRow` |

### Borrar

| Archivo | Motivo |
|---|---|
| `AuditWorkflow.tsx` | Lógica absorbida por `JobAutoResume` + `EvidenceUploader` |
| `HumanFactReview.tsx` | Absorbido por `FactReviewPanel` (además enviaba `correctedValue` vacío) |
| `PolicyEvaluationPanel.tsx` | Duplica `DictamenInspector` |
| `MachineDecisionCard.tsx` | Duplica el bloque de resultado |
| `ReportPreviewCard.tsx` | Duplica `DictamenWorkflow` |
| `MissingItemsPanel.tsx` | Duplica el aviso de `RulesInspector` |

## Seguridad

- No se agregan rutas ni se relajan políticas RLS. `POST /jobs` y `POST /fact-reviews` conservan
  su `authorized()` con `audit.createdBy !== user.id → 403`.
- El `confirm()` del botón de recálculo es defensa en profundidad, no control de autorización:
  la autorización real es el 403 del servidor.
- `correctedValue` se valida por forma antes de persistir. Sin eso, un usuario con acceso a su
  propia auditoría puede inyectar estructura arbitraria en la entrada del motor normativo.
- Los errores de `JobAutoResume` se registran con `console.warn` sin volcar facts, valores ni
  PII. `message` en el panel es texto de la API, ya sanitizado.
- `NO_PII_IN_GIT`: los tests de `drainQueue` y `selectFactRunForEvaluation` usan auditorías
  sintéticas.

## Accesibilidad

- Las pestañas pasan a un `role="tablist"` con `role="tab"` / `role="tabpanel"` y
  `aria-selected`, navegables con flechas. Hoy son `<button>` sueltos sin semántica de tab.
- `aria-live="polite"` en la franja de estado de `EvidenceUploader` y en los mensajes de
  `FactReviewPanel`, para que el cambio de estado de una carga larga se anuncie.
- El `<details>` de `EvidenceSelector` mantiene semántica nativa de disclosure.
- Cada botón de validación de fact lleva `aria-label` con el `factType`; el color no es el único
  indicador de estado.
- El botón deshabilitado por dictamen aprobado lleva texto explicativo, no solo `disabled`, y el
  aviso es texto associated en lugar de solo `title`.

## Pruebas

### `selectFactRunForEvaluation`

| Caso | Setup | Esperado |
|---|---|---|
| Run activo vigente | `DRAFT` con fingerprint igual | `REUSE_ACTIVE` |
| Run frozen vigente | `FROZEN` con fingerprint igual | `REUSE_FROZEN` |
| Fingerprint obsoleto | `FROZEN` con fingerprint distinto | `CREATE` + `staleFrozen` |
| Sin runs | — | `CREATE`, `staleFrozen = null` |
| Orden distinto | Mismo conjunto, otro orden | `REUSE_FROZEN` |
| Fingerprint no parseable | String inválido | `CREATE` |
| Conflicto de índice | `INSERT` devuelve 23505 | Reutiliza el run existente |

### Fingerprint de entrada de la evaluación

| Caso | Setup | Esperado |
|---|---|---|
| Revisión nueva | Mismo fact run, cambia `fact_reviews` | Clave de `AUDIT_EVALUATION` distinta → el job se encola y corre |
| Evidencia nueva | Fingerprint de artefactos distinto | Clave distinta → el job se encola y corre |
| Sin cambios | Segunda pulsación sin modificar nada | Clave idéntica → no-op, `changed: false` |
| `operationScope` estable | Cualquier caso | `audit:{id}:evaluation:{factRunId}` sin cambios |

### Servicio y rutas

- `approveSnapshot` con revisión de otro `engineRunId` → `HUMAN_REVIEW_STALE`.
- `POST /fact-reviews` con `correctedValue` de forma distinta → `400 INVALID_CORRECTED_VALUE`.
- `POST /fact-reviews` con `correctedValue` de la forma correcta → `201`.
- `POST /jobs action=EXTRACT_FACTS` sobre un audit con run `FROZEN` vigente **encola un job**
  (hoy devuelve `{job: null, reused: true}` y no encola nada).

### Componentes

- `FactReviewPanel` renderiza facts, marca `INVALID`, envía `correctedValue`, botón deshabilitado
  con `snapshot.status === 'FINAL'`.
- `EvidenceUploader` sube, encola y drena; muestra la franja de estado.
- `JobAutoResume` con un job `QUEUED` real lo procesa (base: `audit-queue.e2e.test.ts`).

### Regresión

- Con dos snapshots, el botón de descarga del encabezado sirve el PDF más reciente.
- Con evidencia nueva, el botón de recálculo produce un fact run nuevo y un `engine_run` nuevo,
  y el `AI_BASELINE` anterior sigue intacto.
- Demo local: `FactReviewPanel` degrada a estado vacío sin romper.

## Orden de implementación

El trabajo se ordena en tres tandas porque cada una deja el sistema en un estado coherente y
verificable. No se empieza a reescribir la UI antes de que el backend sepa re-evaluar.

**Tanda 1 — Backend de re-evaluación.** Migración de derivación; `selectFactRunForEvaluation`
con su suite; `evaluationInputFingerprint` y clave de `AUDIT_EVALUATION`; `EXTRACT_FACTS` con
semántica *ensure-current*; `enqueueFactExtractionIfReady` usando el helper. Sin esto el botón
no tiene efecto real.

**Tanda 2 — Guards.** `HUMAN_REVIEW_STALE` en `approveSnapshot` y su reflejo en
`DictamenWorkflow`; validación de forma de `correctedValue`. Endurecimiento independiente de la
UI, verificable por pruebas de servicio.

**Tanda 3 — Frontend.** `drainQueue`; `JobAutoResume`; `EvidenceUploader`; `FactReviewPanel`;
tres pestañas; `EvidenceSelector` y `AuditTimeline` resucitados; vista de comparación;
documentos por `generatedAt`; borrado de los seis archivos muertos.

Las tres tandas pasan `pnpm test` y `pnpm --filter @cancelaciones/web build`. La 1 y la 2 se
pueden revisar y revertir sin tocar la interfaz.

## Riesgos asumidos

### 11.1 La comparación puede quedar ambigua

`runComparison` lee la `AI_BASELINE` más reciente. Si hay un recálculo después de comparar, la
comparación existente queda apuntando a otra base sin que nada lo señale. **No se corrige en
este cambio**; queda documentado como deuda. La corrección sería fijar el `engineRunId` en la
comparación al crearla.

### 11.2 El worker sigue siendo el navegador

Si el usuario cierra la pestaña con jobs en cola, el pipeline se detiene hasta que vuelva a
abrir. Es el diseño actual (`NO_PROCESS_LOCAL_DURABILITY` se cumple en el sentido de que el
estado es durable; el trabajo solo se ejecuta con una sesión abierta). No se cambia.

### 11.3 Snapshots DRAFT huérfanos

Cada recálculo deja un snapshot anterior sin aprobar. `findLatestByAudit`
(`db/src/index.ts:1174-1183`) toma el más reciente, así que no rompen el flujo y quedan
trazables. `DictamenWorkflow` los lista.

### 11.4 Divergencia de invariante ya existente

`policy/evaluation.ts:37-43` aplica `fact_reviews` sobre el run congelado original, mientras el
spec del 2026-09-24 dice «las revisiones humanas no cambiarán el conjunto efectivo del run
original». Es comportamiento preexistente, no introducido aquí. La migración de derivación deja
la puerta abierta a corregirlo en una fase posterior; este diseño no lo cambia para no alterar
el comportamiento del motor.

### 11.5 Demo local sin facts

`local-demo.ts` no tiene facts ni `fact_reviews`. `FactReviewPanel` debe degradar a estado
vacío con mensaje, no romper.
