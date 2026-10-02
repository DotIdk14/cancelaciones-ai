import { getCurrentUserFromCookies, type AuthContext } from '../../src/server/auth.js';
import { getModelCapabilities, type ModelCapabilities } from '../../src/server/ai/model-capabilities.js';
import { handleRoute, json, methodNotAllowed, type ApiRequest } from '../../src/server/http.js';

/** Tope duro de la aplicación. Se duplica aquí a propósito: el healthcheck no llama a `getEnv()`. */
const APP_SAFE_OUTPUT_LIMIT = 16_384;

type SafeCapabilities = Pick<
  ModelCapabilities,
  | 'provider'
  | 'maxOutputTokens'
  | 'recommendedOutputTokens'
  | 'appSafeOutputLimit'
  | 'safeOutputLimit'
  | 'contextLength'
  | 'supportsStructuredOutput'
  | 'supportsJsonObject'
  | 'supportsImages'
  | 'supportsFiles'
  | 'productionReady'
  | 'retryFallbackSuitable'
  | 'retryableFailures'
  | 'schemaProfile'
  | 'pricing'
>;

const jsonCapable = (capabilities: ModelCapabilities): boolean =>
  capabilities.supportsJsonObject || capabilities.supportsStructuredOutput;

export default handleRoute(
  async (req: ApiRequest, res) => {
    if (req.method !== 'GET') {
      methodNotAllowed(req, res, 'GET');
      return;
    }

    const auth: AuthContext | null = req.auth ?? (await resolveOptionalAuth(req));
    const apiKeyConfigured = Boolean(process.env.OPENROUTER_API_KEY?.trim());
    const primaryModel = process.env.OPENROUTER_MODEL?.trim() || null;
    const fallbackModel = process.env.OPENROUTER_FALLBACK_MODEL?.trim() || null;
    const configuredBudget = process.env.AI_MAX_OUTPUT_TOKENS?.trim()
      ? Number(process.env.AI_MAX_OUTPUT_TOKENS)
      : APP_SAFE_OUTPUT_LIMIT;
    const budgetValid =
      Number.isInteger(configuredBudget) && configuredBudget >= 256 && configuredBudget <= APP_SAFE_OUTPUT_LIMIT;
    const reportedBudget = Number.isInteger(configuredBudget) ? configuredBudget : null;

    if (!auth) {
      json(res, 200, {
        status: apiKeyConfigured && primaryModel ? 'ok' : 'misconfigured',
        checkedAt: new Date().toISOString(),
      });
      return;
    }

    if (!apiKeyConfigured || !primaryModel) {
      json(res, 503, {
        configured: false,
        apiKeyConfigured,
        primaryModel,
        fallbackModel,
        configuredOutputTokens: reportedBudget,
        effectiveOutputTokens: null,
        productionReady: false,
        status: 'misconfigured',
      });
      return;
    }

    try {
      const primaryCapabilities = await getModelCapabilities(primaryModel);
      const fallbackCapabilities = fallbackModel ? await getModelCapabilities(fallbackModel) : null;
      const safeCapabilities = (capabilities: ModelCapabilities): SafeCapabilities => ({
        provider: capabilities.provider,
        maxOutputTokens: capabilities.maxOutputTokens,
        recommendedOutputTokens: capabilities.recommendedOutputTokens,
        appSafeOutputLimit: capabilities.appSafeOutputLimit,
        safeOutputLimit: capabilities.safeOutputLimit,
        contextLength: capabilities.contextLength,
        supportsStructuredOutput: capabilities.supportsStructuredOutput,
        supportsJsonObject: capabilities.supportsJsonObject,
        supportsImages: capabilities.supportsImages,
        supportsFiles: capabilities.supportsFiles,
        productionReady: capabilities.productionReady,
        retryFallbackSuitable: capabilities.retryFallbackSuitable,
        retryableFailures: capabilities.retryableFailures,
        schemaProfile: capabilities.schemaProfile,
        pricing: capabilities.pricing,
      });

      // No se hace ninguna generación pagada ni se devuelve la API key: solo IDs de
      // modelo, capacidades publicadas y el presupuesto que se usaría en la llamada.
      const effectiveOutputTokens = budgetValid
        ? Math.min(
            configuredBudget,
            primaryCapabilities.safeOutputLimit,
            fallbackCapabilities?.safeOutputLimit ?? Number.POSITIVE_INFINITY,
          )
        : null;
      const productionReady =
        budgetValid &&
        jsonCapable(primaryCapabilities) &&
        primaryCapabilities.productionReady &&
        (fallbackCapabilities ? jsonCapable(fallbackCapabilities) && fallbackCapabilities.productionReady : true);

      json(res, 200, {
        configured: true,
        apiKeyConfigured: true,
        primaryModel,
        fallbackModel,
        primaryCapabilities: safeCapabilities(primaryCapabilities),
        fallbackCapabilities: fallbackCapabilities ? safeCapabilities(fallbackCapabilities) : null,
        configuredOutputTokens: configuredBudget,
        effectiveOutputTokens,
        productionReady,
        status: productionReady ? 'ok' : 'degraded',
      });
    } catch {
      json(res, 503, {
        configured: true,
        apiKeyConfigured: true,
        primaryModel,
        fallbackModel,
        configuredOutputTokens: reportedBudget,
        effectiveOutputTokens: null,
        productionReady: false,
        status: 'capability_catalog_unavailable',
      });
    }
  },
  { public: true },
);

async function resolveOptionalAuth(req: ApiRequest): Promise<AuthContext | null> {
  const user = await getCurrentUserFromCookies(req, {
    baseUrl: process.env.INSFORGE_BASE_URL?.replace(/\/+$/, ''),
    anonKey: process.env.INSFORGE_ANON_KEY,
  });
  if (!user) return null;
  return { sub: user.id, email: user.email, role: 'user' };
}
