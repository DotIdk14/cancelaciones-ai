import { getEnv, type ServerEnv } from '../env.js';

const MODEL_CATALOG_URL = 'https://openrouter.ai/api/v1/models';
const CATALOG_TIMEOUT_MS = 5_000;
const CATALOG_CACHE_MS = 5 * 60_000;

export interface ModelCapabilityProfile {
  provider: string;
  schemaProfile: 'gemini' | 'openai';
  safeOutputLimit: number;
  recommendedOutputTokens: number;
  retryFallbackSuitable: boolean;
}

export interface ModelCapabilities {
  modelId: string;
  provider: string;
  maxOutputTokens: number;
  recommendedOutputTokens: number;
  safeOutputLimit: number;
  contextLength: number;
  supportsStructuredOutput: boolean;
  supportsJsonObject: boolean;
  supportsImages: boolean;
  supportsFiles: boolean;
  productionReady: boolean;
  retryFallbackSuitable: boolean;
  retryableFailures: readonly ['RATE_LIMIT', 'TIMEOUT', 'PROVIDER_UNAVAILABLE'];
  schemaProfile: ModelCapabilityProfile['schemaProfile'];
  pricing: { prompt: string | null; completion: string | null };
  supportedParameters: string[];
}

interface CatalogModel {
  id?: unknown;
  context_length?: unknown;
  architecture?: { input_modalities?: unknown };
  supported_parameters?: unknown;
  top_provider?: { max_completion_tokens?: unknown };
  endpoints?: Array<{ max_completion_tokens?: unknown; supported_parameters?: unknown }>;
  pricing?: { prompt?: unknown; completion?: unknown };
}

interface ModelCatalog {
  data?: CatalogModel[];
}

export const MODEL_CAPABILITY_PROFILES: Readonly<Record<string, ModelCapabilityProfile>> = {
  google: {
    provider: 'google',
    schemaProfile: 'gemini',
    safeOutputLimit: 16_384,
    recommendedOutputTokens: 8_192,
    retryFallbackSuitable: true,
  },
  openai: {
    provider: 'openai',
    schemaProfile: 'openai',
    safeOutputLimit: 16_384,
    recommendedOutputTokens: 8_192,
    retryFallbackSuitable: true,
  },
};

let cachedCatalog: { expiresAt: number; data: CatalogModel[] } | null = null;

function modelOwner(modelId: string): string {
  return modelId.split('/')[0]?.toLowerCase() ?? '';
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function readCatalog(fetcher: typeof fetch): Promise<CatalogModel[]> {
  if (cachedCatalog && cachedCatalog.expiresAt > Date.now()) return cachedCatalog.data;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  try {
    const response = await fetcher(MODEL_CATALOG_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`OpenRouter model catalog HTTP ${response.status}`);
    const body = (await response.json()) as ModelCatalog;
    if (!Array.isArray(body.data)) throw new Error('OpenRouter model catalog response is invalid');
    cachedCatalog = { data: body.data, expiresAt: Date.now() + CATALOG_CACHE_MS };
    return body.data;
  } finally {
    clearTimeout(timer);
  }
}

export async function getModelCapabilities(modelId: string, fetcher: typeof fetch = fetch): Promise<ModelCapabilities> {
  const profile = MODEL_CAPABILITY_PROFILES[modelOwner(modelId)];
  if (!profile) throw new Error(`UNSUPPORTED_MODEL_CAPABILITY: no provider profile for ${modelOwner(modelId) || 'unknown'}`);

  const catalog = await readCatalog(fetcher);
  const model = catalog.find((item) => item.id === modelId);
  if (!model) throw new Error(`UNSUPPORTED_MODEL_CAPABILITY: model is not listed in OpenRouter catalog (${modelId})`);

  const supportedParameters = Array.isArray(model.supported_parameters)
    ? model.supported_parameters.filter((parameter): parameter is string => typeof parameter === 'string')
    : [];
  const endpointParameters = model.endpoints?.flatMap((endpoint) =>
    Array.isArray(endpoint.supported_parameters)
      ? endpoint.supported_parameters.filter((parameter): parameter is string => typeof parameter === 'string')
      : [],
  ) ?? [];
  const allParameters = [...new Set([...supportedParameters, ...endpointParameters])];
  const maxOutputTokens = numeric(model.top_provider?.max_completion_tokens)
    ?? model.endpoints?.map((endpoint) => numeric(endpoint.max_completion_tokens)).find((value) => value !== null)
    ?? null;
  if (maxOutputTokens === null) {
    throw new Error(`UNSUPPORTED_MODEL_CAPABILITY: OpenRouter did not report a maximum output for ${modelId}`);
  }

  const modalities = Array.isArray(model.architecture?.input_modalities)
    ? model.architecture.input_modalities.filter((modality): modality is string => typeof modality === 'string')
    : [];
  const safeOutputLimit = Math.min(profile.safeOutputLimit, maxOutputTokens);
  const supportsStructuredOutput = allParameters.includes('structured_outputs');
  return {
    modelId,
    provider: profile.provider,
    maxOutputTokens,
    recommendedOutputTokens: Math.min(profile.recommendedOutputTokens, safeOutputLimit),
    safeOutputLimit,
    contextLength: numeric(model.context_length) ?? 0,
    supportsStructuredOutput,
    supportsJsonObject: allParameters.includes('response_format') || supportsStructuredOutput,
    supportsImages: modalities.includes('image'),
    supportsFiles: modalities.includes('pdf') || modalities.includes('file'),
    productionReady: !/(preview|experimental|beta)/i.test(modelId),
    retryFallbackSuitable: profile.retryFallbackSuitable,
    retryableFailures: ['RATE_LIMIT', 'TIMEOUT', 'PROVIDER_UNAVAILABLE'],
    schemaProfile: profile.schemaProfile,
    pricing: {
      prompt: stringValue(model.pricing?.prompt),
      completion: stringValue(model.pricing?.completion),
    },
    supportedParameters: allParameters,
  };
}

export function resolveOutputTokenBudget(
  capabilities: ModelCapabilities,
  env: Pick<ServerEnv, 'AI_MAX_OUTPUT_TOKENS' | 'AI_MAX_OUTPUT_TOKENS_CONFIGURED'> = getEnv(),
): number {
  const requested = env.AI_MAX_OUTPUT_TOKENS;
  if (requested > capabilities.safeOutputLimit) {
    if (!env.AI_MAX_OUTPUT_TOKENS_CONFIGURED) return capabilities.safeOutputLimit;
    throw new Error(
      `AI_MAX_OUTPUT_TOKENS=${requested} exceeds the safe output limit for ${capabilities.modelId} (${capabilities.safeOutputLimit}; catalog maximum ${capabilities.maxOutputTokens})`,
    );
  }
  return requested;
}

export function resetModelCatalogCache(): void {
  cachedCatalog = null;
}