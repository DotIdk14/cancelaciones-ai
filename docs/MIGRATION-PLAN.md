# Plan de migración — Cancelaciones3 → arquitectura AI-native Skills (React + Vite + Vercel)

> Documento de trabajo. Se actualiza a medida que avanza la migración.
> **Estado actual: migración completada en código. Pendiente la verificación en
> el entorno de destino (InsForge + Vercel).**

## Diagnóstico del estado actual (hecho)

| Hecho verificado | Consecuencia |
|---|---|
| El repo es un **monorepo pnpm** (`apps/web` + `packages/{ai,db,evidence,shared}`) sobre **Next.js 15 App Router** | Hay que migrar a **React + Vite** y a **Vercel Functions** (`/api`) |
| **NO existe** `src/rules-engine/*` ni `src/tools/extract-facts.ts` (ya fue eliminado en `569d8ca refactor: migrar a arquitectura ai-native`) | La sección 2 del encargo ya está **cumplida**: no hay rules engine que retirar |
| La base tiene **12 tablas** con cola durable (`jobs`, `job_attempts`, `job_artifacts`), `audit_runs`, `tool_executions`, `ai_call_log`, `audit_log`, `audit_manual_comments` | La sección 15 pide **3 tablas**: `cases`, `evidence`, `audits`. Hay que reescribir el baseline |
| `vercel.json` declara `framework: nextjs` y `outputDirectory: apps/web/.next` | Hay que reescribir a `framework: vite` + `outputDirectory: dist` |
| `.env.example` usa `NEXT_PUBLIC_*` y 4 modelos de OpenRouter | Hay que reescribir con los nombres del encargo (`OPENROUTER_MODEL`, `INSFORGE_BASE_URL`, …) |
| `policy/` con V5 indexado por sección (26 secciones, ~60 KB) existe y es correcto | **Se conserva intacto** (invariante `POLICY_IS_IMMUTABLE`) |
| No hay `node_modules` instalado | Hay que instalar y verificar build |

## Decisiones de arquitectura

1. **Un solo paquete en la raíz.** Se elimina el monorepo. Una sola arquitectura, sin capas paralelas.
2. **`src/skills/audit/`** = toda la inteligencia: `instructions.ts`, `procedure-v5.ts`, `schema.ts`, `execute.ts`, `types.ts`.
3. **`src/server/openrouter.ts`** con una única función `callOpenRouterAudit(...)`. Sin `AIProvider`/`ModelRouter`/`AuditEngine`.
4. **InsForge = datos y archivos.** El navegador **nunca** habla con InsForge: todo pasa por `/api/*`, que corre en Vercel. Cero `VITE_INSFORGE_*`.
5. **Auth server-side** por cookies httpOnly + RLS de InsForge → se cumple "protección contra acceso a caseId de terceros".
6. **Procedimiento V5 se compila a un módulo TS** (`scripts/generate-policy.mjs` → `policy-v5.generated.ts`) porque el runtime de Vercel no resuelve globs ni `?raw`.
7. **Coste real, nunca inventado**: se lee `usage.cost` de OpenRouter; si no viene, `null`.

### Decisiones tomadas durante la ejecución

Estas no estaban en el plan original y se adoptaron al implementarlo:

8. **Un solo modelo de IA con cascada de formato, no 4 modelos por rol.** El plan original asumía un modelo por rol (fast/analyst/reviewer/vision). La ejecución usa `OPENROUTER_MODEL` + `OPENROUTER_FALLBACK_MODEL`, y la robustez se consigue con la cascada de `response_format` (json_schema strict → json_object, en cada modelo), en vez de con cuatro modelos distintos. Razón: la salida se valida con Zod de todos modos, así que el modelo no necesita especializarse por rol.
9. **Hash routing en vez de react-router.** `src/lib/useHashRoute.ts` enruta `#/` y `#/casos/:id` sin librería. Razón: con hash routing no hace falta rewrite de fallback de SPA en Vercel, y un refresh siempre funciona.
10. **El "agent loop" del plan se resolvió como una llamada única y estructurada.** El encargo hablaba de `CaseAnalyst` con tools, `MAX_AGENT_STEPS`, `MAX_TOOL_CALLS` y `AuditReviewer`. En la ejecución, `auditSkill.execute()` hace **una** llamada a OpenRouter con el procedimiento completo en el system prompt, el expediente como partes de contenido y `response_format: json_schema` estricto. Los límites duros siguen declarados en `AGENTS.md` como invariantes del producto, pero no hay bucle de tools que los alcance. La trazabilidad exigida (`TRACE_EVERY_DECISION`) se cumple por el schema: `facts[].evidenceIds`, `facts[].evidenceText`, `timeline[].evidenceIds`, `audit.supportingEvidenceIds`, `audit.procedureSection`.
11. **API montada en dev con un plugin de Vite** (`scripts/dev-api.mjs` + plugin `devApiPlugin` en `vite.config.ts`) en vez de con `vercel dev`. Razón: los handlers son los mismos de `api/**`, sin mock ni backend paralelo, y `npm run dev` sigue siendo un solo comando.
12. **El run es durable sin cola**: la fila `audits` en `RUNNING` se inserta **antes** de llamar al modelo, y `GET /audit` hace *healing* (marca `ERROR` los `RUNNING` con más de 4 min). Esto satisface `NO_PROCESS_LOCAL_DURABILITY` sin reintroducir `jobs`/`job_attempts`.

## Fases

| # | Fase | Estado |
|---|---|---|
| 1 | Investigar capacidades reales de OpenRouter (JSON schema, PDF, multimodal) | ✅ Hecho — confirmado `response_format: json_schema` con `strict`, `provider.require_parameters`, y envío nativo de PDF vía `type: 'file'` + `file_data` data URI |
| 2 | Andamiaje raíz: package.json, vite, tsconfig, tailwind, eslint, index.html | ✅ Hecho — paquete npm único, `package.json` con `predev`/`prebuild` |
| 3 | `src/skills/audit/*` (types, schema, procedure-v5, instructions, execute) | ✅ Hecho |
| 4 | `src/server/*` (env, insforge, openrouter, assemblyai, evidence-prep, http) | ✅ Hecho — más `auth.ts`, `cases.ts`, `dto.ts`, `audit-service.ts`, `pdf.ts` |
| 5 | `/api/*` (cases, evidence, audit, auth) | ✅ Hecho — 10 handlers en `api/**` |
| 6 | `migrations/` reescrito a 3 tablas + RLS | ✅ Hecho — `migrations/00000000000000_baseline.sql` (3 tablas, 4 índices, 12 políticas, trigger `set_updated_at` solo en `cases`, verificación en 13 controles) |
| 7 | UI React adaptada a `AuditResult` | ✅ Hecho — hash routing, 9 componentes, polling de auditoría, panel de dictamen con hechos/cronología/contradicciones |
| 8 | Tests (Vitest) de las piezas críticas | ✅ Hecho — 38 tests en 7 archivos (`schema`, `instructions`, `execute`, `openrouter`, `http`, `routes`, `evidence-prep`) |
| 9 | Instalar, typecheck, test, build | ✅ Hecho — `tsc` sin errores, 38/38 tests verdes, `vite build` emite `dist` |
| 10 | Borrar monorepo viejo; verificar sin código muerto | ✅ Hecho — borrados `apps/`, `packages/`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`; queda **un solo** `package.json` y **un solo** lockfile (`package-lock.json`) |
| 11 | `.env.example`, `vercel.json`, README, CI | ✅ Hecho — `.env.example` reescrito con los 12 nombres de `src/server/env.ts` (+ `AI_TIMEOUT_MS` de `openrouter.ts`), `vercel.json` con `framework: vite`, README completo, `.github/workflows/ci.yml` con `npm ci` → typecheck → test → build |

### Cambios sobre el plan original (recap)

- **React 19, no React 18** (lo fijó `package.json` al crear el andamiaje).
- **`policy/` se conserva y además se compila**: `policy/` sigue siendo la fuente
  normativa inmutable; `src/skills/audit/policy-v5.generated.ts` es su
  serialización, regenerada en `predev`/`prebuild` y commiteada.
- **`docs/setup/insforge.md` quedó desactualizado**: aún describe variables
  `NEXT_PUBLIC_*` y un bucket `dictamen-evidencias` de la fase 1. La realidad es
  `INSFORGE_BASE_URL` / `INSFORGE_ANON_KEY` y el bucket `evidencias`.
- **`INSFORGE_API_KEY` queda declarada y cacheada en `src/server/env.ts` pero
  hoy no la consume ningún módulo**: el producto funciona íntegro con el rol
  `authenticated` del usuario y RLS. Se mantiene en `.env.example` como
  opcional/reservada.

## Estado final

Migración completada en el repositorio:

- **Un solo paquete npm** (`cancelaciones-ai`) con React 19 + Vite 6 + TS, sin
  workspaces, sin Next.js, sin segundo lockfile.
- **Backend server-side en Vercel Functions** (`api/**` + `src/server/**`). El
  navegador no tiene ninguna credencial: cero variables `VITE_*` /
  `NEXT_PUBLIC_*`.
- **AI-native real**: `src/skills/audit/` es la única fuente de inteligencia.
  Sin rules engine, sin policy engine, sin cola de jobs, sin RPC de negocio.
  El dictamen es la salida del modelo validada con Zod
  (`AuditResultSchema`, `strict`); el backend no reclasifica.
- **Procedimiento V5** (26 secciones, SHA-256 `71faf646…c7d2`) inyectado íntegro
  en el contexto del modelo en cada auditoría.
- **Esquema AI-native** de 3 tablas con 12 políticas RLS
  (`created_by = auth.uid()`), trigger `updated_at` solo en `cases` y bloque de
  verificación que aborta la migración si el esquema no cuadra.
- **Sin PII en Git**: la migración no inserta datos; el binario vive en
  InsForge Storage.
- **Verificación local en verde**: `npm run typecheck` sin errores,
  `npm test` 38/38.

## Verificación pendiente en deploy

Nada de esto se puede comprobar sin el entorno real:

1. **Ejecutar la migración SQL en InsForge** antes del primer deploy:
   `migrations/00000000000000_baseline.sql` (usar la CLI de InsForge, ver
   `docs/setup/insforge.md`). Debe terminar sin `RAISE EXCEPTION`; si la base
   tiene el esquema legacy, la guardia `AI_NATIVE_BASELINE_LEGACY_PRESENT` la
   rechaza a propósito (aplicar sobre una base vacía).
2. **Crear el bucket de Storage `evidencias`** con la CLI (no lo crea el SQL) y
   confirmar que su nombre coincide con `INSFORGE_STORAGE_BUCKET`.
3. **Setear los secrets en Vercel** (server-side, sin prefijo): `INSFORGE_BASE_URL`,
   `INSFORGE_ANON_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`,
   `APP_URL` con la URL real del despliegue (activa `Secure` en las cookies y
   `HTTP-Referer` en OpenRouter). Opcionales: `OPENROUTER_FALLBACK_MODEL`,
   `ASSEMBLYAI_API_KEY`, `MAX_EVIDENCE_BYTES`,
   `TRANSCRIPTION_POLL_TIMEOUT_MS`, `AI_TIMEOUT_MS`, `INSFORGE_API_KEY`.
4. **Confirmar que `policy/` está completa** antes de compilar en Vercel:
   `npm run policy:generate` debe reportar 26 secciones; si falta `manifest.json`
   o alguna sección, el script sale con código 1 y el build falla (correcto).
5. **Escenario completo en Vercel**: sign-up → crear caso → subir evidencia
   (PDF/PNG) → auditar → ver dictamen con hechos, cronología, contradicciones y
   sección del procedimiento.
6. **Refresh de página en el caso abierto**: valida el hash routing *y* que la
   sesión sobrevive por cookie `httpOnly` (no debe pedir login otra vez).
7. **Audio end-to-end** (requiere `ASSEMBLYAI_API_KEY`): subir un audio →
   `TRANSCRIBING` → `READY` con transcripción y hablantes, y que la auditoría
   responda `202` mientras transcribe.
8. **Aislamiento entre usuarios**: con una segunda cuenta, comprobar que
   `GET /api/cases/:caseId` de un caso ajeno devuelve `404` (RLS, no `403`).
9. **Coste real**: verificar que `audits.result_json.usage` trae el consumo
   reportado por OpenRouter, y que sale `null` (no `0` inventado) cuando el
   proveedor no lo reporta.
10. **Aislamiento de secretos**: comprobar en la pestaña Network del navegador
    que no sale ninguna petición a `4pw4jdzv.us-west.insforge.app` ni a
    `openrouter.ai` — solo a `/api/*` del propio origen.
