import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getModelCapabilities,
  resetModelCatalogCache,
  resolveOutputTokenBudget,
} from '../src/server/ai/model-capabilities';

const geminiModel = {
  id: 'google/gemini-2.5-flash-lite',
  context_length: 1_000_000,
  architecture: { input_modalities: ['text', 'image', 'pdf'] },
  supported_parameters: ['structured_outputs', 'response_format'],
  top_provider: { max_completion_tokens: 65_536 },
  pricing: { prompt: '0.0000001', completion: '0.0000004' },
};

function catalogResponse(model: unknown): Response {
  return new Response(JSON.stringify({ data: [model] }), { status: 200 });
}

afterEach(() => {
  resetModelCatalogCache();
  vi.unstubAllGlobals();
});

describe('capacidades OpenRouter', () => {
  it('usa el máximo de salida publicado y conserva modalidad/precio del catálogo', async () => {
    const fetchMock = vi.fn(async () => catalogResponse(geminiModel));
    const capabilities = await getModelCapabilities(geminiModel.id, fetchMock as unknown as typeof fetch);

    expect(capabilities.maxOutputTokens).toBe(65_536);
    expect(capabilities.appSafeOutputLimit).toBe(16_384);
    expect(capabilities.safeOutputLimit).toBe(16_384);
    expect(capabilities.supportsStructuredOutput).toBe(true);
    expect(capabilities.supportsJsonObject).toBe(true);
    expect(capabilities.supportsImages).toBe(true);
    expect(capabilities.supportsFiles).toBe(true);
    expect(capabilities.pricing.completion).toBe('0.0000004');
  });

  it('rechaza una configuración por encima del tope de la app aunque el modelo admita más', async () => {
    const capabilities = await getModelCapabilities(geminiModel.id, vi.fn(async () => catalogResponse(geminiModel)) as unknown as typeof fetch);

    expect(capabilities.maxOutputTokens).toBeGreaterThan(capabilities.appSafeOutputLimit);
    expect(() => resolveOutputTokenBudget(capabilities, { AI_MAX_OUTPUT_TOKENS: 16_385, AI_MAX_OUTPUT_TOKENS_CONFIGURED: true }))
      .toThrow(/exceeds the application safe output limit/);
  });

  it('baja el presupuesto si el máximo duro del catálogo es menor', async () => {
    const constrained = { ...geminiModel, top_provider: { max_completion_tokens: 4_096 } };
    const capabilities = await getModelCapabilities(geminiModel.id, vi.fn(async () => catalogResponse(constrained)) as unknown as typeof fetch);

    expect(capabilities.appSafeOutputLimit).toBe(16_384);
    expect(capabilities.safeOutputLimit).toBe(4_096);
    expect(capabilities.recommendedOutputTokens).toBe(4_096);
    // Reducir es automático incluso con el presupuesto configurado explícitamente:
    // pedir más de lo que el modelo publica no es una incompatibilidad.
    expect(resolveOutputTokenBudget(capabilities, { AI_MAX_OUTPUT_TOKENS: 16_384, AI_MAX_OUTPUT_TOKENS_CONFIGURED: true })).toBe(4_096);
  });

  it('usa el menor máximo de salida entre los endpoints publicados', async () => {
    const multiEndpoint = {
      ...geminiModel,
      top_provider: { max_completion_tokens: 65_536 },
      endpoints: [{ max_completion_tokens: 8_192 }, { max_completion_tokens: 32_768 }],
    };
    const capabilities = await getModelCapabilities(geminiModel.id, vi.fn(async () => catalogResponse(multiEndpoint)) as unknown as typeof fetch);

    expect(capabilities.maxOutputTokens).toBe(8_192);
    expect(capabilities.safeOutputLimit).toBe(8_192);
  });

  it('rechaza modelos sin provider profile conocido o que no aparecen en el catálogo', async () => {
    await expect(getModelCapabilities('unknown/model', vi.fn() as unknown as typeof fetch))
      .rejects.toThrow('no provider profile');
    await expect(getModelCapabilities('google/missing-model', vi.fn(async () => catalogResponse(geminiModel)) as unknown as typeof fetch))
      .rejects.toThrow('not listed in OpenRouter catalog');
  });

  it('usa el perfil seguro conocido cuando el catálogo no está disponible', async () => {
    const capabilities = await getModelCapabilities('google/gemini-2.5-flash-lite', vi.fn(async () => {
      throw new Error('network unavailable');
    }) as unknown as typeof fetch);

    expect(capabilities.catalogVerified).toBe(false);
    expect(capabilities.supportsJsonObject).toBe(true);
    expect(capabilities.supportsStructuredOutput).toBe(false);
    expect(capabilities.safeOutputLimit).toBe(16_384);
  });
});
