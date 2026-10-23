import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { loadEnv } from 'vite';
import { CopilotClient } from '@github/copilot-sdk';

Object.assign(process.env, loadEnv('development', process.cwd(), ''));
const token = process.argv.includes('--use-gh-cli')
  ? execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', windowsHide: true }).trim()
  : process.env.COPILOT_GITHUB_TOKEN?.trim();
if (!token) throw new Error('Configura COPILOT_GITHUB_TOKEN en .env.local o usa --use-gh-cli con una sesión de GitHub CLI.');
const root = await mkdtemp(join(tmpdir(), 'cancelaciones-copilot-check-'));
const client = new CopilotClient({ mode: 'empty', baseDirectory: root, workingDirectory: root, gitHubToken: token, useLoggedInUser: false, logLevel: 'none' });
const timeout = setTimeout(() => { void client.forceStop().finally(() => process.exit(1)); }, 30_000);
try {
  await client.start();
  const auth = await client.getAuthStatus();
  const models = auth.isAuthenticated ? await client.listModels() : [];
  console.log(JSON.stringify({ authenticated: auth.isAuthenticated, source: auth.authType,
    models: models.filter(model => model.policy?.state === 'enabled').map(model => ({ id: model.id, vision: model.capabilities.supports.vision,
      maxAttachments: model.capabilities.limits.vision?.max_prompt_images, mediaTypes: model.capabilities.limits.vision?.supported_media_types })) }, null, 2));
  if (!auth.isAuthenticated) process.exitCode = 1;
} catch {
  console.error('No se pudo verificar la conexión de Copilot. Comprueba la sesión y los permisos de la cuenta.');
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  await client.stop().catch(() => undefined);
  const local = relative(tmpdir(), root);
  if (local && !local.startsWith('..') && !isAbsolute(local)) await rm(root, { recursive: true, force: true }).catch(() => undefined);
}
