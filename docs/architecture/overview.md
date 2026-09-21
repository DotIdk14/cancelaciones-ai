# Arquitectura general

## Decision

Usar monorepo TypeScript con monolito modular. Next.js en Vercel es la opcion preferida inicial para web/API por simplicidad operativa, rutas server-side y despliegue directo. InsForge cubrira auth, database y storage privado. Los procesos largos se modelaran como jobs durables persistidos, no como estado en memoria.

## Modulos conceptuales

- `apps/web`: frontend y API server-side.
- `packages/domain`: tipos compartidos del dominio.
- `packages/policy-engine`: motor normativo puro.
- `packages/evidence`: ingesta, hashes, derivados y provenance.
- `packages/ai`: OpenRouter, AssemblyAI, validacion de structured output y costos.
- `packages/reporting`: generacion de Dictamen.pdf.

## Regla clave

La capa de IA nunca alimenta texto libre directamente al motor. Todo pasa por schemas validados y facts normalizados.
