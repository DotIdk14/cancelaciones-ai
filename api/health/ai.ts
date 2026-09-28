import { getModelCapabilities } from '../../src/server/ai/model-capabilities.js';
import { handleRoute, json, methodNotAllowed, type ApiRequest } from '../../src/server/http.js';

export default handleRoute(async (req: ApiRequest, res) => {
  if (req.method !== 'GET') {
    methodNotAllowed(req, res, 'GET');
    return;
  }

  const apiKeyConfigured = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  const primaryModel = process.env.OPENROUTER_MODEL?.trim() || null;
  const fallbackModel = process.env.OPENROUTER_FALLBACK_MODEL?.trim() || null;
  if (!apiKeyConfigured || !primaryModel) {
    json(res, 503, { configured: false, status: 'misconfigured' });
    return;
  }

  try {
    const primaryCapabilities = await getModelCapabilities(primaryModel);
    const fallbackCapabilities = fallbackModel ? await getModelCapabilities(fallbackModel) : null;
    const safeCapabilities = (capabilities: typeof primaryCapabilities | null) => capabilities && ({
      provider: capabilities.provider,
      maxOutputTokens: capabilities.maxOutputTokens,
      recommendedOutputTokens: capabilities.recommendedOutputTokens,
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

    json(res, 200, {
      configured: true,
      primaryModel,
      fallbackModel,
      primaryCapabilities: safeCapabilities(primaryCapabilities),
      fallbackCapabilities: safeCapabilities(fallbackCapabilities),
      status: (primaryCapabilities.supportsJsonObject || primaryCapabilities.supportsStructuredOutput) &&
        primaryCapabilities.productionReady && (fallbackCapabilities?.productionReady ?? true) ? 'ok' : 'degraded',
    });
  } catch {
    json(res, 503, {
      configured: true,
      primaryModel,
      fallbackModel,
      status: 'capability_catalog_unavailable',
    });
  }
});