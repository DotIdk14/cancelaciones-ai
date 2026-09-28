import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest, ApiResponse } from '../src/server/http';
import healthAiHandler from '../api/health/ai';

vi.mock('../src/server/ai/model-capabilities', () => ({
  getModelCapabilities: vi.fn(async (modelId: string) => ({
    modelId,
    provider: 'google',
    maxOutputTokens: 32_768,
    recommendedOutputTokens: 8_192,
    safeOutputLimit: 16_384,
    contextLength: 1_000_000,
    supportsStructuredOutput: true,
    supportsJsonObject: true,
    supportsImages: true,
    supportsFiles: true,
    productionReady: true,
    schemaProfile: 'gemini',
    pricing: { prompt: '0.000001', completion: '0.000004' },
    supportedParameters: ['response_format'],
  })),
}));

function responseHarness(): ApiResponse & { statusCode: number; body: string } {
  const harness = {
    statusCode: 200,
    body: '',
    setHeader: () => undefined,
    appendHeader: () => undefined,
    end: (value?: unknown) => { harness.body = typeof value === 'string' ? value : ''; },
  };
  return harness as unknown as ApiResponse & { statusCode: number; body: string };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/health/ai', () => {
  it('devuelve capacidades seguras y nunca incluye el secreto', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'health-secret-must-not-leak');
    vi.stubEnv('OPENROUTER_MODEL', 'google/gemini-2.5-flash-lite');
    vi.stubEnv('OPENROUTER_FALLBACK_MODEL', '');
    const response = responseHarness();

    await healthAiHandler({ method: 'GET' } as ApiRequest, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('google/gemini-2.5-flash-lite');
    expect(response.body).not.toContain('health-secret-must-not-leak');
    expect(response.body).not.toContain('supportedParameters');
    expect(JSON.parse(response.body)).toMatchObject({ configured: true, status: 'ok' });
  });
});