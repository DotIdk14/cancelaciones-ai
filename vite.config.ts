import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// Import ESTÁTICO (no dinámico) a propósito: `configureServer` debe registrar el
// middleware de forma síncrona y un `await import(...)` lo volvería asíncrono.
// El módulo es puro (solo define y exporta una función), así que cargarlo
// también durante `vite build` es inofensivo.
import { createDevApiMiddleware } from './scripts/dev-api.mjs';

// La SPA y la API se sirven juntas:
//  - `vite dev` monta /api a través de `dev-api.mjs` (mismos handlers que Vercel).
//  - `vite build` emite `dist` para Vercel (output de la SPA).

const devApiPlugin: Plugin = {
  name: 'dev-api',
  apply: 'serve',
  configureServer(server) {
    // NO devolver la función desde `configureServer`: Vite la ejecutaría como
    // post-hook y la registraría DETRÁS de sus middlewares internos
    // (transform -> serveStatic -> htmlFallback), por lo que `/api/*` nunca
    // llegaría al handler y `serveStatic` serviría el archivo .ts desde disco.
    // El registro tiene que ser síncrono y directo.
    server.middlewares.use(createDevApiMiddleware(server));
  },
};

export default defineConfig(({ mode }) => {
  // Vite solo publica en `import.meta.env` las variables con prefijo `VITE_`, y
  // aquí no puede haber ninguna (AGENTS.md: sin secretos en el cliente). Los
  // handlers de `/api` leen `process.env` a través de `src/server/env.ts`, así
  // que volcamos `.env*` al proceso del dev server con el loader nativo de Vite.
  // El prefijo vacío hace que se carguen TODAS las variables. No sobreescribimos
  // lo que ya venga del entorno real (shell, CI), que siempre tiene prioridad.
  const fileEnv = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(fileEnv)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return {
    plugins: [react(), devApiPlugin],
    build: {
      outDir: 'dist',
      sourcemap: false,
      target: 'es2022',
      rollupOptions: {
        output: {
          manualChunks: undefined,
        },
      },
    },
  };
});
