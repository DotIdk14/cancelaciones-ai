import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest, ApiResponse } from '../src/server/http';
import { getModelCapabilities } from '../src/server/ai/model-capabilities';
import healthAiHandler from '../api/health/ai';
import { fakeAuthContext } from './helpers/auth';

vi.mock('../src/server/ai/model-capabilities', () => ({
  getModelCapabilities: vi.fn(async (modelId: string) => ({
    modelId,
    provider: 'google',
    maxOutputTokens: 32_768,
    recommendedOutputTokens: 16_384,
    appSafeOutputLimit: 16_384,
    safeOutputLimit: 16_384,
    contextLength: 1_000_000,
    supportsStructuredOutput: true,
    supportsJsonObject: true,
    supportsImages: true,
    supportsFiles: true,
    productionReady: true,
    retryFallbackSuitable: true,
    retryableFailures: ['RATE_LIMIT', 'TIMEOUT', 'PROVIDER_UNAVAILABLE'],
    schemaProfile: 'gemini',
    pricing: { prompt: '0.000001', completion: '0.000004' },
    supportedParameters: ['response_format'],
  })),
}));

function responseHarness(): ApiResponse & { statusCode: number; body: string } {
  const harness = {
    statusCode: 200,
    body: '',
    headers: {} as Record<string, string>,
    setHeader(name: string, value: unknown) {
      harness.headers[name] = String(value);
    },
    appendHeader(name: string, value: unknown) {
      harness.headers[name] = String(value);
    },
    end: (value?: unknown) => { harness.body = typeof value === 'string' ? value : ''; },
  };
  return harness as unknown as ApiResponse & { statusCode: number; body: string };
}

function authRequest(): ApiRequest {
  return { method: 'GET', url: '/', headers: {}, auth: fakeAuthContext() } as unknown as ApiRequest;
}

function anonRequest(): ApiRequest {
  return { method: 'GET', url: '/', headers: {} } as unknown as ApiRequest;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/health/ai', () => {
  it('sin sesión solo devuelve status y checkedAt', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'health-secret-must-not-leak');
    vi.stubEnv('OPENROUTER_MODEL', 'google/gemini-2.5-flash-lite');
    const response = responseHarness();

    await healthAiHandler(anonRequest(), response);

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload).toHaveProperty('status');
    expect(payload).toHaveProperty('checkedAt');
    expect(payload).not.toHaveProperty('primaryModel');
    expect(response.body).not.toContain('health-secret-must-not-leak');
  });

  it('con sesión devuelve capacidades seguras y nunca incluye el secreto', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'health-secret-must-not-leak');
    vi.stubEnv('OPENROUTER_MODEL', 'google/gemini-2.5-flash-lite');
    vi.stubEnv('OPENROUTER_FALLBACK_MODEL', '');
    vi.stubEnv('AI_MAX_OUTPUT_TOKENS', '16384');
    const response = responseHarness();

    await healthAiHandler(authRequest(), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('google/gemini-2.5-flash-lite');
    expect(response.body).not.toContain('health-secret-must-not-leak');
    expect(response.body).not.toContain('supportedParameters');
    expect(JSON.parse(response.body)).toMatchObject({ configured: true, apiKeyConfigured: true, productionReady: true, status: 'ok' });
    expect(JSON.parse(response.body)).toMatchObject({ configuredOutputTokens: 16_384, effectiveOutputTokens: 16_384 });
  });

  it('marca el presupuesto por encima del tope de la app como degradado', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'health-secret-must-not-leak');
    vi.stubEnv('OPENROUTER_MODEL', 'google/gemini-2.5-flash-lite');
    vi.stubEnv('OPENROUTER_FALLBACK_MODEL', '');
    vi.stubEnv('AI_MAX_OUTPUT_TOKENS', '99999');
    const response = responseHarness();

    await healthAiHandler(authRequest(), response);

    expect(JSON.parse(response.body)).toMatchObject({ effectiveOutputTokens: null, productionReady: false, status: 'degraded' });
    expect(response.body).not.toContain('health-secret-must-not-leak');
  });

  it('no marca degraded cuando el modelo publica menos que el presupuesto configurado', async () => {
    vi.mocked(getModelCapabilities).mockResolvedValueOnce({
      ...(await getModelCapabilities('google/gemini-2.5-flash-lite')),
      maxOutputTokens: 4_096,
      safeOutputLimit: 4_096,
      recommendedOutputTokens: 4_096,
    } as Awaited<ReturnType<typeof getModelCapabilities>>);
    vi.stubEnv('OPENROUTER_API_KEY', 'health-secret-must-not-leak');
    vi.stubEnv('OPENROUTER_MODEL', 'google/gemini-2.5-flash-lite');
    vi.stubEnv('OPENROUTER_FALLBACK_MODEL', '');
    vi.stubEnv('AI_MAX_OUTPUT_TOKENS', '16384');
    const response = responseHarness();

    await healthAiHandler(authRequest(), response);

    expect(JSON.parse(response.body)).toMatchObject({
      configuredOutputTokens: 16_384,
      effectiveOutputTokens: 4_096,
      productionReady: true,
      status: 'ok',
    });
  });

  it('informa catálogo no disponible sin filtrar secretos', async () => {
    vi.mocked(getModelCapabilities).mockRejectedValueOnce(new Error('CAPABILITY_CATALOG_UNAVAILABLE'));
    vi.stubEnv('OPENROUTER_API_KEY', 'health-secret-must-not-leak');
    vi.stubEnv('OPENROUTER_MODEL', 'google/gemini-2.5-flash-lite');
    vi.stubEnv('OPENROUTER_FALLBACK_MODEL', '');
    vi.stubEnv('AI_MAX_OUTPUT_TOKENS', '16384');
    const response = responseHarness();

    await healthAiHandler(authRequest(), response);

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toMatchObject({
      status: 'capability_catalog_unavailable',
      effectiveOutputTokens: null,
      productionReady: false,
    });
    expect(response.body).not.toContain('health-secret-must-not-leak');
  });
});
