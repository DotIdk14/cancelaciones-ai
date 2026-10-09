# AGENTS.md

## Arquitectura actual

El producto es AI-native. No existe policy engine, rules engine, fact run, engine run ni catalogo ejecutable de reglas.

Flujo productivo:

```text
evidencias
  -> preparacion de evidencia
  -> Audit Skill con procedimiento V5 owner-supplied inyectado en contexto
  -> assessment estructurado validado por Zod y referencias
  -> metadata tecnica real de OpenRouter agregada por servidor
  -> resultado terminal
```

Estructura: repositorio de **un solo paquete npm** en la raiz (monorepo pnpm y Next.js eliminados). SPA React + Vite + TypeScript; backend como Vercel Functions en `api/**` con helpers en `src/server/**`.

- `api/`: Vercel Functions, una por endpoint salvo las familias consolidadas: `auth/[action]` sirve `auth/session`, `auth/refresh`, `auth/google` y `auth/google-callback`, y `dashboard/[view]` sirve las cuatro vistas (`summary`, `ai-costs`, `quality`, `options`). El resto son un archivo por endpoint (`cases`, `cases/:caseId/evidence`, `cases/:caseId/audit`, `cases/:caseId/review`, `cases/:caseId/comparison`, `cases/:caseId/area-comments`, `evidence/download`, `health/ai`). Sin logica de negocio: validan, delegan y traducen errores. Todas pasan por `handleRoute` (`src/server/http.ts`), que aplica sesion fail-closed y CSRF (`Origin` + `X-App-Request`) antes del handler; `{ public: true }` solo en las tres rutas de auth y `health/ai`.
- `src/skills/audit/`: **unica fuente de inteligencia**. `types.ts` (vocabulario cerrado de resultados, estados, categorias de error y **origen**: `EVIDENCE_COUNTRIES` / `EVIDENCE_CHANNELS`), `schema.ts` (`AiAuditAssessmentSchema` y `AuditResultSchema` Zod `strict` + parsers tipados; `origin` es requerido y `validateOrigin` rechaza un valor afirmado sin evidencia), `instructions.ts` (system prompt, `ORIGIN_RULES` y bloque anti prompt-injection), `procedure-v5.ts` y `policy-v5.generated.ts` (procedimiento compilado), `execute.ts` (ensamblado del expediente, llamada al modelo y validacion de referencias, incluida `origin.evidenceIds`). El dictamen ES el assessment validado; el backend no reclasifica, solo agrega metadata tecnica real de OpenRouter y **proyecta `origin` a las columnas `cases.country` / `cases.channel`** (best-effort: si falla, el dictamen ya persistido sigue siendo valido).
- `src/skills/sanitize.ts`: cercado mecanico del contenido no confiable (`sanitizeTagDelimiters`, `sanitizeFenceDelimiters`, `wrapUntrusted`, `wrapUntrustedInline`). `src/skills/review/` (revision humana) lo reexporta. Es la unica capa de anti prompt-injection testeable; el system prompt es la capa que depende del modelo.
- `src/server/`: `env.ts`, `insforge.ts` (cliente server-side), `errors.ts` (**modulo hoja**: `ApiError` + `mapProviderError`; existe para romper el ciclo `http -> auth -> insforge` que colgaba la suite de tests; `http.ts` lo reexporta), `http.ts` (helpers de respuesta, cookies, CSRF y sesion), `capabilities.ts` (**modulo hoja**: vocabulario de roles `AppRole` y `capabilitiesForRole`; existe separado de `auth.ts` por `LEAF_MODULES_HAVE_NO_SERVER_IMPORTS` y `auth.ts` lo reexporta), `auth.ts` (Google OAuth con PKCE server-side, sesion por cookie `httpOnly`, `isAllowedEmail`, verificacion remota del token, rol desde `app_memberships`, `assertCaseWriteCapability`), `quotas.ts` (cuotas fail-closed por RPC `admit_or_reject_quota`, sujeto hasheado con HMAC), `derived.ts` (regla pura de vigencia de derivados; modulo hoja por la misma razon que `errors.ts`), `cases.ts` (persistencia; `getScopedCaseOr404` y `assertCaseOwner` resuelven el alcance en codigo), `dto.ts` (`deriveWorkflowState` y `deriveEffectiveResolution`), `audit-service.ts` (orquestacion durable), `comparison-service.ts`, `reviews.ts` (persistencia de `case_reviews` de dos etapas y `case_comparisons`), `area-comments.ts` (bitacora por area: vocabulario cerrado, Zod y UPSERT; no participa en el dictamen), `dashboard.ts`, `dashboard-filters.ts`, `openrouter.ts` (unico transporte de IA), `assemblyai.ts` (solo transcripcion), `evidence-prep.ts` (incluye `verifyFileSignature` por magic bytes) y `pdf.ts` (preparacion tecnica, sin decidir negocio). `src/server/ai/` contiene el contrato con el modelo: `model-capabilities.ts` y `provider-schema.ts`.
- `src/components/`: UI con hash routing manual (`#/`, `#/casos/:id`), sin react-router. `LoginScreen` (solo boton de Google, sin formulario) + `src/lib/useSession.ts` (estado de sesion y lectura de `?authError=`). En el expediente, `CaseDetailPage` compone las tres pestañas: `EvidencePane`/`PdfCanvas` (evidencia), `AuditResultPanel` (**dictamen reducido a regla + seccion + razonamiento**, y al final `<AreaComments caseId={audit.caseId} />`) y el resto de vistas. `AreaComments` carga sus propios datos por `caseId` en vez de recibirlos del padre, para que una falha al leer comentarios no se lleve por delante el dictamen.
- `src/lib/`: `api.ts` (cliente fetch, DTOs camelCase), `useHashRoute.ts`, `usePolling.ts`, `useSession.ts`, `useDashboard.ts`, `dashboard.ts`, `labels.ts`, `format.ts`, `cx.ts`.
- `policy/`: procedimiento `GDM_GAM_PRD_MLG_003` v5 indexado por seccion. Fuente normativa inmutable; `policy-v5.generated.ts` es su serializacion (regenerar con `npm run policy:generate`).
- `migrations/`: baseline inicial del núcleo, 16 migraciones históricas y la migración pendiente `20261009100000_case-list-pagination-indexes.sql`. El esquema remoto contiene además efectos de ocho migraciones posteriores a `20261003010000` que no aparecen en el ledger oficial. No aplicar migraciones hasta seguir `docs/MIGRATION-RECONCILIATION.md`; el baseline no representa por sí solo el esquema vigente.
- `tests/`: Vitest. Dobles compartidos en `tests/helpers/`: `auth.ts` (`fakeAuthContext`), `env.ts` (`setTestEnv`), `fake-database.ts` y `fake-store.ts` (store en memoria que sustituye `cases`/`reviews` sin red). Las verificaciones del esquema viven como bloques `DO $verify$` dentro de los archivos de migración; no hay ejecutor alterno de DDL que omita el registro oficial.
- `insforge.toml`: config declarativa MINIMA de InsForge; solo `auth.allowed_redirect_urls` (destinos de retorno de Google OAuth). Se versiona a mano, nunca un `config export` completo: aplana `null` a ceros y un `apply` posterior los mandaria de vuelta como si fueran intencionales.

No hay sign-up: los usuarios se crean en InsForge y el acceso se autoriza por fila en `app_memberships`; sin fila, `403`.

### Roles y capacidades

Tres roles persistidos en `app_memberships.role` (vocabulario cerrado, `CHECK` en la base y `isAppRole` en `src/server/capabilities.ts`). `user` es el identificador que ya existía y **se presenta como "Asesor"**; no se renombra ni se migra:

| Rol | Presentación | `canReadAllCases` | `canReviewOwnCases` | `canFinalizeAnyCase` | `canWriteOwnedCases` |
| --- | --- | --- | --- | --- | --- |
| `user` | Asesor | no | sí | no | sí |
| `coordinator` | Coordinador | sí | no | sí | sí |
| `manager` | Gerente | sí | no | no | no |

La autorización se decide SIEMPRE con `capabilitiesForRole(role)`, nunca con un `if (role === 'user')` repartido por los endpoints: preguntar "¿TIENE la capacidad?" y no "¿el rol es exactamente este?" es lo que evita congelar el vocabulario en cada guard. Rol desconocido, `null` o `undefined` → `DENY_ALL_CAPABILITIES` (fail-closed). Los dos guards de casos son `assertCaseWriteCapability` (capacidad antes que propiedad: un Gerente no muta ni su propio caso) y `assertCaseOwner` (propiedad: un caso ajeno es `404`).

**La frontera NO es la RLS.** El servidor lee y escribe con el cliente administrativo (`project_admin`, BYPASSRLS): para él las políticas no aplican y `created_by` no restringe nada. Por eso el alcance y los permisos se resuelven en código (`getScopedCaseOr404` + los guards) y la RLS queda como defensa en profundidad ante una fuga de cookie.

### Revisión humana de dos etapas

El flujo tiene dos etapas y el estado se **deriva en lectura** de la fila de `case_reviews` (nunca es una columna ni `cases.status`):

```text
sin fila                    -> PENDING_ADVISOR      (falta la decisión del Asesor)
fila sin coordinator_decision -> PENDING_COORDINATOR (falta la finalización del Coordinador)
fila con coordinator_decision -> FINALIZED
```

- **Asesor** (`canReviewOwnCases`, solo su caso): `POST /api/cases/:id/review { result, comment? }` → `201` y abre la comparación IA (etapa única e inmutable; un segundo intento es `409`).
- **Coordinador** (`canFinalizeAnyCase`, cualquier caso): `POST ... { decision: 'APPROVE' | 'CHANGE', resolution?, comment? }` → `200`. `APPROVE` conserva la resolución del Asesor; `CHANGE` exige `resolution` distinta. La decisión del coordinador se guarda APARTE (`coordinator_decision`, `coordinator_resolution`, `coordinator_created_by`, `coordinator_created_at`, `coordinator_comment`); la del Asesor (`result`) no se toca.
- **Gerente**: lee, pero `POST /review` es `403`.

El actor y la hora los deriva el servidor de `req.auth`; ningún campo de atribución viaja en el cuerpo (los schemas son `strict`). La comparación evalúa si el dictamen de IA coincide con la resolución humana; no reclasifica ni sustituye el dictamen original.

### `cases.is_test`

Cada caso lleva `is_test boolean NOT NULL DEFAULT false` (real = `false`). El **servidor** excluye las pruebas de las métricas operativas en SQL (`.eq('is_test', false)` y las vistas de dashboard `... WHERE is_test = false`), no la base: la columna solo guarda la marca y no participa en `audits.result_json`. Un caso creado sin la marca es real; los casos históricos recibieron `false` al añadir la columna.

### Vista previa local de roles (solo presentación)

`?preview=dashboard&role=user|coordinator|manager&workflow=PENDING_ADVISOR|PENDING_COORDINATOR|FINALIZED` (`src/lib/local-ui-preview.ts`) solo se lee en desarrollo y **nunca llama a la API ni resuelve sesión**: cambiar el rol del preview no altera ninguna autorización real. Los rótulos (`Asesor`/`Coordinador`/`Gerente`) viven en `ROLE_LABELS` (`src/lib/useSession.ts`) y tampoco habilitan capacidades.

InsForge (DB + Storage) es **solo server-side**: el navegador nunca habla con el. OpenRouter es la unica IA. Toda secret vive en el servidor y **no existe ninguna variable de entorno con prefijo `VITE_` o `NEXT_PUBLIC_`**.

## Invariantes permanentes

- POLICY_IS_IMMUTABLE: el procedimiento oficial `GDM_GAM_PRD_MLG_003` v5 y fuentes oficiales del owner determinan el criterio.
- ONLY_OWNER_PROVIDED_POLICY_SOURCES: no buscar ni usar politica encontrada en internet.
- TEMPLATE_IS_NOT_POLICY: `Dictamen.pdf` no es fuente normativa.
- HISTORICAL_CASES_ARE_NOT_POLICY: casos historicos muestran practica, no crean reglas.
- LEGACY_IS_NOT_POLICY: el historial Git puede consultarse, pero no revive criterios normativos.
- AI_ANALYZES_WITH_CONTEXT: la IA lee el expediente y procedimiento V5 inyectado, cita evidencia y propone assessment estructurado.
- NO_RULES_ENGINE: no reintroducir policy engine, rules engine, fact engine obligatorio, rule evaluation ni catalogos ejecutables de reglas.
- TRACE_EVERY_DECISION: toda conclusion importante debe enlazar evidencia y seccion del procedimiento cuando aplique.
- ORIGIN_IS_CLOSED_VOCABULARY: pais y canal de origen son vocabulario cerrado validado por Zod, no texto libre. `null` significa "no determinable" y es un resultado valido; un valor afirmado exige `origin.evidenceIds`. Nunca se deducen del codigo postal, del dominio del correo ni de la moneda.
- PROJECTION_IS_NOT_THE_DICTAMEN: `cases.country` / `cases.channel` son una proyeccion del dictamen para poder filtrar, no la fuente de verdad. La fuente es `audits.result_json`, y un fallo al proyectar no invalida un dictamen ya persistido.
- PRESERVE_EVIDENCE_PROVENANCE: nunca modificar originales; todo derivado conserva hash y origen.
- NO_PII_IN_GIT: evidencias reales e historicos con PII quedan fuera de Git.
- NO_PROCESS_LOCAL_DURABILITY: auditorias, jobs, decisions, cuotas y estados durables no dependen de memoria de proceso.
- DO_NOT_REPROCESS_AI_UNNECESSARILY: si la evidencia y sus derivados no cambian, reutilizar outputs durables.
- KEEP_IT_SIMPLE: monolito modular; sin microservicios ni infraestructura distribuida innecesaria.
- AREA_COMMENTS_ARE_HUMAN_NOT_POLICY: los comentarios por area (`case_area_comments`) son bitacora escrita por personas. No crean criterio ni participan como evidencia. Desde la fase de comentarios BO/HelpDesk, SOLO `BACK_OFFICE` y `HELPDESK` se inyectan al expediente (en `buildAuditInputs`, cercados con `wrapUntrusted` de `src/skills/sanitize.ts`, con regla `AREA_COMMENTS_ARE_NOT_POLICY` en el system prompt y snapshot de lo inyectado en `audits.result_json.areaComments`). `SCHOOL_SERVICES`, `FINANCE` y `ADDITIONAL` nunca cruzan al modelo: siguen siendo bitacora pura.
- AREA_COMMENTS_ARE_WRITABLE_BY_OWNER_ONLY: un `coordinator` puede LEER cualquier caso (visibilidad global de auditoria) pero no escribir en el ajeno. El endpoint resuelve el alcance con `getScopedCaseOr404` **y** `assertCaseOwner`; la RLS sola no alcanza porque el servidor escribe como superusuario. Un caso ajeno se responde 404, nunca 403.
- ROLES_ARE_CAPABILITIES_NOT_NAMES: la autorizacion se decide con `capabilitiesForRole`, nunca con `if (role === 'user')` repartido. Un rol fuera del vocabulario (`user`/`coordinator`/`manager`), `null` o `undefined` recibe `DENY_ALL_CAPABILITIES` (fail-closed). El rol se resuelve en el servidor desde `app_memberships`; no se escala por contenido de fila ni por texto del cliente.
- CAPABILITY_GUARDS_ARE_THE_BOUNDARY: la frontera de autorizacion son los guards en codigo (`assertCaseWriteCapability`, `assertCaseOwner`, `getScopedCaseOr404` y la resolucion de etapa de `/review`). **No es la RLS**: el servidor escribe como `project_admin` (BYPASSRLS) y para el las politicas no aplican. La RLS es defensa en profundidad, no la barrera primaria.
- TWO_STAGE_REVIEW_IS_DERIVED: el flujo humano tiene dos etapas (Asesor -> Coordinador) y su estado (`PENDING_ADVISOR`/`PENDING_COORDINATOR`/`FINALIZED`) se DERIVA en lectura con `deriveWorkflowState` de la fila de `case_reviews`, no es una columna ni reutiliza `cases.status`. La decision del Asesor (`result`) es inmutable y no se sobrescribe con la del Coordinador (`coordinator_decision`/`coordinator_resolution`).
- IS_TEST_EXCLUDED_FROM_METRICS: `cases.is_test` marca pruebas y el SERVIDOR las excluye de las metricas operativas en SQL (`is_test = false`), no la base. La columna no participa en `audits.result_json`; un caso sin la marca es real y los historicos quedaron en `false`.
- NO_LEGACY_HUMAN_REVIEW_CODE: no reintroducir `case_human_reviews` ni la semantica `decision_type APPROVE|CORRECT` (codigo muerto eliminado: `src/server/human-review.ts`, `src/components/HumanReviewPanel.tsx`, `src/skills/review-schema.ts`). La revision humana viva es `case_reviews` de dos etapas.
- HOBBY_FUNCTION_BUDGET: el plan de Vercel es Hobby, que admite **12 Functions por deployment**; como este proyecto usa Vite (sin framework con bundling de API), cada archivo de `api/` es una Function. Mantener `api/` en 12 archivos o menos. El limite se verifica al SUBIR el output, no al compilar: el build termina bien y el deploy falla con `readyState: ERROR` sin mensaje en el log. Si hace falta una Function mas, consolidar la familia en un segmento dinamico (`[view]`, `[action]`) antes que subir de plan. **Estado: 12 de 12, sin margen.** Cualquier endpoint nuevo exige consolidar una familia en un segmento dinamico en el mismo cambio.
- VALIDATE_BEFORE_EFFECT: toda validacion de entrada no confiable (MIME, magic bytes, cuota, tamano) ocurre **antes** de escribir en Storage o en la base. Validar despues deja objetos huerfanos y filas inconsistentes.
- FAIL_CLOSED: sesion, rol y cuotas fallan cerradas. Un servicio que no responde da `503`, nunca un `200` con permisos relajados ni un `429` que en realidad es una caida de infraestructura.
- NO_RESOURCE_EXISTENCE_LEAK: un recurso ajeno se responde `404`, no `403`. Un `403` confirma que el identificador existe.
- QUOTA_SUBJECT_IS_HASHED: todo sujeto de cuota se hashea con HMAC antes de persistirse. La base nunca lo ve en claro. Con Google OAuth el unico sujeto que se admite es la IP (el correo solo se conoce tras el canje, y entonces Google ya autentico).
- NO_SIGNUP: el alta de usuarios y la autorizacion de acceso ocurren en InsForge, no en la aplicacion.
- GOOGLE_ONLY_LOGIN: el login es exclusivamente Google OAuth con PKCE, iniciado y canjeado en el servidor. No reintroducir login por contrasena: `POST /api/auth/session` es solo DELETE.
- ALLOWED_EMAIL_DOMAIN_IS_NOT_AUTHORIZATION: `isAllowedEmail` (`<cuenta>@utel.edu.mx` exacto) es condicion necesaria del login, no suficiente. La autorizacion real sigue siendo la fila en `app_memberships`: un correo institucional sin fila recibe 403.
- OAUTH_VERIFIER_STAYS_SERVER_SIDE: el `codeVerifier` de PKCE viaja solo en cookie `httpOnly` y se borra al canjear, tambien en el camino feliz. Un callback sin verifier es 400 y no toca el proveedor de identidad.
- OAUTH_REVOKES_ON_REJECTION: si el canje abre sesion pero el login se rechaza, hay que cerrarla en InsForge antes de responder. Un rechazo no puede dejar sesion viva.
- OAUTH_REDIRECT_TARGET_IS_SERVER_DERIVED: todo destino de redirect se compone con `APP_URL`, nunca con `Host` ni con un parametro de la request. Los retornos validos se declaran en `insforge.toml` (`allowed_redirect_urls`) y deben coincidir con `oauthCallbackUrl()`.
- LEAF_MODULES_HAVE_NO_SERVER_IMPORTS: modulos que los tests sustituyen por completo (`errors.ts`, `derived.ts`) no importan nada del servidor. Un ciclo de imports aqui cuelga la suite sin fallar.
- NO_SILENT_STALL: un presupuesto de espera acorta cuanto se espera, nunca si se observa. Si el tiempo se agota antes de leer el estado, el estado terminal (`ERROR`) no se propaga, el caso queda en `202` para siempre y el usuario no recibe ningun error que explique la espera. Toda espera acotada lee al menos una vez.

## Limites duros

- `MAX_AGENT_STEPS = 12`
- `MAX_TOOL_CALLS = 20`
- `MAX_REVIEW_ROUNDS = 2`
- `MAX_PROVIDER_ATTEMPTS = 2`

Cuando se alcanza un limite, el run debe terminar en `NEEDS_INPUT` o `FAILED`. Nunca iniciar otro run automaticamente.

## Reglas de trabajo

- Documentacion y UI en espanol.
- Codigo tecnico puede usar ingles si mejora claridad.
- Toda conclusion normativa debe citar documento, version, seccion y pagina cuando exista.
- No usar `INDETERMINADO` como resultado normal. Usar `NEEDS_INPUT` con evidencia faltante accionable.
- No crear capas de compatibilidad para arquitectura eliminada.
- Si aparece vocabulario `FactRun`, `EngineRun`, `RuleEvaluation`, `sourceCompleteness` o `UNKNOWN_IS_NOT_FALSE`, revisar si es residuo legacy y eliminarlo salvo razon actual explicita.

<!-- INSFORGE:START -->
## InsForge backend

This project uses [InsForge](https://insforge.dev): an all-in-one, open-source Postgres-based backend (BaaS) that gives this app a database, authentication, file storage, edge functions, realtime, an AI model gateway, and payments through one platform.

- **Project:** **Cancelaciones** (API base `https://4pw4jdzv.us-west.insforge.app`)
- **Skills:** these InsForge skills are installed for supported coding agents. Reach for them before implementing any InsForge feature instead of guessing the API:
  - `insforge`: app code with the `@insforge/sdk` client (database CRUD, auth, storage, edge functions, realtime, AI, email, and Stripe payments).
  - `insforge-cli`: backend and infrastructure via the `insforge` CLI (projects, SQL, migrations, RLS policies, storage buckets, functions, secrets, payment setup, schedules, deploys).
  - `insforge-debug`: diagnosing failures (SDK/HTTP errors, RLS denials, auth and OAuth issues) and running security or performance audits.
  - `insforge-integrations`: wiring external auth providers (Clerk, Auth0, WorkOS, Better Auth, etc.) for JWT-based RLS, or the OKX x402 payment facilitator.
  - `find-skills`: discovering additional skills on demand.
- **Credentials:** app code reads keys from `.env.local`; the CLI reads `.insforge/project.json`. Never hardcode or commit keys.

Key patterns:

- Database inserts take an array: `insert([{ ... }])`.
- Reference users with `auth.users(id)`; use `auth.uid()` in RLS policies.
- For storage uploads, persist both the returned `url` and `key`.
<!-- INSFORGE:END -->
