# Cancelaciones AI

Sistema **AI-native** para analizar expedientes de cancelación, baja y deserción
de estudiantes (UTEL). El usuario crea un caso, sube las evidencias del
expediente (imágenes, PDF, audio, texto) y el sistema emite un **dictamen
sostenido en evidencia y trazado a la sección del procedimiento oficial**.

---

## Qué es el producto

Un dictamen no lo produce una tabla de reglas: lo produce un modelo de lenguaje
que **lee el procedimiento oficial completo**, examina **todas** las evidencias
en conjunto y responde con un assessment estructurado y validado.

El procedimiento `GDM_GAM_PRD_MLG_003` (Procedimiento Deserción de Estudiantes,
versión 5) es la **única fuente normativa**. Se indexa en `policy/` (26 secciones,
SHA-256 registrado en el manifest) y se inyecta íntegro en el contexto del modelo
en cada auditoría.

---

## Arquitectura AI-native

### Qué decide la IA

- Extrae hechos del expediente y los enlaza con las evidencias que los acreditan.
- Detecta contradicciones entre evidencias.
- Reconstruye la cronología.
- Aplica el Procedimiento V5 y emite uno de los siete resultados permitidos.
- Cita, en cada conclusión, **la evidencia y la sección del procedimiento** que la sostienen.

### Qué hace el código (y qué NO)

El código **no dictamina**. Solo:

| Responsabilidad | Dónde |
|---|---|
| Acceso a InsForge desde el servidor | `src/server/insforge.ts` |
| Almacenamiento de binarios (InsForge Storage) | `api/cases/[caseId]/evidence/`, `api/evidence/[evidenceId]/download.ts` |
| Preparación técnica de la evidencia (MIME, hash, PDF→texto, imagen→data URI) | `src/server/evidence-prep.ts`, `src/server/pdf.ts` |
| Transcripción de audio (AssemblyAI, con diarización) | `src/server/assemblyai.ts` |
| Transporte de IA (OpenRouter) y cascada de intentos | `src/server/openrouter.ts` |
| Orquestación durable del run (fila `RUNNING` antes de llamar al modelo) | `src/server/audit-service.ts` |
| Validación de la salida con Zod | `src/skills/audit/schema.ts` |
| Persistencia de datos y binarios | `src/server/cases.ts`, `migrations/` |
| UI | `src/components/`, `src/App.tsx` |

**No existe** policy engine, rules engine, facts engine, fact run, engine run,
catálogo ejecutable de reglas, cola de jobs ni evaluación de reglas en SQL. La
base de datos **guarda** datos y archivos; **no decide** negocio.

### Flujo productivo

```text
evidencias
  -> preparación de evidencia (texto / imagen / PDF / transcripción)
  -> Audit Skill con Procedimiento V5 inyectado íntegro
  -> assessment estructurado validado por Zod + validación de referencias
  -> metadata técnica agregada por servidor desde OpenRouter real
  -> resultado terminal (COMPLETED | ERROR)
```

No hay tools agentic en runtime: el procedimiento completo ya se inyecta en el
prompt de sistema y la aplicación valida que las referencias a evidencias existan
en el expediente. En el código, ese flujo es:

```ts
const { result } = await auditSkill.executeWithMetadata({ caseId, studentIdentifier, evidences });
```

`src/skills/audit/execute.ts` arma el prompt de sistema (instrucciones +
Procedimiento V5 íntegro), arma el expediente como partes de contenido de
OpenRouter, llama al modelo y **valida la respuesta con Zod**. El backend no
reclasifica después; sólo agrega `model` y `usage` reales de OpenRouter y
rechaza referencias inventadas a evidencias.

---

## Stack

- **Frontend:** React 19 + Vite 6 + TypeScript 5.8 + Tailwind 3. SPA con
  *hash routing* (`#/`, `#/casos/:id`), sin react-router.
- **Backend:** Vercel Functions en `api/**` (Node, TypeScript compilado por el
  runtime de Vercel), helpers compartidos en `src/server/**`.
- **Base de datos + auth + storage:** InsForge (PostgreSQL + S3). **Solo
  server-side**: el navegador nunca habla con InsForge.
- **IA:** OpenRouter (único proveedor).
- **Transcripción:** AssemblyAI (solo audio; sin webhooks, refresco bajo demanda).
- **Validación:** Zod.
- **PDF:** `pdfjs-dist` (build legacy, server-side) para extraer texto.
- **Tests:** Vitest.

---

## Estructura del repositorio

```text
api/                       Vercel Functions — **12 archivos, el tope del plan Hobby**.
                           Families consolidadas en segmentos dinámicos:
  auth/[action].ts         session | refresh | google | google-callback
  dashboard/[view].ts      summary | ai-costs | quality | options
  cases/                   index.ts, [caseId]/index.ts,
                           [caseId]/evidence/, [caseId]/evidence/[evidenceId]/,
                           [caseId]/audit/, [caseId]/review/, [caseId]/comparison/,
                           [caseId]/area-comments/
  evidence/                [evidenceId]/download.ts
  health/                  ai.ts

src/
  skills/                  ÚNICA fuente de inteligencia
    sanitize.ts            cercado de contenido no confiable (anti prompt-injection)
    audit/
      types.ts             vocabulario cerrado: resultados, estados, errores
      schema.ts            AiAuditAssessmentSchema + AuditResultSchema (Zod strict)
      procedure-v5.ts      tipos/metadatos de la política
      policy-v5.generated.ts  ARCHIVO GENERADO desde policy/ (npm run policy:generate)
      instructions.ts      system prompt + bloque anti prompt-injection
      execute.ts           ensamblado del expediente y llamada al modelo
    review/                skill de revisión humana (reusa skills/sanitize.ts)
  server/                  env, insforge, http, errors, auth, quotas, derived,
                           cases, dto, audit-service, comparison-service,
                           reviews, area-comments, dashboard-queries,
                           dashboard (agregaciones), dashboard-filters,
                           openrouter, assemblyai,
                           evidence-prep, pdf
    ai/                    model-capabilities, provider-schema (contrato con el modelo)
  components/              LoginScreen, AppHeader, AppNav, CaseListPage,
                           CaseDetailPage, CasesPanel, NewCasePanel,
                           CaseReviewPanel (etapa Asesor y comparación),
                           CoordinatorReviewStage (etapa Coordinador),
                           useCaseAuditWorkflow (ejecución y polling de auditoría),
                           EvidenceUploader, EvidenceList,
                           EvidencePane, PdfCanvas, AuditResultPanel, AreaComments,
                           ErrorBoundary, ui,
                           dashboard/ (OverviewPage, QualityPage, AiCostsPage,
                           DashboardFilters, RecentCasesTable, charts/)
  lib/                     api.ts (cliente fetch), useHashRoute, usePolling,
                           useSession, useDashboard, dashboard, labels, format, cx
policy/                    Procedimiento GDM_GAM_PRD_MLG_003 v5 (FUENTE NORMATIVA)
  manifest.json            26 secciones + SHA-256 del PDF fuente
  sections/*.md            secciones indexadas (26)
migrations/                baseline + 16 migraciones incrementales (orden por nombre).
                           Cada una trae sus comprobaciones en
                           scripts/migration-checks/<archivo>.checks.json
scripts/                   generate-policy.mjs, dev-api.mjs,
                           check-no-public-secrets.mjs, run-ai-smoke.mjs,
                           verify-rls-grants.sql
tests/                     Vitest (67 archivos, 999 tests registrados)
docs/                      documentación del proyecto
.github/                   CI (verify:release), Dependabot, plantillas de issue/PR
vercel.json                framework vite, output dist, install npm ci
```

> **El PDF fuente del procedimiento no está en el repo.** Las secciones `.md` de
> `policy/` sí están versionadas, pero el `.docx.pdf` del que se extrajeron no
> (`normative/` está en `.gitignore`). Su SHA-256 queda registrado en
> `policy/manifest.json` como referencia normativa: eso permite **verificar** que
> el procedimiento no cambió, no **reconstruirlo**. Para regenerar
> `policy-v5.generated.ts` desde el documento oficial hay que pedirle el PDF al
> owner y comprobar el hash contra el manifest.

---

## Resultados permitidos

`audit.result` solo puede ser uno de estos siete valores:

| Resultado | Significado |
|---|---|
| `CANCELACION_VENTA` | La venta se cancela conforme a la sección aplicable del procedimiento, en fase de venta/validación. |
| `CANCELACION_VENTA_PETICION_CLIENTE` | La evidencia acredita una solicitud del cliente y la ruta aplicable del Procedimiento V5 determina cancelación de venta. |
| `BAJA` | El estudiante solicita o incurre en baja (deserción ya iniciada la relación académica). |
| `CANCELACION_VENTA_OPERATIVA` | Aplica algún supuesto de cancelación operativa (errores de áreas, canalización, seguimiento, validación de paquete, back office). |
| `CANCELACION_MATRICULA` | Aplica el supuesto de cancelación de matrícula del procedimiento. |
| `DICTAMINACION` | El expediente requiere dictaminación (caso de revisión especial o ambigüedad normativa definida en el procedimiento). |
| `EVIDENCIA_INSUFICIENTE` | Con las evidencias disponibles **no** es posible acreditar de forma confiable el supuesto aplicable. |

`EVIDENCIA_INSUFICIENTE` es un **dictamen válido**, no un error. Los fallos
técnicos se reportan por separado, en `audits.status` y `audits.error_category`.

### Validación de la salida

La respuesta del modelo **siempre** se valida con Zod contra
`AiAuditAssessmentSchema` (`src/skills/audit/schema.ts`), que es `strict()` y no
incluye metadata técnica. Si la validación falla, el intento se reintenta según
la cascada de OpenRouter; si todos fallan, el run termina con
`INVALID_AI_RESPONSE`; **nunca** se fabrica ni se "aproxima" un dictamen.

El `AuditResult` persistido agrega después, en servidor, `model` y `usage` reales
de OpenRouter. Si el modelo intenta emitir esos campos, se ignoran para que no
pueda inventar proveedor, tokens ni coste.

Shape del resultado (`audits.result_json`):

```ts
{
  case: { matricula, studentName, program, cycle },
  // `case.cycleStartDate` existe en el `result_json` pero NO lo emite el modelo:
  // el servidor lo deriva de `temporalAnalysis.cycleStartDate` (ver abajo).
  evidenceSummary: [{ evidenceId, filename, detectedType, description, relevant }],
  facts: [{ key, label, value, confidence, evidenceIds, evidenceText }],
  timeline: [{ date, event, evidenceIds }],
  conflicts: [{ description, evidenceIds }],
  temporalAnalysis: {          // comparación solicitud vs. INICIO DE CICLO
    cycleStartDate,            // ISO YYYY-MM-DD, o null si no está acreditada
    cycleStartEvidenceIds,     // evidencias que acreditan el inicio académico
    cycleStartEvidenceText,    // cita que la identifica como inicio académico
    cancellationRequestDate,   // fecha en que dijo que no quería continuar
    cancellationRequestEvidenceIds,
    relationToCycleStart,      // ANTES_DEL_INICIO | MISMO_DIA_DEL_INICIO
                               // | DESPUES_DEL_INICIO | NO_DETERMINABLE
    reasoning,
  },
  audit: {
    result,                  // uno de los siete resultados
    rule,                    // criterio aplicado; string no vacío
    procedureSection,        // sección del Procedimiento V5 citada
    reasoning,               // justificación con documento, versión, sección y página
    auditPath,               // hypothesis, procedureSections, reasoning
    provisionalResolution,   // obligatoria y trazable solo si result=EVIDENCIA_INSUFICIENTE
    confidence,              // 0..1
    supportingEvidenceIds,
    missingEvidence,         // evidencia faltante accionable
    procedureChecks,         // criterio, estado, observados y evidencia
    observations
  },
  model: { provider: 'openrouter', model },
  usage: {                   // null cuando el proveedor no la reporta
    promptTokens, completionTokens, totalTokens, estimatedCostUSD
  }
}
```

Sobre `usage`: se lee lo que OpenRouter devuelve realmente
(`usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens`,
`usage.cost`). Cuando un valor no viene, se escribe `null`. **Nunca** se inventa
una métrica ni se calcula un coste estimado.

### La fecha de inicio de ciclo (`temporalAnalysis`)

La sección 5.3 del procedimiento se define en función de la **fecha de inicio de
ciclo**, no de ninguna fecha administrativa. Por eso esa fecha viaja en un bloque
propio y trazable en lugar de ser un string suelto dentro de `case`.

- El modelo la determina **por significado semántico**, buscando en todas las
  evidencias sin importar su sistema o formato. Una fecha de creación de
  matrícula, inscripción, decisión D35/D53, CAVE, ticket, facturación o contacto
  **no** es una fecha de inicio de ciclo, aunque sea la única fecha visible.
- Si ninguna evidencia acredita el inicio académico, `cycleStartDate` es `null`
  y `relationToCycleStart` es `NO_DETERMINABLE`. **Nunca** se deduce de otra
  fecha del expediente.
- `relationToCycleStart` compara **solo** `cancellationRequestDate` contra
  `cycleStartDate`, y es obligatorio resolverla antes de aplicar la sección 5.3.
- El backend **no reclasifica**: no calcula la relación ni decide la fecha. Solo
  rechaza assessments internamente incoherentes, entre ellas:
  - una `cycleStartDate` sin `cycleStartEvidenceIds` ni cita textual;
  - una relación distinta de `NO_DETERMINABLE` sin **ambas** fechas acreditadas
    (afirmar `DESPUES_DEL_INICIO` sin inicio acreditado es exactamente el
    razonamiento que convertía una cancelación de venta en baja);
  - confianza `1` en una fecha de inicio crítica o con cronología
    `NO_DETERMINABLE`.
- `case.cycleStartDate` es **derivada, no afirmada**: el modelo no la emite y el
  servidor la copia de `temporalAnalysis.cycleStartDate` (`deriveCaseCycleStartDate`)
  antes de persistir. Antes se exigía que las dos copias coincidieran, comprobación
  que solo podía evaluarse después de la respuesta y cuyo fallo tumbaba el dictamen
  entero por un campo que nadie leía. El `case` del contrato del modelo es
  `.strict()`: si el modelo vuelve a emitir la clave, se rechaza de forma visible.
- Una fecha de inicio afirmada exige además su fact `cycle_start_date` con
  evidencia, cita y confianza menor que 1, para que la trazabilidad sea visible
  en la UI.
- Los conflictos entre dos fechas de inicio se registran en `conflicts`; no se
  elige una en silencio. Una fecha administrativa distinta **no** es un conflicto:
  son conceptos diferentes.

Regresión: `tests/cycle-start-date.test.ts` (los cinco escenarios) y el caso real
sintético en `tests/ai-smoke.live.test.ts` (`npm run test:ai-smoke`).

### OpenRouter: capacidades, schema y fallback

- `AiAuditAssessmentSchema` en Zod es el contrato de negocio final. Toda
  respuesta se valida con Zod y sus referencias se cotejan contra las evidencias
  de entrada; el schema del proveedor nunca reemplaza esa validación.
- `src/server/ai/model-capabilities.ts` consulta el catálogo público de
  OpenRouter (cacheado brevemente por proceso) para confirmar el modelo,
  modalidades, parámetros soportados, contexto, precio publicado y máximo de
  salida. Un modelo explícitamente ausente o sin perfil se clasifica como
  incompatible; una caída temporal o un catálogo incompleto se informa como
  no disponible, no como incompatibilidad.
- `AI_MAX_OUTPUT_TOKENS` es el presupuesto operativo solicitado. Por defecto es
  `16384`; el perfil actual limita el uso a `16384` como máximo seguro y se
  reduce al máximo publicado por el modelo si fuera menor. Un valor configurado
  explícitamente por encima del límite falla antes de enviar una solicitud. El
  máximo teórico del proveedor nunca se usa automáticamente.
- `src/server/ai/provider-schema.ts` proyecta el schema generado desde Zod a un
  subconjunto Gemini/OpenAI. Para Gemini omite restricciones de validación
  locales que no forman parte del perfil de provider; no elimina estructura,
  campos requeridos, enums ni tipos. Zod conserva todas las restricciones
  estrictas al validar la respuesta final.
- La primera estrategia usa `json_schema` solo si el catálogo anuncia
  `structured_outputs`. `json_object` añade al system prompt el contrato
  completo serializado desde el mismo schema Zod, incluidos los campos raíz.
- El límite es de dos llamadas OpenRouter por auditoría: un error determinista
  cambia de formato en vez de repetir la petición; 429/timeout puede reintentar
  la misma estrategia y 5xx salta al modelo de respaldo configurado. 402 se
  detiene inmediatamente. No se fabrica un dictamen.
- `GET /api/health/ai` comprueba configuración/capacidades sin una llamada de
  generación. Solo devuelve metadatos públicos y estado, nunca credenciales.
- Cada intento guarda en `audits.provider_metadata.openrouterAttempts` el modelo,
  formato, status, finish reason, latencia, uso, coste, max tokens solicitados,
  retryable y categoría.
  No se guardan prompts, evidencias ni PII.

Para cambiar de modelo, configura `OPENROUTER_MODEL` y opcionalmente
`OPENROUTER_FALLBACK_MODEL` en el entorno server-side. Comprueba primero
`GET /api/health/ai`; usa IDs estables, multimodales y con `response_format` o
`structured_outputs` publicados. `productionReady` solo indica si el ID contiene
etiquetas preview/experimental/beta; no sustituye una canary real. No configures
un fallback preview en producción sin aceptación explícita.

---

## Esquema de base de datos

Una migración, tres tablas, doce políticas RLS, un trigger.
Archivo: `migrations/00000000000000_baseline.sql` (idempotente, forward-only,
con bloque de verificación que **falla la migración** si el esquema no queda
como el archivo describe).

### `cases` — el expediente

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `status` | `text` | `DRAFT \| READY \| AUDITING \| COMPLETED \| ERROR` (CHECK) |
| `student_identifier` | `text` | opcional, texto libre, **sin índice** (es PII) |
| `created_by` | `uuid` | `NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` |
| `created_at` / `updated_at` | `timestamptz` | `updated_at` lo mantiene el trigger `set_updated_at` |

Índice único: `cases_created_by_created_at_idx (created_by, created_at DESC)` —
sirve al filtrado por dueño (predicado de todas las políticas) y al listado de
la UI.

> `cases.status` es el **ciclo de vida del expediente**, no el veredicto. El
> resultado de la auditoría vive **solo** en `audits.result_json`.

### `evidence` — los archivos del expediente

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `case_id` | `uuid` | `REFERENCES cases(id) ON DELETE CASCADE` |
| `filename` | `text` | saneado por la aplicación (sin rutas, máx. 120 chars) |
| `mime_type` | `text` | el **tipo se deriva de aquí**; no hay columna `kind` |
| `size_bytes` | `bigint` | |
| `hash` | `text` | SHA-256 hexadecimal del binario |
| `storage_path` | `text` | key del objeto en InsForge Storage |
| `processing_status` | `text` | `UPLOADED \| TRANSCRIBING \| READY \| ERROR` (CHECK) |
| `transcript_json` | `jsonb` | transcripción AssemblyAI normalizada (audio) |
| `extracted_text` | `text` | opcional. Texto derivado cacheado del PDF |
| `extraction_pipeline_version` | `text` | opcional. Versión del extractor que produjo `extracted_text` |
| `created_at` | `timestamptz` | sin `updated_at`: el contenido es inmutable |

Índices: `evidence_case_id_created_at_idx` y `evidence_hash_idx` (este último
**no** es `UNIQUE`).

`extracted_text` + `extraction_pipeline_version` son una **caché derivada**, no
fuente de verdad: si la migración no está aplicada, o si la versión no coincide,
el derivado se descarta y se vuelve a extraer. El binario original nunca se
modifica (`PRESERVE_EVIDENCE_PROVENANCE`).

### `audits` — los intentos de auditoría (fuente de verdad del resultado)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `case_id` | `uuid` | `REFERENCES cases(id) ON DELETE CASCADE`, **sin** `UNIQUE` (se puede re-auditar) |
| `status` | `text` | `RUNNING \| COMPLETED \| ERROR` (CHECK) |
| `provider` | `text` | `NOT NULL DEFAULT 'openrouter'` |
| `model` | `text` | modelo que realmente respondió (incluye fallback) |
| `evidence_fingerprint` | `text` | hash determinista del conjunto canónico de evidencias |
| `attempt_number` | `integer` | intento durable para ese fingerprint |
| `deadline_at` | `timestamptz` | presupuesto temporal del run; evita healer prematuro |
| `provider_metadata` | `jsonb` | metadata técnica no normativa (usage real, stale, etc.) |
| `result_json` | `jsonb` | `AuditResult` validado. **Única** fuente de verdad |
| `error_category` | `text` | sin CHECK: el vocabulario lo fija la aplicación |
| `latency_ms` | `integer` | admite `NULL` ("no lo sé" ≠ 0) |
| `created_at` | `timestamptz` | |

### Tablas, vistas y funciones de soporte

Migraciones incrementales posteriores al baseline. Ninguna es destructiva; todas
son `CREATE … IF NOT EXISTS`, `CREATE OR REPLACE VIEW`, `ALTER TABLE … ADD
COLUMN` o `CREATE OR REPLACE FUNCTION`, por lo que re-ejecutarlas es un no-op.

| Objeto | Migración | Para qué |
|---|---|---|
| `app_memberships` (`user_id` PK, `role` CHECK en `user`/`coordinator`) | `20261002000000_auth_core.sql` | Autorización de acceso a la app. **No hay sign-up**: sin fila aquí, `403`. |
| `request_admissions` + `admit_or_reject_quota(...)` | `20261003000000_paid_admissions.sql` | Cuotas de admisión. Cubre las operaciones **pagadas** (auditoría, comparación, transcripción de audio) y las de **login** (5/correo y 10/IP por 15 min). El sujeto se persiste **hasheado**; la admisión es una fila, no un contador en memoria. |
| `audit_dashboard_metrics` (view) + `audits_created_at_idx` | `20260929040000_…` | Métricas agregadas de auditoría para `/api/dashboard/*`. |
| `case_reviews` (+ columna del responsable) | `20260930010000_…`, `20261001010000_…` | Revisión humana del dictamen. |
| `case_comparisons` | `20260930010000_human-resolution.sql` | Comparaciones entre casos. |
| `case_comparisons_dashboard_metrics` (view) + `case_comparisons_created_at_idx` | `20260930020000_…` | Métricas de comparaciones. **Requiere** `20260930010000_…` aplicada. |
| `case_area_comments` | `20261005010000_case-area-comments.sql` | Comentarios manuales por área (Back Office, HelpDesk, Servicios Escolares, Finanzas, Adicional). Un comentario vigente por `(case_id, area)`: guardar **sustituye**. El área es vocabulario cerrado (`CHECK` en la base, `z.enum` en el servidor, lista en el cliente). Se muestran al final del dictamen y **no participan en él**. |
| `evidence.extracted_text`, `evidence.extraction_pipeline_version` | `20261003010000_…` | Caché de derivados (ver arriba). |

Las vistas del dashboard se crean con `CREATE OR REPLACE VIEW` y llevan una
comprobación de forma que lanza si alguien las editó a mano
(`AUDIT_DASHBOARD_METRICS_INCOMPLETE`), en vez de fallar en silencio con métricas
equivocadas.

**RLS y `service_role`:** el servidor escribe con el rol de servicio (bypass de
RLS) y es el único que debe hacerlo. El scoping por dueño se aplica **en la
aplicación** (`assertCaseOwner` / `getScopedCaseOr404`) *y* en la base; la
aplicación es la primera barrera porque devuelve `404` en vez de filtrar en
silencio.

### RLS

**Una sola regla en las tres tablas: el dueño es el creador del caso.**

- `cases`: `created_by = auth.uid()`.
- `evidence` y `audits`: `EXISTS (SELECT 1 FROM cases WHERE cases.id = <hija>.case_id AND cases.created_by = auth.uid())`.

Las doce políticas (SELECT/INSERT/UPDATE/DELETE × 3 tablas) son `PERMISSIVE`,
para el rol `authenticated`, y el `UPDATE` de `cases` lleva `WITH CHECK` para que
nadie regale un caso cambiando `created_by`. `anon` no conserva ningún privilegio
sobre las tres tablas y ninguna función de `public` es ejecutable por `PUBLIC` ni
por `anon`. Sin sesión, `auth.uid()` es `NULL`, las políticas no se cumplen y no
se ve ni se escribe nada.

`service_role` (el servidor) es quien escribe; es el rol que la plataforma define
con bypass de RLS.

### Estados

**Evidencia** (`evidence.processing_status`):

```text
audio:    UPLOADED -> TRANSCRIBING -> READY   (al subir, AssemblyAI)
no-audio: READY                              (nada que esperar)
audio:    UPLOADED | TRANSCRIBING -> ERROR
```

`UPLOADED` y `TRANSCRIBING` son estados "en proceso"; `READY` significa que el
contenido está disponible para el modelo; `ERROR` significa que el contenido no
se pudo preparar y **bloquea la auditoría** (`POST /audit` responde
`400 TRANSCRIPTION_ERROR` indicando qué evidencias fallaron).

Solo el audio pasa por `UPLOADED`/`TRANSCRIBING`: al subirlo se lanza la
transcripción de AssemblyAI y el `assemblyId` queda en `transcript_json`. No hay
webhooks; el estado se refresca bajo demanda, en `GET /api/cases/:caseId` (hasta
6 s) y en `GET /api/cases/:caseId/audit` (hasta 10 s).

El resto de los tipos (PDF, imágenes, texto) nace directamente en `READY` porque
no tiene un paso asíncrono de preparación: su contenido ya está en el
almacenamiento y la transformación de formato (texto del PDF, data URI, utf-8)
se hace en `buildAuditInputs`, al momento de auditar. Por eso son los únicos
estados que la auditoría acepta sin esperar.

**Caso** (`cases.status`):

```text
DRAFT -> READY -> AUDITING -> COMPLETED | ERROR
```

- `READY` significa que existe al menos una evidencia utilizable y se puede
  auditar. Subir evidencia READY después de `COMPLETED` reabre el caso a `READY`.
- Borrar evidencia después de `COMPLETED` recalcula el estado: `READY` si queda
  evidencia utilizable; `DRAFT` si ya no queda ninguna.
- `COMPLETED` significa **"la auditoría se terminó"**, no "el alumno cumple".
  Qué decidió la auditoría se pregunta a `audits.result_json`.
- `ERROR` viene con `audits.error_category` y mensaje sanitizado.

La reutilización de dictámenes se basa en `audits.evidence_fingerprint`: si el
fingerprint coincide se reutiliza el `COMPLETED`; si cambia la evidencia, se crea
una nueva auditoría. Un índice único parcial evita dos `RUNNING` simultáneos para
el mismo `(case_id, evidence_fingerprint)`.

---

## Autenticación

El login es **exclusivamente Google OAuth con PKCE** y ocurre 100 % en el
servidor. No hay login por contraseña: `POST /api/auth/session` responde `405`.

```
LoginScreen  ──GET /api/auth/google──▶  servidor
                                        │ signInWithOAuth(skipBrowserRedirect)
                                        │ codeVerifier → cookie httpOnly (10 min)
                                        ▼ 302 a Google
       Google  ──insforge_code──▶  GET /api/auth/google-callback
                                        │ exchangeOAuthCode(code, verifier)
                                        ▼ 303 a la app
```

El `codeVerifier` nunca sale del servidor, así que interceptar el redirect no
permite canjear el código. Es la misma función que el CSRF cubre en mutaciones:
un callback sin verifier es `400` y no toca el proveedor de identidad.

Antes de abrir sesión, el callback valida en este orden y falla cerrado:

1. **Dominio** — `isAllowedEmail` exige `<cuenta>@utel.edu.mx` exacto. Se evalúa
   contra el `user.email` que devuelve InsForge (verificado por Google), nunca
   contra nada del navegador.
2. **Verificación** — `emailVerified` debe ser `true`.
3. **Autorización** — fila en `app_memberships`. El dominio **no** es permiso:
   un correo institucional sin fila recibe `sin_acceso`.

Un rechazo cierra la sesión que InsForge abrió al canjar, borra el verifier y
**no escribe ninguna cookie de sesión**. El motivo viaja como clave opaca en
`?authError=`; el texto vive en `src/lib/useSession.ts`.

Los destinos de retorno se declaran en `insforge.toml` (`allowed_redirect_urls`)
y deben coincidir con `oauthCallbackUrl()`. Si la lista no incluye el
`APP_URL` activo, Google no vuelve a la app.

### Cambiar el dominio admitido

`ALLOWED_EMAIL_DOMAIN` en `src/server/auth.ts`. Requiere desplegar y **no**
cambia quién tiene acceso: el filtro es una condición necesaria, no suficiente.

---

## API

Todas las rutas son Vercel Functions en `api/**` y comparten `handleRoute` de
`src/server/http.ts`, que aplica **antes del handler** dos guards: resolución de
sesión (fail-closed) y CSRF en métodos mutantes.

`handleRoute` acepta `{ public: true }` solo para las tres rutas marcadas abajo.
InsForge se accede exclusivamente desde el servidor: el navegador nunca recibe
claves ni habla directamente con la plataforma.

| Método | Ruta | Auth | Respuesta |
|---|---|---|---|
| `GET` | `/api/auth/google` | pública | `302` a Google; el `codeVerifier` de PKCE viaja en cookie `httpOnly` |
| `GET` | `/api/auth/google-callback` | pública | `303` a la app; `?authError=<dominio\|no_verificado\|sin_acceso\|fallo>` si rechaza |
| `DELETE` | `/api/auth/session` | pública | `204` — cierra sesión y limpia cookies |
| `POST` | `/api/auth/refresh` | pública | `200` — rota el access token con el refresh |
| `GET` | `/api/cases` | sesión | `200 { cases: CaseSummary[] }` (máx. 100) |
| `POST` | `/api/cases` | sesión | `201 { case }` · body `{ studentIdentifier? }` |
| `GET` | `/api/cases/:caseId` | sesión + dueño | `200 { case, evidences, audit }` |
| `POST` | `/api/cases/:caseId/evidence` | sesión + dueño | `201 { evidence }` · body binario crudo |
| `DELETE` | `/api/cases/:caseId/evidence/:evidenceId` | sesión + dueño | `200 { ok: true }` |
| `GET` `POST` | `/api/cases/:caseId/audit` | sesión + dueño | `200 { audit }` \| `202 { audit: null, pendingEvidence }` |
| `POST` | `/api/cases/:caseId/comparison` | sesión + dueño | `200` — lanza el comparador entre dos casos |
| `GET` `POST` | `/api/cases/:caseId/area-comments` | sesión + **dueño** | `GET 200 { comments }` \| `POST 200 { comment }` — body `{ area, comment }`. **Dueño, no "sesión + dueño"**: un `coordinator` lee cualquier caso pero no escribe en el ajeno. Es un UPSERT, por eso `200` y no `201`. |
| `GET` `POST` | `/api/cases/:caseId/review` | sesión + dueño | `GET 200 { review \| null }` · `POST 200 { review }` (revisión humana) |
| `GET` | `/api/evidence/:evidenceId/download` | sesión + dueño | `200` binario (`?preview=1` → `inline`) |
| `GET` | `/api/dashboard/summary` | sesión + rol | `200 { summary }` |
| `GET` | `/api/dashboard/quality` | sesión + rol | `200 { quality }` |
| `GET` | `/api/dashboard/ai-costs` | sesión + rol | `200 { costs }` |
| `GET` | `/api/dashboard/options` | sesión + rol | `200 { options }` — filtros disponibles |
| `GET` | `/api/health/ai` | pública | Capacidades seguras; no invoca generación ni expone secretos |

> **No hay sign-up.** Los usuarios se crean en InsForge (CLI o panel) y se
> autoriza el acceso insertando su fila en `app_memberships`. Una cuenta de
> InsForge sin membership recibe `403` en cualquier ruta de la API: no existe
> un estado "registrado pero inactivo" dentro de la aplicación.

### Detalles del contrato

- **DTOs en camelCase** en toda la API (`studentIdentifier`, `processingStatus`,
  `resultJson`, `createdAt`…); la base usa snake_case.
- **Subida de evidencia**: cuerpo binario crudo (sin `multipart`), con headers
  `content-type: <MIME>` y `x-file-name: <nombre URL-encoded>`. El nombre no
  puede ir en el body porque el body *es* el archivo.
- **`POST /audit`** responde `202` con `pendingEvidence: string[]` (ids) cuando
  hay audio todavía transcribiéndose; la UI hace polling con `GET /audit`.
- **`GET /audit`** hace *healing*: refresca transcripciones (hasta 10 s) y marca
  `ERROR` las auditorías `RUNNING` abandonadas hace más de 4 minutos (por ejemplo,
  una Function de Vercel cortada a mitad). `GET /api/cases/:caseId` también
  refresca transcripciones (hasta 6 s).
- **Idempotencia**: `POST /audit` con un `COMPLETED` existente devuelve ese
  dictamen sin volver a llamar al modelo. El fingerprint de la auditoría se
  calcula sobre el expediente normalizado y la versión del pipeline
  (`AUDIT_PIPELINE_VERSION`), excluyendo campos de control como
  `processing_status`; cambiar cualquiera de los dos invalida el fingerprint.
- **Derivados cacheados**: el texto extraído de un PDF se persiste en
  `evidence.extracted_text` junto a `extraction_pipeline_version`. Si la versión
  no coincide, el derivado se descarta y se vuelve a extraer
  (`DO_NOT_REPROCESS_AI_UNNECESSARILY`).

### Formato de error

```json
{ "error": { "category": "VALIDATION_ERROR", "message": "…" } }
```

Categorías (`ErrorCategory` en `src/skills/audit/types.ts`):

`UPLOAD_ERROR` · `TRANSCRIPTION_ERROR` · `AI_PROVIDER_ERROR` ·
`INVALID_AI_RESPONSE` · `STORAGE_ERROR` · `DATABASE_ERROR` · `AUTH_ERROR` ·
`NOT_FOUND` · `VALIDATION_ERROR` · `UNKNOWN`

`UNKNOWN` solo se usa para errores no controlados: se loguea en el servidor y se
responde `"Error interno del servidor"`. **Nunca** se exponen stack traces.
Los mensajes del proveedor se sanean (se ocultan `api_key`, `secret`, `token`,
`authorization`) y se truncan a 300 caracteres.

---

## Seguridad

### Frontera de confianza

- **InsForge server-side.** El navegador solo llama a `/api/*`; no recibe claves
  ni credenciales de InsForge/OpenRouter. No existe ninguna variable de entorno
  con prefijo `VITE_` o `NEXT_PUBLIC_` (lo verifica `npm run lint:secrets`).
- **Sesión en cookies `httpOnly`.** Access y refresh token viajan en
  `HttpOnly; Secure; SameSite=Lax; Path=/`. El token **nunca** se decodifica en
  el servidor: la identidad se resuelve_REMOTAMENTE_ contra InsForge
  (`auth.getCurrentUser`). Si el proveedor falla → `503`, nunca anónimo.
- **Fail-closed.** Sin cookie, con cookie inválida, o sin fila en
  `app_memberships`, la respuesta es `401`/`403`. No hay ruta que caiga en modo
  invitado por error.
- **CSRF.** Todo método mutante (`POST`/`PUT`/`PATCH`/`DELETE`) exige que el
  `Origin` coincida con `APP_URL` y que llegue `X-App-Request: 1`. Ambas
  condiciones; sin `Origin` (p. ej. mismo origen en algunos clientes) se rechaza.
- **Autorización por dueño.** Cada ruta de caso pasa por
  `getScopedCaseOr404`/`assertCaseOwner`. Un caso ajeno devuelve **404, no 403**:
  responder 403 confirmaría que el identificador existe.
- **Roles.** `user` y `coordinator` salen de `app_memberships`. Un rol
  desconocido se trata como "sin permiso" (fail-closed), no como `user`.

### Entrada no confiable

- **Validación MIME en servidor.** Solo `image/png`, `image/jpeg`, `image/webp`,
  `image/gif`, `application/pdf`, `text/plain` y cualquier `audio/*`. Cualquier
  otro tipo → `400 UPLOAD_ERROR`.
- **Firma real del archivo (magic bytes).** El MIME declarado **no** basta:
  `verifyFileSignature` compara los primeros bytes con la firma del formato
  declarado antes de cualquier efecto (cuota, Storage, insert). PDF `PK`/`MZ`/
  ELF/shebang bajo un `text/plain` también se rechazan, porque sería la vía para
  colar un binario o un script como "texto".
- **Límite de tamaño**: 4 MB por evidencia (`MAX_EVIDENCE_BYTES`), por debajo del
  límite de body de Vercel. Excedido → `413 UPLOAD_ERROR`.
- **Nombres de archivo saneados**: sin rutas ni caracteres de control; la key de
  storage incluye `caseId` + UUID, así que un nombre no controla la ruta ni
  colisiona.
- **Las evidencias son DATOS, nunca instrucciones.** Además del bloque explícito
  anti prompt-injection del system prompt
  (`EVIDENCE_IS_DATA_NOT_INSTRUCTIONS`), `src/skills/sanitize.ts` **cerca**
  mecánicamente el contenido no confiable: neutraliza delimitadores de tipo y de
  cerca de código que el contenido pudiera usar para cerrar el bloque y fingir
  hablar en nombre del sistema (`sanitizeTagDelimiters`,
  `sanitizeFenceDelimiters`, `wrapUntrusted`).
- **Sanitización también en el encabezado del expediente**: el nombre del archivo
  se sanea antes de aparecer en `## Evidencia: <nombre>`, porque un nombre de
  archivo es un vector de inyección tan válido como el cuerpo.

### Cuotas

- **Cuotas de admisión** (`src/server/quotas.ts`) resueltas por la función SQL
  `admit_or_reject_quota`, no en memoria de proceso (`NO_PROCESS_LOCAL_DURABILITY`).
- **Sujeto hasheado**: correo e IP se hashean con HMAC (`hashQuotaSubject`) antes
  de persistirse. La base nunca ve la dirección IP ni el correo en claro.
- **Fail-closed con la semántica correcta**: si la RPC de cuota responde
  malformada o con un booleano que no es booleano, se devuelve **503**, no 429.
  Confundir "no pude preguntar" con "te pasaste" produce un 429 falso y oculta
  una caída de infraestructura.
- **Auditorías y comparaciones** cobran cuota antes de invocar al modelo.
- **Audio**: la cuota se cobra **antes** de subir a Storage e insertar la fila,
  para que un `429` nunca deje bytes huérfanos ni una evidencia sin dueño.
- **Login**: cuota por correo y por IP. La IP se toma de los headers del proxy y
  solo se acepta si es IPv4/IPv6 literal; nunca se persiste en crudo.

### Datos y diagnóstico

- **Diagnóstico IA sin contenido.** Se guarda modelo, formato, status, códigos
  saneados, latencia, tokens, coste y categoría; no prompt, archivos ni PII.
- **Sin PII en Git.** `cases.student_identifier` es un dato personal: se guarda
  (la auditoría lo necesita) pero no aparece en ningún `INSERT` del repositorio.
- **Procedimiento inmutable.** `policy/` no se edita; se *serializa* a
  `policy-v5.generated.ts` con su SHA-256 en el prompt.
- **Sin dependencias de estado en memoria de proceso**: el run es durable desde
  la fila `audits` en `RUNNING`, creada **antes** de llamar al modelo.
- **Errores sin fuga**: `sendError` traduce a un `ErrorCategory` cerrado y nunca
  expone stack traces. Los mensajes del proveedor se sanean (se ocultan
  `api_key`, `secret`, `token`, `authorization`) y se truncan a 300 caracteres.

### Checklist operativo antes de abrir a usuarios

En `docs/REPOSITORY_AUDIT.md` está el detalle. Lo mínimo que falta resolver en
la instancia existente antes de habilitar login:

1. Aplicar las migraciones pendientes (`migrations/*.sql` posteriores al baseline).
2. Crear y poblar `app_memberships` para los usuarios autorizados.
3. Hacer backfill de los casos con `created_by IS NULL` (quedan invisibles bajo
   RLS) al custodio que corresponda.
4. Aplicar en el bucket de Storage una política **owner-scoped**; sin ella,
   conocer la ruta del objeto basta para descargarlo.
5. Rotar el secreto `sk-…` que quedó en el historial Git (commit `569d8ca`).

Detalle operativo completo: `SECURITY.md`.

### Límites duros

| Límite | Valor |
|---|---|
| `MAX_AGENT_STEPS` | 12 |
| `MAX_TOOL_CALLS` | 20 |
| `MAX_REVIEW_ROUNDS` | 2 |
| `MAX_PROVIDER_ATTEMPTS` | 2 llamadas OpenRouter como máximo por auditoría |

Al alcanzar un límite, el run termina en error tipado. Nunca se inicia otro run
automáticamente.

---

## Modo de desarrollo

```bash
npm install
cp .env.example .env.local     # completar las obligatorias
npm run dev
```

`npm run dev` ejecuta `predev` (regenera `policy-v5.generated.ts`) y levanta
Vite en `http://localhost:5173`. Un plugin de Vite monta **`/api/*` en el mismo
dev server** importando los mismos handlers de `api/**` que usa Vercel
(`scripts/dev-api.mjs`), así que en desarrollo no hay mock ni backend paralelo.

> En Windows, si PowerShell bloquea `npm`, usa `npm.cmd`.

Scripts disponibles:

| Script | Qué hace |
|---|---|
| `npm run dev` | Vite + API de desarrollo (`predev` regenera la policy) |
| `npm run build` | `tsc` + `vite build` → `dist` (`prebuild` regenera la policy) |
| `npm run preview` | Sirve `dist` |
| `npm run typecheck` | `tsc` sin emitir |
| `npm test` / `npm run test:watch` | Vitest |
| `npm run test:contract` | Contratos OpenRouter, capabilities, schema y referencias |
| `npm run test:ai-smoke` | Auditoría sintética real contra OpenRouter; requiere credencial configurada |
| `npm run verify:release` | Secret scan, typecheck, contracts, toda la suite y build |
| `npm run verify:release:live` | Release gate local más smoke real facturable |
| `npm run policy:generate` | Compila `policy/` → `src/skills/audit/policy-v5.generated.ts` |

El smoke live está separado de los tests unitarios y usa un caso y evidencia
ficticios en almacenamiento en memoria; no escribe datos en InsForge. Puede
generar coste de modelo. No se ejecuta automáticamente en CI.

Cada PR y push a `main` ejecuta `npm run verify:release`, que incluye los
contract checks críticos aunque TypeScript compile. Los tests unitarios no
hacen llamadas pagadas a OpenRouter.

---

## Deploy en Vercel

`vercel.json`:

```json
{
  "framework": "vite",
  "installCommand": "npm ci",
  "buildCommand": "npm run build",
  "outputDirectory": "dist"
}
```

- Las **Functions** viven en `api/**` y se despliegan automáticamente.
- `api/cases/[caseId]/audit/index.ts` exporta `export const maxDuration = 300`.
  `TOTAL_AUDIT_TIMEOUT_MS` (240 s por defecto) debe quedar por debajo de ese
  techo; cada intento usa `min(AI_TIMEOUT_MS, tiempo restante)`.
- **No hace falta rewrite de fallback para la SPA**: el enrutado es por hash
  (`#/`, `#/casos/:id`), así que el navegador solo pide `/`, `/index.html`,
  `/assets/*` y `/api/*`. Un rewrite `/(.*) → /index.html` sería innecesario y
  podría confundir el enrutado de las Functions.
- CI (`.github/workflows/ci.yml`): `npm ci` → `typecheck` → `test` → `build`.

### Variables de entorno en Vercel

Configurar en *Project Settings → Environment Variables* (todas server-side, sin
prefijo). Ver `.env.example` para el detalle de cada una. Mínimas:

```
INSFORGE_BASE_URL=https://4pw4jdzv.us-west.insforge.app
INSFORGE_ANON_KEY=…
OPENROUTER_API_KEY=…
OPENROUTER_MODEL=google/gemini-2.5-flash-lite
OPENROUTER_FALLBACK_MODEL=google/gemini-3.1-flash-lite-preview
APP_URL=https://<tu-dominio>
```

### Checklist de primer despliegue

1. Ejecutar las migraciones en InsForge **antes** del deploy, **en orden** por
   nombre de archivo (CLI de InsForge). La secuencia es:

   ```
   00000000000000_baseline.sql
   20260928010000_ai-native-production.sql
   20260929040000_audit-dashboard-metrics.sql
   20260930010000_human-resolution.sql
   20260930020000_human-review-dashboard-metrics.sql
   20260930120000_case-metadata-and-human-reviews.sql
   20261001010000_case-reviewer-name.sql
   20261002000000_auth_core.sql
   20261003000000_paid-admissions.sql
   20261003010000_derived-extractions.sql
   20261005010000_case-area-comments.sql
   20261005120000_origin-country-channel.sql
   20261008090000_case-cycle-start-date-human.sql
   20261008100000_membership-role-manager.sql
   20261008110000_case-test-flag.sql
   20261008120000_case-review-coordinator-decision.sql
   20261008130000_dashboard-view-test-owner-scope.sql
   ```

   `20260930020000_…` **requiere** que `20260930010000_human-resolution.sql` esté
   aplicada. Ninguna migración destructiva: todas son `CREATE … IF NOT EXISTS` o
   `ALTER TABLE … ADD COLUMN`.

2. Crear el bucket de Storage `evidencias` (lo crea la CLI, no el SQL) y
   revisarle la política de acceso (owner-scoped).
3. Configurar las variables de entorno en Vercel.
4. Crear los usuarios en InsForge e **insertar su fila en `app_memberships`**
   (no hay sign-up en la aplicación).
5. Comprobar el escenario completo: crear caso → subir evidencia → auditar →
   ver dictamen → recargar y confirmar que la sesión sobrevive por cookie
   `httpOnly`.
6. Ejecutar `npm run verify:release` localmente y confirmar que
   `scripts/verify-rls-grants.sql` no reporta desviaciones.

---

## Invariantes del proyecto

- `POLICY_IS_IMMUTABLE`: el procedimiento oficial `GDM_GAM_PRD_MLG_003` v5 y las
  fuentes oficiales del owner determinan el criterio. `policy/` se serializa,
  no se edita.
- `ONLY_OWNER_PROVIDED_POLICY_SOURCES`: no buscar ni usar política encontrada en
  internet.
- `TEMPLATE_IS_NOT_POLICY`: `Dictamen.pdf` no es fuente normativa.
- `HISTORICAL_CASES_ARE_NOT_POLICY`: los casos históricos muestran práctica, no
  crean reglas.
- `LEGACY_IS_NOT_POLICY`: el historial Git puede consultarse, pero no revive
  criterios normativos.
- `AI_ANALYZES_WITH_CONTEXT`: la IA lee el expediente y el procedimiento V5
  inyectado, cita evidencia y propone assessment estructurado.
- `NO_RULES_ENGINE`: no reintroducir policy engine, rules engine, fact engine
  obligatorio, rule evaluation ni catálogos ejecutables de reglas.
- `TRACE_EVERY_DECISION`: toda conclusión importante enlaza evidencia y sección
  del procedimiento.
- `PRESERVE_EVIDENCE_PROVENANCE`: nunca modificar originales; todo derivado
  conserva hash y origen.
- `NO_PII_IN_GIT`: evidencias reales e históricos con PII quedan fuera de Git.
- `NO_PROCESS_LOCAL_DURABILITY`: auditorías y estados durables no dependen de
  memoria de proceso.
- `DO_NOT_REPROCESS_AI_UNNECESSARILY`: si la evidencia y sus derivados no
  cambian, reutilizar outputs durables.
- `KEEP_IT_SIMPLE`: monolito modular; sin microservicios ni infraestructura
  distribuida innecesaria.

Reglas de trabajo: documentación y UI en español; toda conclusión normativa
cita documento, versión, sección y página cuando existe; no usar
`INDETERMINADO` como resultado normal (la evidencia insuficiente se expresa con
`EVIDENCIA_INSUFICIENTE` + `missingEvidence`); no crear capas de compatibilidad
para arquitectura eliminada.

Ver `AGENTS.md` para la versión completa y de referencia.

---

## Documentación relacionada

| Documento | Qué cubre |
|---|---|
| `AGENTS.md` | Invariantes, límites duros y reglas de trabajo. Referencia normativa del repo. |
| `SECURITY.md` | Superficie de ataque, modelo de confianza, política de reporte de vulnerabilidades. |
| `CONTRIBUTING.md` | Flujo de trabajo, contrato de commits, qué exige un PR para mergear. |
| `PRODUCT.md` | Qué es el producto y qué no decide el código. |
| `docs/ARCHITECTURE.md` | Arquitectura por capas y flujo de una auditoría. |
| `docs/AUDIT_PIPELINE.md` | Expediente, fingerprint, idempotencia, límites y fallback de modelo. |
| `docs/DATABASE.md` | Esquema, RLS, funciones de cuota y verificación de grants. |
| `docs/DEPLOYMENT.md` | Deploy, migraciones, variables de entorno y rollback. |
| `docs/PRODUCTION-RUNBOOK.md` | Qué hacer cuando algo falla en producción. |
| `docs/TROUBLESHOOTING.md` | Errores frecuentes y su causa real. |
| `docs/REPOSITORY_AUDIT.md` | Auditoría integral: hallazgos, correcciones y pendientes. |
| `docs/MIGRATION-PLAN.md` | Estado de la migración a la arquitectura actual. |
| `migrations/00000000000000_baseline.sql` | El esquema, comentado sección por sección. |
| `policy/` | Procedimiento oficial `GDM_GAM_PRD_MLG_003` v5, indexado por sección. Inmutable. |

`docs/migration-ai-native.md` es un documento histórico del diseño previo a la
consolidación en un solo paquete: se conserva por trazabilidad, no es
especificación vigente.
