import { AsyncLocalStorage } from 'node:async_hooks';
import { getEnv } from '../env.js';
import { ApiError } from '../errors.js';
import type { EvidenceInputItem } from '../../skills/audit/types.js';
import type { OpenRouterContentPart } from '../openrouter.js';
import { bundleCopilotEvidence, applyCopilotBundle, type CopilotEvidenceBundle } from './copilot-evidence.js';

export type AiProvider = 'openrouter' | 'github-copilot';
// Contexto efímero de una ejecución; no guarda jobs, decisiones ni estado durable.
export interface PreparedAiProvider { provider: AiProvider; bundle?: CopilotEvidenceBundle }
export type CreditFallbackStage = 'proposal' | 'review' | 'comparison';
interface ProviderContext extends PreparedAiProvider {
  onCreditExhausted?: (stage: CreditFallbackStage) => Promise<PreparedAiProvider>;
}

const selectedProvider = new AsyncLocalStorage<ProviderContext>();

export function withAiProvider<T>(provider: AiProvider, operation: () => Promise<T>, bundle?: CopilotEvidenceBundle,
  onCreditExhausted?: (stage: CreditFallbackStage) => Promise<PreparedAiProvider>): Promise<T> {
  return selectedProvider.run({ provider, bundle, onCreditExhausted }, operation);
}

export function currentAiProvider(): AiProvider | undefined { return selectedProvider.getStore()?.provider; }

/** Solo se invoca tras un 402 real de créditos; conserva la etapa que ya terminó. */
export async function activateCreditFallback(deadlineMs: number, stage: CreditFallbackStage = 'proposal'): Promise<boolean> {
  if (getEnv().AI_PROVIDER_MODE !== 'auto') return false;
  const context = selectedProvider.getStore();
  if (context?.provider === 'github-copilot') return false;
  // Las evaluaciones directas del Skill deben medir el modelo solicitado.
  // La auditoria productiva proporciona el callback de persistencia durable.
  if (!context?.onCreditExhausted && stage !== 'comparison') return false;
  const prepared = context?.onCreditExhausted
    ? await context.onCreditExhausted(stage) : await prepareCopilotProvider([], deadlineMs);
  if (context) Object.assign(context, prepared);
  return true;
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
  return prepareCopilotProvider(evidences, deadlineMs);
}

export async function prepareCopilotProvider(evidences: readonly EvidenceInputItem[], deadlineMs: number): Promise<PreparedAiProvider> {
  const env = getEnv();
  if (!env.COPILOT_GITHUB_TOKEN || !env.COPILOT_MODEL || !env.COPILOT_REVIEW_MODEL) {
    throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Configura las credenciales y modelos de Copilot en el servidor.');
  }
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
    assertCopilotParts(parts, model);
  }
  return { provider: 'github-copilot', bundle };
}

/** Auto siempre comienza con una llamada real a OpenRouter, sin consultar saldo. */
export async function selectAiProvider(deadlineMs?: number): Promise<AiProvider> {
  const pinned = selectedProvider.getStore();
  if (pinned) return pinned.provider;
  if (deadlineMs !== undefined && deadlineMs <= Date.now()) {
    throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Se agoto el tiempo disponible para seleccionar proveedor.');
  }
  return getEnv().AI_PROVIDER_MODE === 'github-copilot' ? 'github-copilot' : 'openrouter';
}
