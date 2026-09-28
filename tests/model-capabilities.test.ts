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
    expect(capabilities.safeOutputLimit).toBe(16_384);
    expect(capabilities.supportsStructuredOutput).toBe(true);
    expect(capabilities.supportsJsonObject).toBe(true);
    expect(capabilities.supportsImages).toBe(true);
    expect(capabilities.supportsFiles).toBe(true);
    expect(capabilities.pricing.completion).toBe('0.0000004');
  });

  it('rechaza una configuración por encima del tope operativo aunque el modelo admita más', async () => {
    const capabilities = await getModelCapabilities(geminiModel.id, vi.fn(async () => catalogResponse(geminiModel)) as unknown as typeof fetch);

    expect(capabilities.maxOutputTokens).toBeGreaterThan(capabilities.safeOutputLimit);
    expect(() => resolveOutputTokenBudget(capabilities, { AI_MAX_OUTPUT_TOKENS: 16_385, AI_MAX_OUTPUT_TOKENS_CONFIGURED: true }))
      .toThrow(/exceeds the safe output limit/);
  });

  it('baja el presupuesto predeterminado si el máximo duro del catálogo es menor', async () => {
    const constrained = { ...geminiModel, top_provider: { max_completion_tokens: 4_096 } };
    const capabilities = await getModelCapabilities(geminiModel.id, vi.fn(async () => catalogResponse(constrained)) as unknown as typeof fetch);

    expect(capabilities.safeOutputLimit).toBe(4_096);
    expect(capabilities.recommendedOutputTokens).toBe(4_096);
    expect(resolveOutputTokenBudget(capabilities, { AI_MAX_OUTPUT_TOKENS: 8_192, AI_MAX_OUTPUT_TOKENS_CONFIGURED: false })).toBe(4_096);
  });

  it('rechaza modelos sin provider profile conocido o que no aparecen en el catálogo', async () => {
    await expect(getModelCapabilities('unknown/model', vi.fn() as unknown as typeof fetch))
      .rejects.toThrow('no provider profile');
    await expect(getModelCapabilities('google/missing-model', vi.fn(async () => catalogResponse(geminiModel)) as unknown as typeof fetch))
      .rejects.toThrow('not listed in OpenRouter catalog');
  });
});