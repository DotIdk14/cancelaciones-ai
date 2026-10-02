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

/**
 * Nombra el chunk pesado de gráficas.
 *
 * Sin esto Rollup deriva el nombre del ÚLTIMO módulo de su recorrido, y el
 * chunk compartido de ~374 kB (Recharts + Redux/Immer, alcanzable desde las
 * tres páginas del dashboard) salía llamado `chartTheme-*.js` por casualidad:
 * `chartTheme.ts` era su última dependencia. El nombre era correcto y el
 * archivo mentía, que es la peor combinación para quien lea el build después.
 */
function chartChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  if (id.includes('recharts') || id.includes('react-redux') || id.includes('@reduxjs')) {
    return 'recharts';
  }
  if (id.includes('immer') || id.includes('reselect') || id.includes('decimal.js')) {
    return 'recharts';
  }
  return undefined;
}

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
          manualChunks: chartChunk,
        },
      },
    },
  };
});
