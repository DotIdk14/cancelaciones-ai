# Desarrollo local

## Requisitos

- Node.js 22.
- pnpm 9.15.4 mediante Corepack.
- Proyecto InsForge vinculado con `.insforge/project.json` local, fuera de Git.

## Instalacion

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
```

## Variables

Copiar `.env.example` a `.env.local` y completar `NEXT_PUBLIC_INSFORGE_ANON_KEY` con el valor del proyecto InsForge.

No versionar `.env.local`.

## Comandos

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Alcance Phase 1

La app permite login, proteccion server-side de rutas privadas, listado de auditorias y creacion de una auditoria minima persistida. No sube evidencias ni ejecuta IA.
