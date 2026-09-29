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
  /** Tope seguro definido por la aplicación; pedir más que esto es un error de configuración. */
  appSafeOutputLimit: number;
  /** Tope efectivo: el menor entre el de la aplicación y el máximo publicado por el modelo. */
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
  /** `false` cuando las capacidades no se pudieron confirmar contra el catálogo en vivo. */
  catalogVerified: boolean;
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
    recommendedOutputTokens: 16_384,
    retryFallbackSuitable: true,
  },
  openai: {
    provider: 'openai',
    schemaProfile: 'openai',
    safeOutputLimit: 16_384,
    recommendedOutputTokens: 16_384,
    retryFallbackSuitable: true,
  },
};

let cachedCatalog: { expiresAt: number; data: CatalogModel[] } | null = null;
let catalogWasStale = false;

export class CapabilityCatalogUnavailableError extends Error {
  constructor() {
    super('CAPABILITY_CATALOG_UNAVAILABLE');
    this.name = 'CapabilityCatalogUnavailableError';
  }
}

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
  if (cachedCatalog && cachedCatalog.expiresAt > Date.now()) {
    catalogWasStale = false;
    return cachedCatalog.data;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  try {
    const response = await fetcher(MODEL_CATALOG_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`OpenRouter model catalog HTTP ${response.status}`);
    const body = (await response.json()) as ModelCatalog;
    if (!Array.isArray(body.data)) throw new Error('OpenRouter model catalog response is invalid');
    cachedCatalog = { data: body.data, expiresAt: Date.now() + CATALOG_CACHE_MS };
    catalogWasStale = false;
    return body.data;
  } catch {
    // Una copia previamente validada permite seguir trabajando durante una caída
    // temporal del catálogo, siempre con sus límites/capabilities conservadores.
    if (cachedCatalog) {
      catalogWasStale = true;
      return cachedCatalog.data;
    }
    throw new CapabilityCatalogUnavailableError();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Capacidades mínimas derivadas del perfil conocido del proveedor. Se usan solo
 * cuando el catálogo no está disponible: el ID del modelo no se puede confirmar,
 * así que se asume el modo `json_object` (el más ampliamente soportado) y el tope
 * seguro de la aplicación, nunca el máximo teórico del modelo. El intento queda
 * marcado como no verificado en los diagnósticos.
 */
function degradedCapabilities(modelId: string, profile: ModelCapabilityProfile): ModelCapabilities {
  return {
    modelId,
    provider: profile.provider,
    maxOutputTokens: profile.safeOutputLimit,
    recommendedOutputTokens: Math.min(profile.recommendedOutputTokens, profile.safeOutputLimit),
    appSafeOutputLimit: profile.safeOutputLimit,
    safeOutputLimit: profile.safeOutputLimit,
    contextLength: 0,
    supportsStructuredOutput: false,
    supportsJsonObject: true,
    supportsImages: false,
    supportsFiles: false,
    productionReady: !/(preview|experimental|beta)/i.test(modelId),
    retryFallbackSuitable: profile.retryFallbackSuitable,
    retryableFailures: ['RATE_LIMIT', 'TIMEOUT', 'PROVIDER_UNAVAILABLE'],
    schemaProfile: profile.schemaProfile,
    pricing: { prompt: null, completion: null },
    supportedParameters: [],
    catalogVerified: false,
  };
}

export async function getModelCapabilities(modelId: string, fetcher: typeof fetch = fetch): Promise<ModelCapabilities> {
  const profile = MODEL_CAPABILITY_PROFILES[modelOwner(modelId)];
  if (!profile) throw new Error(`UNSUPPORTED_MODEL_CAPABILITY: no provider profile for ${modelOwner(modelId) || 'unknown'}`);

  if (!modelId.includes('/')) throw new Error('UNSUPPORTED_MODEL_CAPABILITY: invalid model id');
  let catalog: CatalogModel[];
  try {
    catalog = await readCatalog(fetcher);
  } catch (error) {
    if (error instanceof CapabilityCatalogUnavailableError) return degradedCapabilities(modelId, profile);
    throw error;
  }
  const model = catalog.find((item) => item.id === modelId);
  if (!model && catalogWasStale) return degradedCapabilities(modelId, profile);
  if (!model) throw new Error('UNSUPPORTED_MODEL_CAPABILITY: model is not listed in OpenRouter catalog');

  const supportedParameters = Array.isArray(model.supported_parameters)
    ? model.supported_parameters.filter((parameter): parameter is string => typeof parameter === 'string')
    : [];
  const endpointParameters = model.endpoints?.flatMap((endpoint) =>
    Array.isArray(endpoint.supported_parameters)
      ? endpoint.supported_parameters.filter((parameter): parameter is string => typeof parameter === 'string')
      : [],
  ) ?? [];
  const allParameters = [...new Set([...supportedParameters, ...endpointParameters])];
  const publishedLimits = [
    numeric(model.top_provider?.max_completion_tokens),
    ...(model.endpoints?.map((endpoint) => numeric(endpoint.max_completion_tokens)) ?? []),
  ].filter((value): value is number => value !== null);
  const maxOutputTokens = publishedLimits.length ? Math.min(...publishedLimits) : null;
  if (maxOutputTokens === null) {
    throw new Error(`CAPABILITY_CATALOG_UNAVAILABLE: OpenRouter did not report a maximum output for a listed model`);
  }

  const modalities = Array.isArray(model.architecture?.input_modalities)
    ? model.architecture.input_modalities.filter((modality): modality is string => typeof modality === 'string')
    : [];
  const appSafeOutputLimit = profile.safeOutputLimit;
  const safeOutputLimit = Math.min(appSafeOutputLimit, maxOutputTokens);
  const supportsStructuredOutput = allParameters.includes('structured_outputs');
  return {
    modelId,
    provider: profile.provider,
    maxOutputTokens,
    recommendedOutputTokens: Math.min(profile.recommendedOutputTokens, safeOutputLimit),
    appSafeOutputLimit,
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
    catalogVerified: !catalogWasStale,
  };
}

export function resolveOutputTokenBudget(
  capabilities: ModelCapabilities,
  env: Pick<ServerEnv, 'AI_MAX_OUTPUT_TOKENS' | 'AI_MAX_OUTPUT_TOKENS_CONFIGURED'> = getEnv(),
): number {
  const requested = env.AI_MAX_OUTPUT_TOKENS;
  // Pedir más que el tope de la aplicación es un error de configuración: se falla
  // claro, sin contactar al proveedor. Si el modelo publica menos de lo pedido se
  // reduce automáticamente al máximo real.
  if (requested > capabilities.appSafeOutputLimit) {
    throw new Error(
      `AI_MAX_OUTPUT_TOKENS=${requested} exceeds the application safe output limit (${capabilities.appSafeOutputLimit})`,
    );
  }
  return Math.min(requested, capabilities.safeOutputLimit);
}

export function resetModelCatalogCache(): void {
  cachedCatalog = null;
  catalogWasStale = false;
}
