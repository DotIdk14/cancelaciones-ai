import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// La SPA y la API se sirven juntas:
//  - `vite dev` monta /api a través de `dev-api.mjs` (mismos handlers que Vercel).
//  - `vite build` emite `dist` para Vercel (output de la SPA).

const devApiPlugin: Plugin = {
  name: 'dev-api',
  apply: 'serve',
  configureServer(server) {
    return async () => {
      const { createDevApiMiddleware } = await import('./scripts/dev-api.mjs');
      server.middlewares.use(createDevApiMiddleware(server));
    };
  },
};

export default defineConfig({
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
});