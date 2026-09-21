# AGENTS.md

## Invariantes permanentes

- POLICY_IS_IMMUTABLE: GDM_GAM_PRD_MLG_003 y fuentes normativas oficiales del propietario determinan que corresponde.
- ONLY_OWNER_PROVIDED_POLICY_SOURCES: no buscar ni usar politica encontrada en internet.
- TEMPLATE_IS_NOT_POLICY: Dictamen.pdf solo define como se entrega el reporte.
- HISTORICAL_CASES_ARE_NOT_POLICY: los CaVe historicos muestran practica, no crean reglas.
- LEGACY_IS_NOT_POLICY: el repositorio legacy puede reutilizar tecnica, no criterios normativos.
- AI_EXTRACTS: la IA clasifica, lee, transcribe y estructura evidencia.
- POLICY_ENGINE_DECIDES: el motor normativo aplica reglas oficiales con datos estructurados.
- UNKNOWN_IS_NOT_FALSE: ausencia de evidencia no equivale a condicion falsa.
- TRACE_EVERY_DECISION: toda decision debe enlazar regla, condicion, hecho y evidencia.
- CANONICAL_REPORT_TEMPLATE: Dictamen.pdf es la plantilla oficial de salida; el generador no debe sustituirla por un reporte alternativo.
- PRESERVE_EVIDENCE_PROVENANCE: nunca modificar originales; todo derivado conserva hash y origen.
- PRESERVE_MACHINE_DECISION: una correccion humana no sobrescribe la decision de maquina.
- OPERATIONAL_PRECEDENCE_IS_NOT_POLICY: cualquier prioridad aprobada por OWNER debe almacenarse y mostrarse separada de la fuente normativa.
- DO_NOT_DUPLICATE_IMPLEMENTATIONS: una sola implementacion por capacidad.
- INSPECT_BEFORE_IMPLEMENTING: inspeccionar fuentes, plantilla, historicos y legacy antes de sustituir.
- REMEDIATE_BEFORE_ADVANCING: no construir sobre una fase rota.
- NO_PII_IN_GIT: evidencias reales e historicos con PII quedan fuera de Git.
- NO_PROCESS_LOCAL_DURABILITY: auditorias, jobs, decisiones y estados durables nunca pueden depender exclusivamente de memoria del proceso.
- DO_NOT_REPROCESS_AI_UNNECESSARILY: una vez extraidos y persistidos los hechos, reevaluar el motor no debe volver a consumir IA salvo que cambie la evidencia que lo requiera.
- KEEP_IT_SIMPLE: monolito modular, sin infraestructura innecesaria para ~50 auditorias/dia.

## Reglas de trabajo

- Documentacion, frontend y reportes en espanol.
- Codigo tecnico puede usar ingles si mejora claridad.
- Toda regla productiva debe citar fuente exacta: documento, version, seccion y pagina.
- Los casos historicos solo pueden ser golden case si se validan explicitamente contra la fuente normativa.
- El motor normativo debe ser puro, determinista, testeable y desacoplado de React, Next.js, InsForge, OpenRouter, AssemblyAI, filesystem y HTTP.

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
