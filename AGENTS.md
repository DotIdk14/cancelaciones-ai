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

- `api/`: Vercel Functions, una por endpoint (`auth`, `cases`, `cases/:caseId/evidence`, `audits`, `evidence/download`). Sin logica de negocio: validan, delegan y traducen errores.
- `src/skills/audit/`: **unica fuente de inteligencia**. `types.ts` (vocabulario cerrado de resultados, estados y categorias de error), `schema.ts` (`AiAuditAssessmentSchema` y `AuditResultSchema` Zod `strict` + parsers tipados), `instructions.ts` (system prompt y bloque anti prompt-injection), `procedure-v5.ts` y `policy-v5.generated.ts` (procedimiento compilado), `execute.ts` (ensamblado del expediente, llamada al modelo y validacion de referencias). El dictamen ES el assessment validado; el backend no reclasifica, solo agrega metadata tecnica real de OpenRouter.
- `src/server/`: `env.ts`, `insforge.ts` (cliente server-side), `auth.ts` (cookies httpOnly), `http.ts` (errores tipados), `cases.ts` (persistencia), `dto.ts`, `audit-service.ts` (orquestacion durable), `openrouter.ts` (unico transporte de IA), `assemblyai.ts` (solo transcripcion), `evidence-prep.ts` y `pdf.ts` (preparacion tecnica, sin decidir negocio).
- `src/components/`, `src/auth/`: UI con hash routing manual (`#/`, `#/casos/:id`), sin react-router.
- `src/lib/`: `api.ts` (cliente fetch, DTOs camelCase), `useHashRoute.ts`, `usePolling.ts`, `labels.ts`, `format.ts`, `cx.ts`.
- `policy/`: procedimiento `GDM_GAM_PRD_MLG_003` v5 indexado por seccion. Fuente normativa inmutable; `policy-v5.generated.ts` es su serializacion (regenerar con `npm run policy:generate`).
- `migrations/00000000000000_baseline.sql`: baseline unico. 3 tablas (`cases`, `evidence`, `audits`), RLS por `created_by = auth.uid()`, trigger `set_updated_at` solo en `cases`.
- `tests/`: Vitest. `scripts/`: `generate-policy.mjs`, `dev-api.mjs` (monta `/api/*` en el dev server de Vite).

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
- PRESERVE_EVIDENCE_PROVENANCE: nunca modificar originales; todo derivado conserva hash y origen.
- NO_PII_IN_GIT: evidencias reales e historicos con PII quedan fuera de Git.
- NO_PROCESS_LOCAL_DURABILITY: auditorias, jobs, decisions y estados durables no dependen de memoria de proceso.
- DO_NOT_REPROCESS_AI_UNNECESSARILY: si la evidencia y sus derivados no cambian, reutilizar outputs durables.
- KEEP_IT_SIMPLE: monolito modular; sin microservicios ni infraestructura distribuida innecesaria.

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
