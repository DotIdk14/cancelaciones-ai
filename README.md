# Cancelaciones AI

Sistema AI-native para analizar expedientes de cancelaciones estudiantiles.

El flujo actual es simple:

1. Crear auditoria.
2. Subir evidencias.
3. Preparar evidencias: texto, PDF, imagen o audio.
4. Ejecutar `CaseAnalyst` con tools.
5. Consultar el procedimiento V5 desde `policy/`.
6. Revisar con `AuditReviewer`.
7. Guardar resultado terminal: `COMPLETED`, `NEEDS_INPUT` o `FAILED`.

No existe rules engine, policy engine, fact run ni engine run.

## Arquitectura

- `apps/web`: Next.js, UI, API routes, auth, storage y job runner HTTP.
- `packages/shared`: estados, limites, schemas Zod, validacion de evidencia, logger y costes.
- `packages/evidence`: preparacion de evidencia sin decidir negocio.
- `packages/ai`: OpenRouter, AssemblyAI, tools, `CaseAnalyst`, `AuditReviewer`, eval dataset.
- `packages/db`: repositorios para `audits`, `evidences`, `jobs`, `audit_runs`, `tool_executions`, `audit_results`.
- `policy/`: procedimiento `GDM_GAM_PRD_MLG_003` v5 indexado por seccion y pagina.
- `migrations/00000000000000_baseline.sql`: baseline unico reproducible.

## Comandos

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm dev
```

## Variables

Ver `.env.example`.

Modelos configurables:

- `OPENROUTER_FAST_MODEL`
- `OPENROUTER_ANALYST_MODEL`
- `OPENROUTER_REVIEWER_MODEL`
- `OPENROUTER_VISION_MODEL`

Audio usa AssemblyAI mediante adapter centralizado.

## Seguridad

- Evidencias reales y datos con PII no se versionan.
- Los originales no se modifican; se conserva SHA-256.
- Los runs terminales no se reescriben.
- No hay retries infinitos: `MAX_PROVIDER_ATTEMPTS = 2`.
- No hay loops infinitos: `MAX_AGENT_STEPS`, `MAX_TOOL_CALLS` y `MAX_REVIEW_ROUNDS` son limites duros.
