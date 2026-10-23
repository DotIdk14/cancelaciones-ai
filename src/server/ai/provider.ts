import { AsyncLocalStorage } from 'node:async_hooks';
import { getEnv } from '../env.js';
import { ApiError } from '../errors.js';
import type { EvidenceInputItem } from '../../skills/audit/types.js';
import type { OpenRouterContentPart } from '../openrouter.js';
import { bundleCopilotEvidence, applyCopilotBundle, type CopilotEvidenceBundle } from './copilot-evidence.js';

export type AiProvider = 'openrouter' | 'github-copilot';
// Contexto efímero de una ejecución; no guarda jobs, decisiones ni estado durable.
export interface PreparedAiProvider { provider: AiProvider; bundle?: CopilotEvidenceBundle }
const selectedProvider = new AsyncLocalStorage<PreparedAiProvider>();

export function withAiProvider<T>(provider: AiProvider, operation: () => Promise<T>, bundle?: CopilotEvidenceBundle): Promise<T> {
  return selectedProvider.run({ provider, bundle }, operation);
}

export function preparedCopilotParts(parts: OpenRouterContentPart[]): OpenRouterContentPart[] {
  return applyCopilotBundle(parts, selectedProvider.getStore()?.bundle);
}

/** Refleja únicamente los adjuntos originales que el Skill ya envía. */
export function visualEvidenceParts(evidences: readonly EvidenceInputItem[]): OpenRouterContentPart[] {
  const parts: OpenRouterContentPart[] = [];
  for (const evidence of evidences) {
    if (evidence.imageBase64) parts.push({ type: 'image_url', image_url: { url: evidence.imageBase64 } });
    for (const page of evidence.pagesBase64 ?? []) parts.push({ type: 'image_url', image_url: { url: page } });
  }
  for (const evidence of evidences) {
    if (evidence.kind === 'PDF' && evidence.pdfBase64) parts.push({ type: 'file', file: {
      filename: evidence.filename, file_data: `data:${evidence.mimeType};base64,${evidence.pdfBase64}`,
    } });
  }
  return parts;
}

/** Comprueba propuesta Y contraste antes de crear un intento de auditoría. */
export async function preflightAiProvider(evidences: readonly EvidenceInputItem[], deadlineMs: number): Promise<PreparedAiProvider> {
  const provider = await selectAiProvider(deadlineMs);
  if (provider !== 'github-copilot') return { provider };
  const env = getEnv();
  const { readCopilotModels, assertCopilotParts } = await import('./copilot-capabilities.js');
  const models = await readCopilotModels(deadlineMs);
  const configuredModels = [...new Set([env.COPILOT_MODEL, env.COPILOT_REVIEW_MODEL])].map(modelId => {
    const model = models.find(item => item.id === modelId && (!item.policy || item.policy.state === 'enabled'));
    if (!model) throw new ApiError(502, 'UNSUPPORTED_MODEL_CAPABILITY', 'Un modelo configurado de Copilot no está disponible para completar propuesta y contraste.');
    return model;
  });
  const bundle = await bundleCopilotEvidence(evidences, configuredModels, deadlineMs);
  const parts = applyCopilotBundle(visualEvidenceParts(evidences), bundle);
  for (const model of configuredModels) {
    try {
      assertCopilotParts(parts, model);
    } catch (error) {
      if (error instanceof ApiError && env.AI_PROVIDER_MODE === 'auto') {
        const failure = new ApiError(error.status, error.category,
          `${error.message} OpenRouter no tiene presupuesto suficiente o verificable para utilizarse. Revisa el saldo o configura un proveedor compatible.`);
        failure.failurePath = error.failurePath;
        failure.sanitizedDetail = error.sanitizedDetail;
        throw failure;
      }
      throw error;
    }
  }
  return { provider, bundle };
}

/** Elige antes de inferir: nunca reinicia un dictamen después de gastar sus intentos. */
export async function selectAiProvider(deadlineMs?: number): Promise<AiProvider> {
  const pinned = selectedProvider.getStore();
  if (pinned) return pinned.provider;
  const env = getEnv();
  if (env.AI_PROVIDER_MODE === 'openrouter') return 'openrouter';
  if (!env.COPILOT_GITHUB_TOKEN || !env.COPILOT_MODEL || !env.COPILOT_REVIEW_MODEL) {
    throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Configura las credenciales y modelos de Copilot en el servidor.');
  }
  if (env.AI_PROVIDER_MODE === 'github-copilot') return 'github-copilot';
  const timeout = Math.min(5_000, (deadlineMs ?? Date.now() + 5_000) - Date.now());
  if (timeout <= 0) throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Se agotó el tiempo disponible para seleccionar proveedor.');
  try {
    const read = async (path: string) => {
      const response = await fetch(`https://openrouter.ai/api/v1/${path}`, {
        headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` }, signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) throw new Error('BUDGET_UNAVAILABLE');
      return await response.json() as { data?: Record<string, unknown> };
    };
    const [key, credits] = await Promise.all([read('key'), read('credits')]);
    const remaining = key.data?.limit_remaining;
    const purchased = credits.data?.total_credits;
    const spent = credits.data?.total_usage;
    if ((remaining !== null && (typeof remaining !== 'number' || !Number.isFinite(remaining)))
      || typeof purchased !== 'number' || !Number.isFinite(purchased)
      || typeof spent !== 'number' || !Number.isFinite(spent)) return 'github-copilot';
    const available = Math.min(remaining ?? Infinity, purchased - spent);
    return available >= env.OPENROUTER_MIN_BALANCE_USD ? 'openrouter' : 'github-copilot';
  } catch {
    // El respaldo está autorizado y configurado; no se relajan sesión, cuotas ni validación.
    return 'github-copilot';
  }
}
