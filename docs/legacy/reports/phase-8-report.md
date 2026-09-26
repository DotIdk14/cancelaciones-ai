# Phase 8 Report

## Frontend Visual System

Phase 8 incorpora un refinamiento visual del frontend existente sin rediseñar el producto ni cambiar backend, Policy Engine, Facts, Engine Runs, snapshots o Dictamen.

- Dirección visual: dark mode minimalista, operacional y neutral; sin sidebar global, neón, gradientes ni sombras fuertes.
- Tokens: `apps/web/src/app/globals.css` centraliza `--background`, `--surface-1`, `--surface-2`, `--surface-3`, `--border`, `--text-primary`, `--text-secondary`, `--text-muted`, `--accent`, `--success`, `--warning` y `--danger`; Tailwind los expone desde `apps/web/tailwind.config.ts`.
- Tipografía: `Geist` configurada en `apps/web/src/app/layout.tsx` como familia sans-serif única.
- Layout: `apps/web/src/app/(private)/layout.tsx` mantiene header superior discreto y aprovecha ancho amplio; no se agregó sidebar.
- Audit List: `apps/web/src/app/(private)/auditorias/page.tsx` usa tabla dark minimalista, controles compactos y acciones discretas.
- Evidence Viewer / Audit Workspace: `apps/web/src/app/(private)/auditorias/[auditId]/components/AuditWorkspace.tsx` reorganiza el detalle como estación fija de tres columnas: evidencias, visor central e inspector derecho dinámico. Las tabs `Dictamen`, `Reglas` y `Comentarios` sólo cambian el panel derecho; evidencias y visor permanecen visibles.
- Dictamen: el inspector muestra la resolución en grande y mantiene visible la acción `Resolución / Descarga del dictamen` en el header del caso.
- Componentes modificados/reutilizados: `AuditStatusBadge`, `MachineDecisionCard`, `ManualCommentsPanel`, `EvidenceSelector`, además de los componentes Phase 7 existentes integrados en el detalle.
- Visualización local: se agregó modo `LOCAL_DEMO=1` con datos sintéticos no productivos para revisar `/auditorias` y `/auditorias/local-demo-audit-001` sin conexión a InsForge. El script `pnpm dev:local` limpia `apps/web/.next` antes de arrancar para evitar errores de caché como módulos faltantes de webpack.

## Validation Status

PASS en esta ejecución:

- `pnpm.cmd lint`
- `pnpm.cmd typecheck`
- `pnpm.cmd test`
- `pnpm.cmd build`
