# Cancelaciones AI

Sistema **AI-native** para analizar expedientes de cancelaci├│n, baja y deserci├│n
de estudiantes (UTEL). El usuario crea un caso, sube las evidencias del
expediente (im├ígenes, PDF, audio, texto) y el sistema emite un **dictamen
sostenido en evidencia y trazado a la secci├│n del procedimiento oficial**.

---

## Qu├® es el producto

Un dictamen no lo produce una tabla de reglas: lo produce un modelo de lenguaje
que **lee el procedimiento oficial completo**, examina **todas** las evidencias
en conjunto y responde con un assessment estructurado y validado.

El procedimiento `GDM_GAM_PRD_MLG_003` (Procedimiento Deserci├│n de Estudiantes,
versi├│n 5) es la **├║nica fuente normativa**. Se indexa en `policy/` (26 secciones,
SHA-256 registrado en el manifest) y se inyecta ├¡ntegro en el contexto del modelo
en cada auditor├¡a.

---

## Arquitectura AI-native

### Qu├® decide la IA

- Extrae hechos del expediente y los enlaza con las evidencias que los acreditan.
- Detecta contradicciones entre evidencias.
- Reconstruye la cronolog├¡a.
- Aplica el Procedimiento V5 y emite uno de los siete resultados permitidos.
- Cita, en cada conclusi├│n, **la evidencia y la secci├│n del procedimiento** que la sostienen.

### Qu├® hace el c├│digo (y qu├® NO)

El c├│digo **no dictamina**. Solo:

| Responsabilidad | D├│nde |
|---|---|
| Acceso a InsForge desde el servidor | `src/server/insforge.ts` |
| Almacenamiento de binarios (InsForge Storage) | `api/cases/[caseId]/evidence/`, `api/evidence/[evidenceId]/download.ts` |
| Preparaci├│n t├®cnica de la evidencia (MIME, hash, PDFÔåÆtexto, imagenÔåÆdata URI) | `src/server/evidence-prep.ts`, `src/server/pdf.ts` |
| Transcripci├│n de audio (AssemblyAI, con diarizaci├│n) | `src/server/assemblyai.ts` |
| Transporte de IA (OpenRouter) y cascada de intentos | `src/server/openrouter.ts` |
| Orquestaci├│n durable del run (fila `RUNNING` antes de llamar al modelo) | `src/server/audit-service.ts` |
| Validaci├│n de la salida con Zod | `src/skills/audit/schema.ts` |
| Persistencia de datos y binarios | `src/server/cases.ts`, `migrations/` |
| UI | `src/components/`, `src/App.tsx` |

**No existe** policy engine, rules engine, facts engine, fact run, engine run,
cat├ílogo ejecutable de reglas, cola de jobs ni evaluaci├│n de reglas en SQL. La
base de datos **guarda** datos y archivos; **no decide** negocio.

### Flujo productivo

```text
evidencias
  -> preparaci├│n de evidencia (texto / imagen / PDF / transcripci├│n)
  -> Audit Skill con Procedimiento V5 inyectado ├¡ntegro
  -> assessment estructurado validado por Zod + validaci├│n de referencias
  -> metadata t├®cnica agregada por servidor desde OpenRouter real
  -> resultado terminal (COMPLETED | ERROR)
```

No hay tools agentic en runtime: el procedimiento completo ya se inyecta en el
prompt de sistema y la aplicaci├│n valida que las referencias a evidencias existan
en el expediente. En el c├│digo, ese flujo es:

```ts
const { result } = await auditSkill.executeWithMetadata({ caseId, studentIdentifier, evidences });
```

`src/skills/audit/execute.ts` arma el prompt de sistema (instrucciones +
Procedimiento V5 ├¡ntegro), arma el expediente como partes de contenido de
OpenRouter, llama al modelo y **valida la respuesta con Zod**. El backend no
reclasifica despu├®s; s├│lo agrega `model` y `usage` reales de OpenRouter y
rechaza referencias inventadas a evidencias.

---

## Stack

- **Frontend:** React 19 + Vite 6 + TypeScript 5.8 + Tailwind 3. SPA con
  *hash routing* (`#/`, `#/casos/:id`), sin react-router.
- **Backend:** Vercel Functions en `api/**` (Node, TypeScript compilado por el
  runtime de Vercel), helpers compartidos en `src/server/**`.
- **Base de datos + auth + storage:** InsForge (PostgreSQL + S3). **Solo
  server-side**: el navegador nunca habla con InsForge.
- **IA:** OpenRouter (├║nico proveedor).
- **Transcripci├│n:** AssemblyAI (solo audio; sin webhooks, refresco bajo demanda).
- **Validaci├│n:** Zod.
- **PDF:** `pdfjs-dist` (build legacy, server-side) para extraer texto.
- **Tests:** Vitest.

---

## Estructura del repositorio

```text
api/                       Vercel Functions (una por endpoint, sin l├│gica de negocio)
  auth/                    session.ts (POST login / DELETE logout), refresh.ts
  cases/                   index.ts, [caseId]/index.ts,
                           [caseId]/evidence/, [caseId]/evidence/[evidenceId]/,
                           [caseId]/audit/, [caseId]/review/, [caseId]/comparison/
  dashboard/               summary.ts, quality.ts, ai-costs.ts, options.ts
  evidence/                [evidenceId]/download.ts
  health/                  ai.ts

src/
  skills/                  ├ÜNICA fuente de inteligencia
    sanitize.ts            cercado de contenido no confiable (anti prompt-injection)
    audit/
      types.ts             vocabulario cerrado: resultados, estados, errores
      schema.ts            AiAuditAssessmentSchema + AuditResultSchema (Zod strict)
      procedure-v5.ts      tipos/metadatos de la pol├¡tica
      policy-v5.generated.ts  ARCHIVO GENERADO desde policy/ (npm run policy:generate)
      instructions.ts      system prompt + bloque anti prompt-injection
      execute.ts           ensamblado del expediente y llamada al modelo
    review/                skill de revisi├│n humana (reusa skills/sanitize.ts)
  server/                  env, insforge, http, errors, auth, quotas, derived,
                           cases, dto, audit-service, comparison-service,
                           reviews, dashboard, dashboard.human, dashboard-filters,
                           openrouter, assemblyai, evidence-prep, pdf
    ai/                    model-capabilities, provider-schema (contrato con el modelo)
  components/              LoginScreen, AppHeader, AppNav, CaseListPage,
                           CaseDetailPage, CasesPanel, NewCasePanel,
                           CaseReviewPanel, EvidenceUploader, EvidenceList,
                           EvidenceViewer, AuditResultPanel, ErrorBoundary, ui,
                           dashboard/ (OverviewPage, QualityPage, AiCostsPage,
                           DashboardFilters, RecentCasesTable, charts/)
  lib/                     api.ts (cliente fetch), useHashRoute, usePolling,
                           useSession, useDashboard, dashboard, labels, format, cx
policy/                    Procedimiento GDM_GAM_PRD_MLG_003 v5 (FUENTE NORMATIVA)
  manifest.json            26 secciones + SHA-256 del PDF fuente
  sections/*.md            secciones indexadas (26)
migrations/                baseline + 8 migraciones incrementales (orden por nombre)
scripts/                   generate-policy.mjs, dev-api.mjs,
                           check-no-public-secrets.mjs, run-ai-smoke.mjs,
                           verify-rls-grants.sql
tests/                     Vitest (32 archivos, 435 tests)
docs/                      documentaci├│n del proyecto
.github/                   CI (verify:release), Dependabot, plantillas de issue/PR
vercel.json                framework vite, output dist, install npm ci
```

> **El PDF fuente del procedimiento no est├í en el repo.** Las secciones `.md` de
> `policy/` s├¡ est├ín versionadas, pero el `.docx.pdf` del que se extrajeron no
> (`normative/` est├í en `.gitignore`). Su SHA-256 queda registrado en
> `policy/manifest.json` como referencia normativa: eso permite **verificar** que
> el procedimiento no cambi├│, no **reconstruirlo**. Para regenerar
> `policy-v5.generated.ts` desde el documento oficial hay que pedirle el PDF al
> owner y comprobar el hash contra el manifest.

---

## Resultados permitidos

`audit.result` solo puede ser uno de estos siete valores:

| Resultado | Significado |
|---|---|
| `CANCELACION_VENTA` | La venta se cancela conforme a la secci├│n aplicable del procedimiento, en fase de venta/validaci├│n. |
| `CANCELACION_VENTA_PETICION_CLIENTE` | La evidencia acredita una solicitud del cliente y la ruta aplicable del Procedimiento V5 determina cancelaci├│n de venta. |
| `BAJA` | El estudiante solicita o incurre en baja (deserci├│n ya iniciada la relaci├│n acad├®mica). |
| `CANCELACION_VENTA_OPERATIVA` | Aplica alg├║n supuesto de cancelaci├│n operativa (errores de ├íreas, canalizaci├│n, seguimiento, validaci├│n de paquete, back office). |
| `CANCELACION_MATRICULA` | Aplica el supuesto de cancelaci├│n de matr├¡cula del procedimiento. |
| `DICTAMINACION` | El expediente requiere dictaminaci├│n (caso de revisi├│n especial o ambig├╝edad normativa definida en el procedimiento). |
| `EVIDENCIA_INSUFICIENTE` | Con las evidencias disponibles **no** es posible acreditar de forma confiable el supuesto aplicable. |

`EVIDENCIA_INSUFICIENTE` es un **dictamen v├ílido**, no un error. Los fallos
t├®cnicos se reportan por separado, en `audits.status` y `audits.error_category`.

### Validaci├│n de la salida

La respuesta del modelo **siempre** se valida con Zod contra
`AiAuditAssessmentSchema` (`src/skills/audit/schema.ts`), que es `strict()` y no
incluye metadata t├®cnica. Si la validaci├│n falla, el intento se reintenta seg├║n
la cascada de OpenRouter; si todos fallan, el run termina con
`INVALID_AI_RESPONSE`; **nunca** se fabrica ni se "aproxima" un dictamen.

El `AuditResult` persistido agrega despu├®s, en servidor, `model` y `usage` reales
de OpenRouter. Si el modelo intenta emitir esos campos, se ignoran para que no
pueda inventar proveedor, tokens ni coste.

Shape del resultado (`audits.result_json`):

```ts
{
  case: { matricula, studentName, program, cycle, cycleStartDate },  // null si no consta
  evidenceSummary: [{ evidenceId, filename, detectedType, description, relevant }],
  facts: [{ key, label, value, confidence, evidenceIds, evidenceText }],
  timeline: [{ date, event, evidenceIds }],
  conflicts: [{ description, evidenceIds }],
  temporalAnalysis: {          // comparaci├│n solicitud vs. INICIO DE CICLO
    cycleStartDate,            // ISO YYYY-MM-DD, o null si no est├í acreditada
    cycleStartEvidenceIds,     // evidencias que acreditan el inicio acad├®mico
    cycleStartEvidenceText,    // cita que la identifica como inicio acad├®mico
    cancellationRequestDate,   // fecha en que dijo que no quer├¡a continuar
    cancellationRequestEvidenceIds,
    relationToCycleStart,      // ANTES_DEL_INICIO | MISMO_DIA_DEL_INICIO
                               // | DESPUES_DEL_INICIO | NO_DETERMINABLE
    reasoning,
  },
  audit: {
    result,                  // uno de los siete resultados
    rule,                    // criterio aplicado; string no vac├¡o
    procedureSection,        // secci├│n del Procedimiento V5 citada
    reasoning,               // justificaci├│n con documento, versi├│n, secci├│n y p├ígina
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
una m├®trica ni se calcula un coste estimado.

### La fecha de inicio de ciclo (`temporalAnalysis`)

La secci├│n 5.3 del procedimiento se define en funci├│n de la **fecha de inicio de
ciclo**, no de ninguna fecha administrativa. Por eso esa fecha viaja en un bloque
propio y trazable en lugar de ser un string suelto dentro de `case`.

- El modelo la determina **por significado sem├íntico**, buscando en todas las
  evidencias sin importar su sistema o formato. Una fecha de creaci├│n de
  matr├¡cula, inscripci├│n, decisi├│n D35/D53, CAVE, ticket, facturaci├│n o contacto
  **no** es una fecha de inicio de ciclo, aunque sea la ├║nica fecha visible.
- Si ninguna evidencia acredita el inicio acad├®mico, `cycleStartDate` es `null`
  y `relationToCycleStart` es `NO_DETERMINABLE`. **Nunca** se deduce de otra
  fecha del expediente.
- `relationToCycleStart` compara **solo** `cancellationRequestDate` contra
  `cycleStartDate`, y es obligatorio resolverla antes de aplicar la secci├│n 5.3.
- El backend **no reclasifica**: no calcula la relaci├│n ni corrige la fecha.
  Solo rechaza assessments internamente incoherentes, entre ellas:
  - una `cycleStartDate` sin `cycleStartEvidenceIds` ni cita textual;
  - una relaci├│n distinta de `NO_DETERMINABLE` sin **ambas** fechas acreditadas
    (afirmar `DESPUES_DEL_INICIO` sin inicio acreditado es exactamente el
    razonamiento que convert├¡a una cancelaci├│n de venta en baja);
  - `case.cycleStartDate` distinta de `temporalAnalysis.cycleStartDate`;
  - confianza `1` en una fecha de inicio cr├¡tica o con cronolog├¡a
    `NO_DETERMINABLE`.
- Una fecha de inicio afirmada exige adem├ís su fact `cycle_start_date` con
  evidencia, cita y confianza menor que 1, para que la trazabilidad sea visible
  en la UI.
- Los conflictos entre dos fechas de inicio se registran en `conflicts`; no se
  elige una en silencio. Una fecha administrativa distinta **no** es un conflicto:
  son conceptos diferentes.

Regresi├│n: `tests/cycle-start-date.test.ts` (los cinco escenarios) y el caso real
sint├®tico en `tests/ai-smoke.live.test.ts` (`npm run test:ai-smoke`).

### OpenRouter: capacidades, schema y fallback

- `AiAuditAssessmentSchema` en Zod es el contrato de negocio final. Toda
  respuesta se valida con Zod y sus referencias se cotejan contra las evidencias
  de entrada; el schema del proveedor nunca reemplaza esa validaci├│n.
- `src/server/ai/model-capabilities.ts` consulta el cat├ílogo p├║blico de
  OpenRouter (cacheado brevemente por proceso) para confirmar el modelo,
  modalidades, par├ímetros soportados, contexto, precio publicado y m├íximo de
  salida. Un modelo expl├¡citamente ausente o sin perfil se clasifica como
  incompatible; una ca├¡da temporal o un cat├ílogo incompleto se informa como
  no disponible, no como incompatibilidad.
- `AI_MAX_OUTPUT_TOKENS` es el presupuesto operativo solicitado. Por defecto es
  `16384`; el perfil actual limita el uso a `16384` como m├íximo seguro y se
  reduce al m├íximo publicado por el modelo si fuera menor. Un valor configurado
  expl├¡citamente por encima del l├¡mite falla antes de enviar una solicitud. El
  m├íximo te├│rico del proveedor nunca se usa autom├íticamente.
- `src/server/ai/provider-schema.ts` proyecta el schema generado desde Zod a un
  subconjunto Gemini/OpenAI. Para Gemini omite restricciones de validaci├│n
  locales que no forman parte del perfil de provider; no elimina estructura,
  campos requeridos, enums ni tipos. Zod conserva todas las restricciones
  estrictas al validar la respuesta final.
- La primera estrategia usa `json_schema` solo si el cat├ílogo anuncia
  `structured_outputs`. `json_object` a├▒ade al system prompt el contrato
  completo serializado desde el mismo schema Zod, incluidos los campos ra├¡z.
- El l├¡mite es de dos llamadas OpenRouter por auditor├¡a: un error determinista
  cambia de formato en vez de repetir la petici├│n; 429/timeout puede reintentar
  la misma estrategia y 5xx salta al modelo de respaldo configurado. 402 se
  detiene inmediatamente. No se fabrica un dictamen.
- `GET /api/health/ai` comprueba configuraci├│n/capacidades sin una llamada de
  generaci├│n. Solo devuelve metadatos p├║blicos y estado, nunca credenciales.
- Cada intento guarda en `audits.provider_metadata.openrouterAttempts` el modelo,
  formato, status, finish reason, latencia, uso, coste, max tokens solicitados,
  retryable y categor├¡a.
  No se guardan prompts, evidencias ni PII.

Para cambiar de modelo, configura `OPENROUTER_MODEL` y opcionalmente
`OPENROUTER_FALLBACK_MODEL` en el entorno server-side. Comprueba primero
`GET /api/health/ai`; usa IDs estables, multimodales y con `response_format` o
`structured_outputs` publicados. `productionReady` solo indica si el ID contiene
etiquetas preview/experimental/beta; no sustituye una canary real. No configures
un fallback preview en producci├│n sin aceptaci├│n expl├¡cita.

---

## Esquema de base de datos

Una migraci├│n, tres tablas, doce pol├¡ticas RLS, un trigger.
Archivo: `migrations/00000000000000_baseline.sql` (idempotente, forward-only,
con bloque de verificaci├│n que **falla la migraci├│n** si el esquema no queda
como el archivo describe).

### `cases` ÔÇö el expediente

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `status` | `text` | `DRAFT \| READY \| AUDITING \| COMPLETED \| ERROR` (CHECK) |
| `student_identifier` | `text` | opcional, texto libre, **sin ├¡ndice** (es PII) |
| `created_by` | `uuid` | `NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` |
| `created_at` / `updated_at` | `timestamptz` | `updated_at` lo mantiene el trigger `set_updated_at` |

├ìndice ├║nico: `cases_created_by_created_at_idx (created_by, created_at DESC)` ÔÇö
sirve al filtrado por due├▒o (predicado de todas las pol├¡ticas) y al listado de
la UI.

> `cases.status` es el **ciclo de vida del expediente**, no el veredicto. El
> resultado de la auditor├¡a vive **solo** en `audits.result_json`.

### `evidence` ÔÇö los archivos del expediente

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `case_id` | `uuid` | `REFERENCES cases(id) ON DELETE CASCADE` |
| `filename` | `text` | saneado por la aplicaci├│n (sin rutas, m├íx. 120 chars) |
| `mime_type` | `text` | el **tipo se deriva de aqu├¡**; no hay columna `kind` |
| `size_bytes` | `bigint` | |
| `hash` | `text` | SHA-256 hexadecimal del binario |
| `storage_path` | `text` | key del objeto en InsForge Storage |
| `processing_status` | `text` | `UPLOADED \| TRANSCRIBING \| READY \| ERROR` (CHECK) |
| `transcript_json` | `jsonb` | transcripci├│n AssemblyAI normalizada (audio) |
| `extracted_text` | `text` | opcional. Texto derivado cacheado del PDF |
| `extraction_pipeline_version` | `text` | opcional. Versi├│n del extractor que produjo `extracted_text` |
| `created_at` | `timestamptz` | sin `updated_at`: el contenido es inmutable |

├ìndices: `evidence_case_id_created_at_idx` y `evidence_hash_idx` (este ├║ltimo
**no** es `UNIQUE`).

`extracted_text` + `extraction_pipeline_version` son una **cach├® derivada**, no
fuente de verdad: si la migraci├│n no est├í aplicada, o si la versi├│n no coincide,
el derivado se descarta y se vuelve a extraer. El binario original nunca se
modifica (`PRESERVE_EVIDENCE_PROVENANCE`).

### `audits` ÔÇö los intentos de auditor├¡a (fuente de verdad del resultado)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `case_id` | `uuid` | `REFERENCES cases(id) ON DELETE CASCADE`, **sin** `UNIQUE` (se puede re-auditar) |
| `status` | `text` | `RUNNING \| COMPLETED \| ERROR` (CHECK) |
| `provider` | `text` | `NOT NULL DEFAULT 'openrouter'` |
| `model` | `text` | modelo que realmente respondi├│ (incluye fallback) |
| `evidence_fingerprint` | `text` | hash determinista del conjunto can├│nico de evidencias |
| `attempt_number` | `integer` | intento durable para ese fingerprint |
| `deadline_at` | `timestamptz` | presupuesto temporal del run; evita healer prematuro |
| `provider_metadata` | `jsonb` | metadata t├®cnica no normativa (usage real, stale, etc.) |
| `result_json` | `jsonb` | `AuditResult` validado. **├Ünica** fuente de verdad |
| `error_category` | `text` | sin CHECK: el vocabulario lo fija la aplicaci├│n |
| `latency_ms` | `integer` | admite `NULL` ("no lo s├®" Ôëá 0) |
| `created_at` | `timestamptz` | |

### Tablas, vistas y funciones de soporte

Migraciones incrementales posteriores al baseline. Ninguna es destructiva; todas
son `CREATE ÔÇª IF NOT EXISTS`, `CREATE OR REPLACE VIEW`, `ALTER TABLE ÔÇª ADD
COLUMN` o `CREATE OR REPLACE FUNCTION`, por lo que re-ejecutarlas es un no-op.

| Objeto | Migraci├│n | Para qu├® |
|---|---|---|
| `app_memberships` (`user_id` PK, `role` CHECK en `user`/`coordinator`) | `20261002000000_auth_core.sql` | Autorizaci├│n de acceso a la app. **No hay sign-up**: sin fila aqu├¡, `403`. |
| `request_admissions` + `admit_or_reject_quota(...)` | `20261003000000_paid_admissions.sql` | Cuotas de admisi├│n. Cubre las operaciones **pagadas** (auditor├¡a, comparaci├│n, transcripci├│n de audio) y las de **login** (5/correo y 10/IP por 15 min). El sujeto se persiste **hasheado**; la admisi├│n es una fila, no un contador en memoria. |
| `audit_dashboard_metrics` (view) + `audits_created_at_idx` | `20260929040000_ÔÇª` | M├®tricas agregadas de auditor├¡a para `/api/dashboard/*`. |
| `case_reviews` (+ columna del responsable) | `20260930010000_ÔÇª`, `20261001010000_ÔÇª` | Revisi├│n humana del dictamen. |
| `case_comparisons` | `20260930010000_human-resolution.sql` | Comparaciones entre casos. |
| `case_comparisons_dashboard_metrics` (view) + `case_comparisons_created_at_idx` | `20260930020000_ÔÇª` | M├®tricas de comparaciones. **Requiere** `20260930010000_ÔÇª` aplicada. |
| `evidence.extracted_text`, `evidence.extraction_pipeline_version` | `20261003010000_ÔÇª` | Cach├® de derivados (ver arriba). |

Las vistas del dashboard se crean con `CREATE OR REPLACE VIEW` y llevan una
comprobaci├│n de forma que lanza si alguien las edit├│ a mano
(`AUDIT_DASHBOARD_METRICS_INCOMPLETE`), en vez de fallar en silencio con m├®tricas
equivocadas.

**RLS y `service_role`:** el servidor escribe con el rol de servicio (bypass de
RLS) y es el ├║nico que debe hacerlo. El scoping por due├▒o se aplica **en la
aplicaci├│n** (`assertCaseOwner` / `getScopedCaseOr404`) *y* en la base; la
aplicaci├│n es la primera barrera porque devuelve `404` en vez de filtrar en
silencio.

### RLS

**Una sola regla en las tres tablas: el due├▒o es el creador del caso.**

- `cases`: `created_by = auth.uid()`.
- `evidence` y `audits`: `EXISTS (SELECT 1 FROM cases WHERE cases.id = <hija>.case_id AND cases.created_by = auth.uid())`.

Las doce pol├¡ticas (SELECT/INSERT/UPDATE/DELETE ├ù 3 tablas) son `PERMISSIVE`,
para el rol `authenticated`, y el `UPDATE` de `cases` lleva `WITH CHECK` para que
nadie regale un caso cambiando `created_by`. `anon` no conserva ning├║n privilegio
sobre las tres tablas y ninguna funci├│n de `public` es ejecutable por `PUBLIC` ni
por `anon`. Sin sesi├│n, `auth.uid()` es `NULL`, las pol├¡ticas no se cumplen y no
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
contenido est├í disponible para el modelo; `ERROR` significa que el contenido no
se pudo preparar y **bloquea la auditor├¡a** (`POST /audit` responde
`400 TRANSCRIPTION_ERROR` indicando qu├® evidencias fallaron).

Solo el audio pasa por `UPLOADED`/`TRANSCRIBING`: al subirlo se lanza la
transcripci├│n de AssemblyAI y el `assemblyId` queda en `transcript_json`. No hay
webhooks; el estado se refresca bajo demanda, en `GET /api/cases/:caseId` (hasta
6 s) y en `GET /api/cases/:caseId/audit` (hasta 10 s).

El resto de los tipos (PDF, im├ígenes, texto) nace directamente en `READY` porque
no tiene un paso as├¡ncrono de preparaci├│n: su contenido ya est├í en el
almacenamiento y la transformaci├│n de formato (texto del PDF, data URI, utf-8)
se hace en `buildAuditInputs`, al momento de auditar. Por eso son los ├║nicos
estados que la auditor├¡a acepta sin esperar.

**Caso** (`cases.status`):

```text
DRAFT -> READY -> AUDITING -> COMPLETED | ERROR
```

- `READY` significa que existe al menos una evidencia utilizable y se puede
  auditar. Subir evidencia READY despu├®s de `COMPLETED` reabre el caso a `READY`.
- Borrar evidencia despu├®s de `COMPLETED` recalcula el estado: `READY` si queda
  evidencia utilizable; `DRAFT` si ya no queda ninguna.
- `COMPLETED` significa **"la auditor├¡a se termin├│"**, no "el alumno cumple".
  Qu├® decidi├│ la auditor├¡a se pregunta a `audits.result_json`.
- `ERROR` viene con `audits.error_category` y mensaje sanitizado.

La reutilizaci├│n de dict├ímenes se basa en `audits.evidence_fingerprint`: si el
fingerprint coincide se reutiliza el `COMPLETED`; si cambia la evidencia, se crea
una nueva auditor├¡a. Un ├¡ndice ├║nico parcial evita dos `RUNNING` simult├íneos para
el mismo `(case_id, evidence_fingerprint)`.

---

## API

Todas las rutas son Vercel Functions en `api/**` y comparten `handleRoute` de
`src/server/http.ts`, que aplica **antes del handler** dos guards: resoluci├│n de
sesi├│n (fail-closed) y CSRF en m├®todos mutantes.

`handleRoute` acepta `{ public: true }` solo para las tres rutas marcadas abajo.
InsForge se accede exclusivamente desde el servidor: el navegador nunca recibe
claves ni habla directamente con la plataforma.

| M├®todo | Ruta | Auth | Respuesta |
|---|---|---|---|
| `POST` | `/api/auth/session` | p├║blica | `200 { user }` ÔÇö body `{ email, password }`; setea cookies `httpOnly` |
| `DELETE` | `/api/auth/session` | p├║blica | `204` ÔÇö cierra sesi├│n y limpia cookies |
| `POST` | `/api/auth/refresh` | p├║blica | `200` ÔÇö rota el access token con el refresh |
| `GET` | `/api/cases` | sesi├│n | `200 { cases: CaseSummary[] }` (m├íx. 100) |
| `POST` | `/api/cases` | sesi├│n | `201 { case }` ┬À body `{ studentIdentifier? }` |
| `GET` | `/api/cases/:caseId` | sesi├│n + due├▒o | `200 { case, evidences, audit }` |
| `POST` | `/api/cases/:caseId/evidence` | sesi├│n + due├▒o | `201 { evidence }` ┬À body binario crudo |
| `DELETE` | `/api/cases/:caseId/evidence/:evidenceId` | sesi├│n + due├▒o | `200 { ok: true }` |
| `GET` `POST` | `/api/cases/:caseId/audit` | sesi├│n + due├▒o | `200 { audit }` \| `202 { audit: null, pendingEvidence }` |
| `POST` | `/api/cases/:caseId/comparison` | sesi├│n + due├▒o | `200` ÔÇö lanza el comparador entre dos casos |
| `GET` `POST` | `/api/cases/:caseId/review` | sesi├│n + due├▒o | `GET 200 { review \| null }` ┬À `POST 200 { review }` (revisi├│n humana) |
| `GET` | `/api/evidence/:evidenceId/download` | sesi├│n + due├▒o | `200` binario (`?preview=1` ÔåÆ `inline`) |
| `GET` | `/api/dashboard/summary` | sesi├│n + rol | `200 { summary }` |
| `GET` | `/api/dashboard/quality` | sesi├│n + rol | `200 { quality }` |
| `GET` | `/api/dashboard/ai-costs` | sesi├│n + rol | `200 { costs }` |
| `GET` | `/api/dashboard/options` | sesi├│n + rol | `200 { options }` ÔÇö filtros disponibles |
| `GET` | `/api/health/ai` | p├║blica | Capacidades seguras; no invoca generaci├│n ni expone secretos |

> **No hay sign-up.** Los usuarios se crean en InsForge (CLI o panel) y se
> autoriza el acceso insertando su fila en `app_memberships`. Una cuenta de
> InsForge sin membership recibe `403` en cualquier ruta de la API: no existe
> un estado "registrado pero inactivo" dentro de la aplicaci├│n.

### Detalles del contrato

- **DTOs en camelCase** en toda la API (`studentIdentifier`, `processingStatus`,
  `resultJson`, `createdAt`ÔÇª); la base usa snake_case.
- **Subida de evidencia**: cuerpo binario crudo (sin `multipart`), con headers
  `content-type: <MIME>` y `x-file-name: <nombre URL-encoded>`. El nombre no
  puede ir en el body porque el body *es* el archivo.
- **`POST /audit`** responde `202` con `pendingEvidence: string[]` (ids) cuando
  hay audio todav├¡a transcribi├®ndose; la UI hace polling con `GET /audit`.
- **`GET /audit`** hace *healing*: refresca transcripciones (hasta 10 s) y marca
  `ERROR` las auditor├¡as `RUNNING` abandonadas hace m├ís de 4 minutos (por ejemplo,
  una Function de Vercel cortada a mitad). `GET /api/cases/:caseId` tambi├®n
  refresca transcripciones (hasta 6 s).
- **Idempotencia**: `POST /audit` con un `COMPLETED` existente devuelve ese
  dictamen sin volver a llamar al modelo. El fingerprint de la auditor├¡a se
  calcula sobre el expediente normalizado y la versi├│n del pipeline
  (`AUDIT_PIPELINE_VERSION`), excluyendo campos de control como
  `processing_status`; cambiar cualquiera de los dos invalida el fingerprint.
- **Derivados cacheados**: el texto extra├¡do de un PDF se persiste en
  `evidence.extracted_text` junto a `extraction_pipeline_version`. Si la versi├│n
  no coincide, el derivado se descarta y se vuelve a extraer
  (`DO_NOT_REPROCESS_AI_UNNECESSARILY`).

### Formato de error

```json
{ "error": { "category": "VALIDATION_ERROR", "message": "ÔÇª" } }
```

Categor├¡as (`ErrorCategory` en `src/skills/audit/types.ts`):

`UPLOAD_ERROR` ┬À `TRANSCRIPTION_ERROR` ┬À `AI_PROVIDER_ERROR` ┬À
`INVALID_AI_RESPONSE` ┬À `STORAGE_ERROR` ┬À `DATABASE_ERROR` ┬À `AUTH_ERROR` ┬À
`NOT_FOUND` ┬À `VALIDATION_ERROR` ┬À `UNKNOWN`

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
- **Sesi├│n en cookies `httpOnly`.** Access y refresh token viajan en
  `HttpOnly; Secure; SameSite=Lax; Path=/`. El token **nunca** se decodifica en
  el servidor: la identidad se resuelve_REMOTAMENTE_ contra InsForge
  (`auth.getCurrentUser`). Si el proveedor falla ÔåÆ `503`, nunca an├│nimo.
- **Fail-closed.** Sin cookie, con cookie inv├ílida, o sin fila en
  `app_memberships`, la respuesta es `401`/`403`. No hay ruta que caiga en modo
  invitado por error.
- **CSRF.** Todo m├®todo mutante (`POST`/`PUT`/`PATCH`/`DELETE`) exige que el
  `Origin` coincida con `APP_URL` y que llegue `X-App-Request: 1`. Ambas
  condiciones; sin `Origin` (p. ej. mismo origen en algunos clientes) se rechaza.
- **Autorizaci├│n por due├▒o.** Cada ruta de caso pasa por
  `getScopedCaseOr404`/`assertCaseOwner`. Un caso ajeno devuelve **404, no 403**:
  responder 403 confirmar├¡a que el identificador existe.
- **Roles.** `user` y `coordinator` salen de `app_memberships`. Un rol
  desconocido se trata como "sin permiso" (fail-closed), no como `user`.

### Entrada no confiable

- **Validaci├│n MIME en servidor.** Solo `image/png`, `image/jpeg`, `image/webp`,
  `image/gif`, `application/pdf`, `text/plain` y cualquier `audio/*`. Cualquier
  otro tipo ÔåÆ `400 UPLOAD_ERROR`.
- **Firma real del archivo (magic bytes).** El MIME declarado **no** basta:
  `verifyFileSignature` compara los primeros bytes con la firma del formato
  declarado antes de cualquier efecto (cuota, Storage, insert). PDF `PK`/`MZ`/
  ELF/shebang bajo un `text/plain` tambi├®n se rechazan, porque ser├¡a la v├¡a para
  colar un binario o un script como "texto".
- **L├¡mite de tama├▒o**: 4 MB por evidencia (`MAX_EVIDENCE_BYTES`), por debajo del
  l├¡mite de body de Vercel. Excedido ÔåÆ `413 UPLOAD_ERROR`.
- **Nombres de archivo saneados**: sin rutas ni caracteres de control; la key de
  storage incluye `caseId` + UUID, as├¡ que un nombre no controla la ruta ni
  colisiona.
- **Las evidencias son DATOS, nunca instrucciones.** Adem├ís del bloque expl├¡cito
  anti prompt-injection del system prompt
  (`EVIDENCE_IS_DATA_NOT_INSTRUCTIONS`), `src/skills/sanitize.ts` **cerca**
  mec├ínicamente el contenido no confiable: neutraliza delimitadores de tipo y de
  cerca de c├│digo que el contenido pudiera usar para cerrar el bloque y fingir
  hablar en nombre del sistema (`sanitizeTagDelimiters`,
  `sanitizeFenceDelimiters`, `wrapUntrusted`).
- **Sanitizaci├│n tambi├®n en el encabezado del expediente**: el nombre del archivo
  se sanea antes de aparecer en `## Evidencia: <nombre>`, porque un nombre de
  archivo es un vector de inyecci├│n tan v├ílido como el cuerpo.

### Cuotas

- **Cuotas de admisi├│n** (`src/server/quotas.ts`) resueltas por la funci├│n SQL
  `admit_or_reject_quota`, no en memoria de proceso (`NO_PROCESS_LOCAL_DURABILITY`).
- **Sujeto hasheado**: correo e IP se hashean con HMAC (`hashQuotaSubject`) antes
  de persistirse. La base nunca ve la direcci├│n IP ni el correo en claro.
- **Fail-closed con la sem├íntica correcta**: si la RPC de cuota responde
  malformada o con un booleano que no es booleano, se devuelve **503**, no 429.
  Confundir "no pude preguntar" con "te pasaste" produce un 429 falso y oculta
  una ca├¡da de infraestructura.
- **Auditor├¡as y comparaciones** cobran cuota antes de invocar al modelo.
- **Audio**: la cuota se cobra **antes** de subir a Storage e insertar la fila,
  para que un `429` nunca deje bytes hu├®rfanos ni una evidencia sin due├▒o.
- **Login**: cuota por correo y por IP. La IP se toma de los headers del proxy y
  solo se acepta si es IPv4/IPv6 literal; nunca se persiste en crudo.

### Datos y diagn├│stico

- **Diagn├│stico IA sin contenido.** Se guarda modelo, formato, status, c├│digos
  saneados, latencia, tokens, coste y categor├¡a; no prompt, archivos ni PII.
- **Sin PII en Git.** `cases.student_identifier` es un dato personal: se guarda
  (la auditor├¡a lo necesita) pero no aparece en ning├║n `INSERT` del repositorio.
- **Procedimiento inmutable.** `policy/` no se edita; se *serializa* a
  `policy-v5.generated.ts` con su SHA-256 en el prompt.
- **Sin dependencias de estado en memoria de proceso**: el run es durable desde
  la fila `audits` en `RUNNING`, creada **antes** de llamar al modelo.
- **Errores sin fuga**: `sendError` traduce a un `ErrorCategory` cerrado y nunca
  expone stack traces. Los mensajes del proveedor se sanean (se ocultan
  `api_key`, `secret`, `token`, `authorization`) y se truncan a 300 caracteres.

### Checklist operativo antes de abrir a usuarios

En `docs/REPOSITORY_AUDIT.md` est├í el detalle. Lo m├¡nimo que falta resolver en
la instancia existente antes de habilitar login:

1. Aplicar las migraciones pendientes (`migrations/*.sql` posteriores al baseline).
2. Crear y poblar `app_memberships` para los usuarios autorizados.
3. Hacer backfill de los casos con `created_by IS NULL` (quedan invisibles bajo
   RLS) al custodio que corresponda.
4. Aplicar en el bucket de Storage una pol├¡tica **owner-scoped**; sin ella,
   conocer la ruta del objeto basta para descargarlo.
5. Rotar el secreto `sk-ÔÇª` que qued├│ en el historial Git (commit `569d8ca`).

Detalle operativo completo: `SECURITY.md`.

### L├¡mites duros

| L├¡mite | Valor |
|---|---|
| `MAX_AGENT_STEPS` | 12 |
| `MAX_TOOL_CALLS` | 20 |
| `MAX_REVIEW_ROUNDS` | 2 |
| `MAX_PROVIDER_ATTEMPTS` | 2 llamadas OpenRouter como m├íximo por auditor├¡a |

Al alcanzar un l├¡mite, el run termina en error tipado. Nunca se inicia otro run
autom├íticamente.

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
(`scripts/dev-api.mjs`), as├¡ que en desarrollo no hay mock ni backend paralelo.

> En Windows, si PowerShell bloquea `npm`, usa `npm.cmd`.

Scripts disponibles:

| Script | Qu├® hace |
|---|---|
| `npm run dev` | Vite + API de desarrollo (`predev` regenera la policy) |
| `npm run build` | `tsc` + `vite build` ÔåÆ `dist` (`prebuild` regenera la policy) |
| `npm run preview` | Sirve `dist` |
| `npm run typecheck` | `tsc` sin emitir |
| `npm test` / `npm run test:watch` | Vitest |
| `npm run test:contract` | Contratos OpenRouter, capabilities, schema y referencias |
| `npm run test:ai-smoke` | Auditor├¡a sint├®tica real contra OpenRouter; requiere credencial configurada |
| `npm run verify:release` | Secret scan, typecheck, contracts, toda la suite y build |
| `npm run verify:release:live` | Release gate local m├ís smoke real facturable |
| `npm run policy:generate` | Compila `policy/` ÔåÆ `src/skills/audit/policy-v5.generated.ts` |

El smoke live est├í separado de los tests unitarios y usa un caso y evidencia
ficticios en almacenamiento en memoria; no escribe datos en InsForge. Puede
generar coste de modelo. No se ejecuta autom├íticamente en CI.

Cada PR y push a `main` ejecuta `npm run verify:release`, que incluye los
contract checks cr├¡ticos aunque TypeScript compile. Los tests unitarios no
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

- Las **Functions** viven en `api/**` y se despliegan autom├íticamente.
- `api/cases/[caseId]/audit/index.ts` exporta `export const maxDuration = 300`.
  `TOTAL_AUDIT_TIMEOUT_MS` (240 s por defecto) debe quedar por debajo de ese
  techo; cada intento usa `min(AI_TIMEOUT_MS, tiempo restante)`.
- **No hace falta rewrite de fallback para la SPA**: el enrutado es por hash
  (`#/`, `#/casos/:id`), as├¡ que el navegador solo pide `/`, `/index.html`,
  `/assets/*` y `/api/*`. Un rewrite `/(.*) ÔåÆ /index.html` ser├¡a innecesario y
  podr├¡a confundir el enrutado de las Functions.
- CI (`.github/workflows/ci.yml`): `npm ci` ÔåÆ `typecheck` ÔåÆ `test` ÔåÆ `build`.

### Variables de entorno en Vercel

Configurar en *Project Settings ÔåÆ Environment Variables* (todas server-side, sin
prefijo). Ver `.env.example` para el detalle de cada una. M├¡nimas:

```
INSFORGE_BASE_URL=https://4pw4jdzv.us-west.insforge.app
INSFORGE_ANON_KEY=ÔÇª
OPENROUTER_API_KEY=ÔÇª
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
   20261001010000_case-reviewer-name.sql
   20261002000000_auth_core.sql
   20261003000000_paid_admissions.sql
   20261003010000_derived_extractions.sql
   ```

   `20260930020000_ÔÇª` **requiere** que `20260930010000_human-resolution.sql` est├®
   aplicada. Ninguna migraci├│n destructiva: todas son `CREATE ÔÇª IF NOT EXISTS` o
   `ALTER TABLE ÔÇª ADD COLUMN`.

2. Crear el bucket de Storage `evidencias` (lo crea la CLI, no el SQL) y
   revisarle la pol├¡tica de acceso (owner-scoped).
3. Configurar las variables de entorno en Vercel.
4. Crear los usuarios en InsForge e **insertar su fila en `app_memberships`**
   (no hay sign-up en la aplicaci├│n).
5. Comprobar el escenario completo: crear caso ÔåÆ subir evidencia ÔåÆ auditar ÔåÆ
   ver dictamen ÔåÆ recargar y confirmar que la sesi├│n sobrevive por cookie
   `httpOnly`.
6. Ejecutar `npm run verify:release` localmente y confirmar que
   `scripts/verify-rls-grants.sql` no reporta desviaciones.

---

## Invariantes del proyecto

- `POLICY_IS_IMMUTABLE`: el procedimiento oficial `GDM_GAM_PRD_MLG_003` v5 y las
  fuentes oficiales del owner determinan el criterio. `policy/` se serializa,
  no se edita.
- `ONLY_OWNER_PROVIDED_POLICY_SOURCES`: no buscar ni usar pol├¡tica encontrada en
  internet.
- `TEMPLATE_IS_NOT_POLICY`: `Dictamen.pdf` no es fuente normativa.
- `HISTORICAL_CASES_ARE_NOT_POLICY`: los casos hist├│ricos muestran pr├íctica, no
  crean reglas.
- `LEGACY_IS_NOT_POLICY`: el historial Git puede consultarse, pero no revive
  criterios normativos.
- `AI_ANALYZES_WITH_CONTEXT`: la IA lee el expediente y el procedimiento V5
  inyectado, cita evidencia y propone assessment estructurado.
- `NO_RULES_ENGINE`: no reintroducir policy engine, rules engine, fact engine
  obligatorio, rule evaluation ni cat├ílogos ejecutables de reglas.
- `TRACE_EVERY_DECISION`: toda conclusi├│n importante enlaza evidencia y secci├│n
  del procedimiento.
- `PRESERVE_EVIDENCE_PROVENANCE`: nunca modificar originales; todo derivado
  conserva hash y origen.
- `NO_PII_IN_GIT`: evidencias reales e hist├│ricos con PII quedan fuera de Git.
- `NO_PROCESS_LOCAL_DURABILITY`: auditor├¡as y estados durables no dependen de
  memoria de proceso.
- `DO_NOT_REPROCESS_AI_UNNECESSARILY`: si la evidencia y sus derivados no
  cambian, reutilizar outputs durables.
- `KEEP_IT_SIMPLE`: monolito modular; sin microservicios ni infraestructura
  distribuida innecesaria.

Reglas de trabajo: documentaci├│n y UI en espa├▒ol; toda conclusi├│n normativa
cita documento, versi├│n, secci├│n y p├ígina cuando existe; no usar
`INDETERMINADO` como resultado normal (la evidencia insuficiente se expresa con
`EVIDENCIA_INSUFICIENTE` + `missingEvidence`); no crear capas de compatibilidad
para arquitectura eliminada.

Ver `AGENTS.md` para la versi├│n completa y de referencia.

---

## Documentaci├│n relacionada

| Documento | Qu├® cubre |
|---|---|
| `AGENTS.md` | Invariantes, l├¡mites duros y reglas de trabajo. Referencia normativa del repo. |
| `SECURITY.md` | Superficie de ataque, modelo de confianza, pol├¡tica de reporte de vulnerabilidades. |
| `CONTRIBUTING.md` | Flujo de trabajo, contrato de commits, qu├® exige un PR para mergear. |
| `PRODUCT.md` | Qu├® es el producto y qu├® no decide el c├│digo. |
| `docs/architecture.md` | Arquitectura por capas y flujo de una auditor├¡a. |
| `docs/AUDIT_PIPELINE.md` | Expediente, fingerprint, idempotencia, l├¡mites y fallback de modelo. |
| `docs/DATABASE.md` | Esquema, RLS, funciones de cuota y verificaci├│n de grants. |
| `docs/DEPLOYMENT.md` | Deploy, migraciones, variables de entorno y rollback. |
| `docs/PRODUCTION-RUNBOOK.md` | Qu├® hacer cuando algo falla en producci├│n. |
| `docs/TROUBLESHOOTING.md` | Errores frecuentes y su causa real. |
| `docs/REPOSITORY_AUDIT.md` | Auditor├¡a integral: hallazgos, correcciones y pendientes. |
| `docs/MIGRATION-PLAN.md` | Estado de la migraci├│n a la arquitectura actual. |
| `migrations/00000000000000_baseline.sql` | El esquema, comentado secci├│n por secci├│n. |
| `policy/` | Procedimiento oficial `GDM_GAM_PRD_MLG_003` v5, indexado por secci├│n. Inmutable. |

`docs/migration-ai-native.md` es un documento hist├│rico del dise├▒o previo a la
consolidaci├│n en un solo paquete: se conserva por trazabilidad, no es
especificaci├│n vigente.
