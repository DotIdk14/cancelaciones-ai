# Phase 1 Report

## Estado

PASS_WITH_WARNINGS

## Arquitectura elegida

Next.js full-stack en monorepo pnpm.

## Motivo

Next.js reduce piezas frente a React + API separada: server components, server actions, middleware y route handlers permiten auth server-side, persistencia y rutas privadas sin un servicio API paralelo. Es suficiente para ~50 auditorias/dia y un usuario simultaneo inicial.

## Stack final

TypeScript strict, Next.js 15, React 19, Tailwind CSS 3.4, pnpm workspaces, Vitest, ESLint, InsForge SDK.

## Package Manager

pnpm 9.15.4 via Corepack.

## Monorepo

- `apps/web`: app web Next.js.
- `packages/domain`: tipos y contratos de dominio independientes de React/Next/InsForge.
- `packages/db`: repositorios y data access compatible con InsForge.

## App

UI minima en espanol: login, auditorias, nueva auditoria. No incluye uploads, IA ni reglas.

## InsForge

Proyecto vinculado: `Cancelaciones`, API base `https://4pw4jdzv.us-west.insforge.app`. La creacion de un proyecto nuevo fallo por limite externo del plan Free; se uso el proyecto existente.

## Auth

Implementada con `@insforge/sdk/ssr`: server actions para login/logout, refresh route y middleware. Rutas privadas protegidas server-side. La validacion end-to-end de credenciales requiere usuario real.

## Database

Migracion aplicada para `profiles`, `audits`, `audit_log` y `policy_sources`. Lectura y escritura DB validadas con datos sinteticos mediante CLI.

## Migrations

Mecanismo oficial: InsForge CLI migrations en `migrations/`. Archivo: `20260921221309_phase-1-base-schema.sql`.

## Storage

Bucket privado existente `dictamen-evidencias` validado como baseline. Upload real queda fuera de scope hasta Phase 2.

## Data Model

Modelo actualizado en `docs/architecture/data-model.md` y decisiones de persistencia en `docs/architecture/persistence.md`.

## Audit Persistence

Existe tabla `audits` con `id`, `status`, `external_case_id`, `created_by`, `created_at`, `updated_at`. App crea auditorias autenticadas mediante repositorio centralizado.

## Environment

`.env.example` creado. Validacion con Zod en `apps/web/src/server/config/env.ts`. Secrets reales no versionados.

## Security

Revisado en `docs/security/phase-1-security-review.md`.

## Legacy Reuse

No se copio UI legacy. Se reutilizaron criterios tecnicos: InsForge server-side, RLS, storage privado y no traer componentes fuera de scope.

## Tests

PASS. Vitest cubre transiciones de lifecycle tecnico y repositorio Audit con cliente compatible.

## Lint

PASS. Ejecutado desde root con `pnpm lint`.

## Typecheck

PASS. Ejecutado desde root con `pnpm typecheck`.

## Build

PASS. Ejecutado desde root con `pnpm build`.

## CI

Agregado GitHub Actions basico en `.github/workflows/ci.yml`.

## Archivos creados

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `.env.example`
- `apps/web/**`
- `packages/domain/**`
- `packages/db/**`
- `.github/workflows/ci.yml`
- `docs/setup/local-development.md`
- `docs/setup/insforge.md`
- `docs/architecture/persistence.md`
- `docs/security/phase-1-security-review.md`
- `docs/reports/phase-1-report.md`
- `docs/phase-prompts/phase-2.md`

## Archivos modificados

- `AGENTS.md` actualizado automaticamente por InsForge CLI con bloque de backend.
- `.gitignore` actualizado automaticamente por InsForge CLI para `.insforge/` y carpetas de agentes.
- `docs/adr/001-application-architecture.md`
- `docs/architecture/data-model.md`

## Comandos ejecutados

- `npx -y @insforge/cli current --json`
- `npx -y @insforge/cli create --name "Cancelaciones AI" --region us-east --template empty`
- `npx -y @insforge/cli list --json`
- `npx -y @insforge/cli link --project-id 9e29e329-252e-481c-a632-95b71ee3df51 -y`
- `npx -y @insforge/cli memory list --json`
- `npx -y @insforge/cli db migrations new phase-1-base-schema`
- `npx -y @insforge/cli db migrations up --all`
- `npx -y @insforge/cli db query ...`
- `npx -y @insforge/cli storage buckets`
- `corepack enable`
- `corepack prepare pnpm@9.15.4 --activate`
- `pnpm install`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `git status --short` devolvio que el workspace no es repositorio Git.
- Revision de `.env*`: solo existe `.env.example`.
- Revision de historicos CaVe: solo existen en `private-historical/`, ruta ignorada por `.gitignore`.

## Limitaciones

- No se valido login con credenciales humanas porque no se crearon usuarios ni se solicitaron contrasenas.
- La creacion de proyecto InsForge nuevo fue bloqueada por limite externo del plan Free; se uso el proyecto existente `Cancelaciones`.

## Riesgos

- Si el proyecto InsForge existente contiene tablas legacy, se debe evitar mezclar datos productivos sin revision.
- La politica de OWNER depende de poblar `profiles.role` correctamente.

## Blockers

Ninguno para Phase 2.

## Technical Debt

La validacion automatizada de auth end-to-end queda pendiente hasta contar con usuario de prueba controlado.

## Proxima fase

`docs/phase-prompts/phase-2.md`
