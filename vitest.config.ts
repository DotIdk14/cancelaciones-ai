import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: process.env.RUN_AI_SMOKE === '1' ? {} : { AI_PROVIDER_MODE: 'openrouter', COPILOT_GITHUB_TOKEN: '' },
    include: ['tests/**/*.test.{ts,tsx}'],
    globals: false,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
});
