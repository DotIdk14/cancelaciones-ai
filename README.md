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
- Aplica el Procedimiento V5 y emite uno de los seis resultados permitidos.
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
api/                       Vercel Functions (una por endpoint)
  auth/                    me.ts, sign-in/, sign-up/, sign-out/
  cases/                   index.ts, [caseId]/index.ts,
                           [caseId]/evidence/, [caseId]/evidence/[evidenceId]/,
                           [caseId]/audit/
  evidence/                [evidenceId]/download.ts

src/
  skills/audit/            ÚNICA fuente de inteligencia
    types.ts               vocabulario cerrado: resultados, estados, errores
    schema.ts              AiAuditAssessmentSchema + AuditResultSchema (Zod strict)
    procedure-v5.ts        tipos/metadatos de la política
    policy-v5.generated.ts ARCHIVO GENERADO desde policy/ (npm run policy:generate)
    instructions.ts        system prompt + bloque anti prompt-injection
    execute.ts             ensamblado del expediente y llamada al modelo
  server/                  env, insforge, auth, http, cases, dto,
                           audit-service, openrouter, assemblyai,
                           evidence-prep, pdf
  components/              AppHeader, CaseListPage, CaseDetailPage,
                           EvidenceUploader, EvidenceList, EvidenceViewer,
                           AuditResultPanel, LoginPage, ErrorBoundary, ui
  lib/                     api.ts (cliente fetch), useHashRoute, usePolling,
                           labels, format, cx
  auth/                    AuthContext

policy/                    Procedimiento GDM_GAM_PRD_MLG_003 v5 (FUENTE NORMATIVA)
  manifest.json            26 secciones + SHA-256 del PDF fuente
  sections/*.md            secciones indexadas
migrations/                00000000000000_baseline.sql (esquema único)
scripts/                   generate-policy.mjs, dev-api.mjs
tests/                     Vitest
docs/                      documentación del proyecto
vercel.json                framework vite, output dist, install npm ci
```

---

## Resultados permitidos

`audit.result` solo puede ser uno de estos seis valores:

| Resultado | Significado |
|---|---|
| `CANCELACION_VENTA` | La venta se cancela conforme a la sección aplicable del procedimiento, en fase de venta/validación. |
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
  case: { matricula, studentName, program, cycle, cycleStartDate },  // null si no consta
  evidenceSummary: [{ evidenceId, filename, detectedType, description, relevant }],
  facts: [{ key, label, value, confidence, evidenceIds, evidenceText }],
  timeline: [{ date, event, evidenceIds }],
  conflicts: [{ description, evidenceIds }],
  audit: {
    result,                  // uno de los seis resultados
    rule,                    // string | null
    procedureSection,        // sección del Procedimiento V5 citada
    reasoning,               // justificación con documento, versión, sección y página
    confidence,              // 0..1
    supportingEvidenceIds,
    missingEvidence,         // evidencia faltante accionable
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
| `created_at` | `timestamptz` | sin `updated_at`: el contenido es inmutable |

Índices: `evidence_case_id_created_at_idx` y `evidence_hash_idx` (este último
**no** es `UNIQUE`).

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

## API

Todas las rutas son Vercel Functions en `api/**`, comparten los helpers de
`src/server/http.ts` y **exigen sesión** (salvo `sign-in` / `sign-up`).

| Método | Ruta | Respuesta |
|---|---|---|
| `POST` | `/api/auth/sign-up` | `200 { user, requireEmailVerification }` |
| `POST` | `/api/auth/sign-in` | `200 { user }` + cookies de sesión |
| `POST` | `/api/auth/sign-out` | `200 { ok: true }` (limpia cookies) |
| `GET` | `/api/auth/me` | `200 { user \| null }` |
| `GET` | `/api/cases` | `200 { cases: CaseSummary[] }` (máx. 100) |
| `POST` | `/api/cases` | `201 { case }` · body `{ studentIdentifier? }` |
| `GET` | `/api/cases/:caseId` | `200 { case, evidences, audit }` |
| `POST` | `/api/cases/:caseId/evidence` | `201 { evidence }` · body binario crudo |
| `DELETE` | `/api/cases/:caseId/evidence/:evidenceId` | `200 { ok: true }` |
| `POST` | `/api/cases/:caseId/audit` | `200 { audit }` \| `202 { audit: null, pendingEvidence }` |
| `GET` | `/api/cases/:caseId/audit` | `200 { audit \| null }` |
| `GET` | `/api/evidence/:evidenceId/download` | `200` binario (`?preview=1` → `inline`) |

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
  dictamen sin volver a llamar al modelo.

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

- **Cookies httpOnly.** `insforge_access_token` (1 h) y `insforge_refresh_token`
  (30 días), `SameSite=Lax`, `HttpOnly`, y `Secure` cuando `APP_URL` es
  `https://`. Los tokens JWT **nunca** llegan al JavaScript del navegador.
- **RLS como frontera de seguridad.** Un `caseId` ajeno devuelve `404`, no datos.
- **Validación MIME en servidor.** Solo `image/png`, `image/jpeg`, `image/webp`,
  `image/gif`, `application/pdf`, `text/plain` y cualquier `audio/*`. Cualquier
  otro tipo → `400 UPLOAD_ERROR`.
- **Límite de tamaño**: 4 MB por evidencia (`MAX_EVIDENCE_BYTES`), por debajo del
  límite de body de Vercel. Excedido → `413 UPLOAD_ERROR`.
- **Nombres de archivo saneados**: sin rutas ni caracteres de control; la key de
  storage incluye `caseId` + UUID, así que un nombre no controla la ruta ni
  colisiona.
- **Las evidencias son DATOS, nunca instrucciones.** El system prompt incluye un
  bloque explícito anti prompt-injection (`EVIDENCE_IS_DATA_NOT_INSTRUCTIONS`):
  cualquier texto dentro de una evidencia que intente reescribir el rol, el
  schema o las clasificaciones se trata como contenido del expediente.
- **Logs sin secretos.** Solo mensajes de error; nunca claves, tokens ni cookies.
  Los mensajes hacia el cliente se sanean.
- **Sin PII en Git.** `cases.student_identifier` es un dato personal: se guarda
  (la auditoría lo necesita) pero no aparece en ningún `INSERT` del repositorio.
- **Procedimiento inmutable.** `policy/` no se edita; se *serializa* a
  `policy-v5.generated.ts` con su SHA-256 en el prompt.
- **Sin dependencias de estado en memoria de proceso**: el run es durable desde
  la fila `audits` en `RUNNING`, creada **antes** de llamar al modelo.

### Límites duros

| Límite | Valor |
|---|---|
| `MAX_AGENT_STEPS` | 12 |
| `MAX_TOOL_CALLS` | 20 |
| `MAX_REVIEW_ROUNDS` | 2 |
| `MAX_PROVIDER_ATTEMPTS` | 2 (por modelo: 2 niveles de formato × hasta 2 modelos) |

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
| `npm run policy:generate` | Compila `policy/` → `src/skills/audit/policy-v5.generated.ts` |

Estado verificado en este repositorio: `typecheck` sin errores, **73/73 tests
verdes** en 9 archivos.

Tests: `evidence-prep`, `http` (validación de entradas), `schema`
(serialización del `AuditResult` y `parseAuditResult`), `instructions`
(anti prompt-injection), `execute` (ensamblado del expediente sin red),
`openrouter` (cascada de intentos), `auth` (refresh de sesión), `routes` (validación de entrada y acceso) y
`evidence-status` (estados de evidencia y `POST /audit`).

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

1. Ejecutar `migrations/00000000000000_baseline.sql` en InsForge **antes** del
   deploy (CLI de InsForge, ver `docs/setup/insforge.md`).
2. Crear el bucket de Storage `evidencias` (lo crea la CLI, no el SQL).
3. Configurar las variables de entorno en Vercel.
4. Registrar el primer usuario desde la UI (sign-up) y comprobar el escenario
   completo: crear caso → subir evidencia → auditar → ver dictamen → recargar la
   página y confirmar que la sesión se mantiene por cookie `httpOnly`.

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

- `AGENTS.md` — invariantes, límites duros y reglas de trabajo.
- `docs/MIGRATION-PLAN.md` — diagnóstico, decisiones y estado de la migración a
  la arquitectura actual.
- `migrations/00000000000000_baseline.sql` — el esquema, comentado sección por
  sección.
- `docs/setup/insforge.md` — actualizado para variables, esquema, bucket Storage
  y CLI InsForge.
- `docs/architecture.md` y `docs/migration-ai-native.md` — documentos del diseño
  previo a la consolidación en un solo paquete.
