import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';

const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : 'development';
if (!mode || !['development', 'preview', 'production'].includes(mode)) {
  console.error('Uso: node scripts/run-ai-smoke.mjs [--mode development|preview|production]');
  process.exit(2);
}
Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
if (!process.env.OPENROUTER_API_KEY?.trim()) {
  console.error('AI smoke no ejecutado: configura OPENROUTER_API_KEY en el entorno local o .env.local.');
  process.exit(2);
}
if (!process.env.OPENROUTER_MODEL?.trim()) {
  console.error('AI smoke no ejecutado: configura OPENROUTER_MODEL con un ID verificado del catálogo OpenRouter.');
  process.exit(2);
}

const vitest = resolve('node_modules/vitest/vitest.mjs');
const result = spawnSync(process.execPath, [vitest, 'run', 'tests/ai-smoke.live.test.ts'], {
  stdio: 'inherit',
  env: { ...process.env, RUN_AI_SMOKE: '1' },
});
process.exit(result.status ?? 1);