import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const webNextDir = join(process.cwd(), 'apps', 'web', '.next-local');

try {
  rmSync(webNextDir, { recursive: true, force: true });
  console.log('Caché local eliminada: apps/web/.next-local');
} catch (error) {
  console.warn('No fue posible eliminar apps/web/.next-local:', error instanceof Error ? error.message : error);
}

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const child = spawn(command, ['--filter', '@cancelaciones/web', 'exec', 'next', 'dev', '--turbo'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    LOCAL_DEMO: '1',
    NEXT_PUBLIC_LOCAL_DEMO: '1',
    NEXT_PUBLIC_INSFORGE_URL: process.env.NEXT_PUBLIC_INSFORGE_URL ?? 'https://local-demo.invalid',
    NEXT_PUBLIC_INSFORGE_ANON_KEY: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? 'local-demo-anon-key',
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? 'local-demo-openrouter-key',
    NEXT_DIST_DIR: '.next-local',
  },
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
