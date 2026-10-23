import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import type { ModelInfo } from '@github/copilot-sdk';
import type { OpenRouterContentPart } from '../openrouter.js';
import { getEnv } from '../env.js';
import { ApiError } from '../errors.js';

function unsupported(message: string, detail: string): never {
  const error = new ApiError(502, 'UNSUPPORTED_MODEL_CAPABILITY', message);
  error.failurePath = 'evidence.attachments';
  error.sanitizedDetail = detail;
  throw error;
}

/** Solo capacidad técnica: no transforma, descarta ni interpreta evidencia. */
export function assertCopilotParts(parts: readonly OpenRouterContentPart[], model: ModelInfo): void {
  const media = parts.filter(part => part.type !== 'text');
  if (!media.length) return;
  const vision = model.capabilities.limits.vision;
  if (!model.capabilities.supports.vision || !vision || !Number.isInteger(vision.max_prompt_images)
    || vision.max_prompt_images < 1 || !Number.isFinite(vision.max_prompt_image_size) || vision.max_prompt_image_size < 1) {
    unsupported('El modelo de Copilot no admite las evidencias visuales del expediente.', 'modelo sin capacidad visual');
  }
  for (const part of media) {
    const source = part.type === 'file' ? part.file.file_data : part.image_url.url;
    const match = /^data:(image\/[a-z0-9.+-]+|application\/pdf);base64,([a-z0-9+/=\r\n]+)$/i.exec(source);
    if (!match || !vision.supported_media_types.includes(match[1]!.toLowerCase())
      || Buffer.byteLength(match[2]!, 'base64') > vision.max_prompt_image_size) {
      unsupported(part.type === 'file' ? 'El modelo de Copilot no admite este PDF original. No se omitió el documento.'
        : 'Una imagen excede las capacidades verificadas de Copilot. No se omitió evidencia para emitir el dictamen.',
      'tipo o tamano de adjunto no admitido');
    }
  }
  if (media.length > vision.max_prompt_images) {
    unsupported(`El expediente contiene ${media.length} adjuntos y Copilot admite ${vision.max_prompt_images}. No se omitió evidencia.`,
      `adjuntos recibidos ${media.length} - maximo permitido ${vision.max_prompt_images}`);
  }
}

/** Consulta de catálogo sin inferencia, con plazo acotado y runtime aislado. */
export async function readCopilotModels(deadlineMs: number): Promise<ModelInfo[]> {
  const env = getEnv();
  const lookupDeadline = Math.min(deadlineMs, Date.now() + 10_000);
  const timeoutMs = lookupDeadline - Date.now();
  if (timeoutMs <= 0) throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Se agotó el plazo para comprobar las capacidades de Copilot.');
  const root = await mkdtemp(join(tmpdir(), 'cancelaciones-copilot-capabilities-'));
  const { CopilotClient } = await import('@github/copilot-sdk');
  const childEnv = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'COPILOT_CLI_PATH']
    .flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
  const client = new CopilotClient({ mode: 'empty', baseDirectory: root, workingDirectory: root,
    gitHubToken: env.COPILOT_GITHUB_TOKEN ?? undefined, useLoggedInUser: false, env: childEnv,
    logLevel: 'none', telemetry: { captureContent: false } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  try {
    const operation = async () => {
      await client.start();
      if (cancelled || Date.now() >= lookupDeadline) throw new Error('CAPABILITY_DEADLINE');
      if (!(await client.getAuthStatus()).isAuthenticated) throw new Error('COPILOT_AUTH_REQUIRED');
      if (cancelled || Date.now() >= lookupDeadline) throw new Error('CAPABILITY_DEADLINE');
      return await client.listModels();
    };
    return await Promise.race([operation(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { cancelled = true; reject(new Error('CAPABILITY_DEADLINE')); }, Math.max(1, lookupDeadline - Date.now()));
    })]);
  } catch {
    throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'No se pudieron comprobar las capacidades de Copilot. No se inició la inferencia.');
  } finally {
    cancelled = true;
    if (timer) clearTimeout(timer);
    await client.forceStop().catch(() => undefined);
    const inside = relative(tmpdir(), root);
    if (inside && !inside.startsWith('..') && !isAbsolute(inside)) await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}
