import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';

const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : 'development';
if (!mode || !['development', 'preview', 'production'].includes(mode)) {
  console.error('Uso: node scripts/run-ai-smoke.mjs [--mode development|preview|production] [--schema-only]');
  process.exit(2);
}
Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
const providerIndex = process.argv.indexOf('--provider');
const provider = providerIndex >= 0 ? process.argv[providerIndex + 1] : 'openrouter';
if (!provider || !['openrouter', 'github-copilot'].includes(provider)) {
  console.error('Proveedor de prueba no válido: usa --provider openrouter|github-copilot.');
  process.exit(2);
}
process.env.AI_PROVIDER_MODE = provider;
if (!process.env.OPENROUTER_API_KEY?.trim()) {
  console.error('AI smoke no ejecutado: configura OPENROUTER_API_KEY en el entorno local o .env.local.');
  process.exit(2);
}
if (!process.env.OPENROUTER_MODEL?.trim()) {
  console.error('AI smoke no ejecutado: configura OPENROUTER_MODEL con un ID verificado del catálogo OpenRouter.');
  process.exit(2);
}

const vitest = resolve('node_modules/vitest/vitest.mjs');
const nameIndex = process.argv.indexOf('--test-name');
const testName = nameIndex >= 0 ? process.argv[nameIndex + 1] : undefined;
if (nameIndex >= 0 && !testName) throw new Error('Falta el nombre de la prueba.');
const targets = provider === 'github-copilot'
  ? ['tests/ai-smoke.live.test.ts']
  : process.argv.includes('--schema-only')
  ? ['tests/provider-schema.live.test.ts']
  : ['tests/ai-smoke.live.test.ts', 'tests/provider-schema.live.test.ts'];
// Evita reservas de saldo simultáneas entre pruebas de pago y mantiene el coste acotado.
const result = spawnSync(process.execPath, [vitest, 'run', ...targets, '--maxWorkers=1', '--minWorkers=1', ...(testName ? ['--testNamePattern', testName] : [])], {
  stdio: 'inherit',
  env: { ...process.env, RUN_AI_SMOKE: '1' },
});
process.exit(result.status ?? 1);
