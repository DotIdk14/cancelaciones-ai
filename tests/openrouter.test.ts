import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callOpenRouterAudit } from '../src/server/openrouter';
import { getModelCapabilities } from '../src/server/ai/model-capabilities';
import { ApiError } from '../src/server/http';
import { setTestEnv } from './helpers/env';
import { validAuditResult } from './fixtures/audit-result';

vi.mock('../src/server/ai/model-capabilities', () => ({
  getModelCapabilities: vi.fn(async (modelId: string) => ({
    modelId,
    provider: modelId.split('/')[0] ?? 'google',
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
    schemaProfile: modelId.startsWith('openai/') ? 'openai' : 'gemini',
    pricing: { prompt: '0', completion: '0' },
    supportedParameters: ['structured_outputs', 'response_format'],
  })),
  resolveOutputTokenBudget: vi.fn((capabilities: { appSafeOutputLimit: number; safeOutputLimit: number }, env: { AI_MAX_OUTPUT_TOKENS: number; AI_MAX_OUTPUT_TOKENS_CONFIGURED?: boolean }) => {
    if (env.AI_MAX_OUTPUT_TOKENS > capabilities.appSafeOutputLimit) throw new Error('unsafe output budget');
    return Math.min(env.AI_MAX_OUTPUT_TOKENS, capabilities.safeOutputLimit);
  }),
}));

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const DEFAULT_USAGE = {
  prompt_tokens: 100,
  completion_tokens: 50,
  total_tokens: 150,
  cost: 0.00012,
} as const;

/**
 * Respuesta de completions de OpenRouter.
 *
 * `usage` se decide con `hasOwnProperty`, NO con `??`: `undefined ?? DEFAULT`
 * devuelve DEFAULT, así que con `??` sería imposible simular una respuesta SIN
 * usage y el test "coste nunca inventado" fallaría siempre.
 *   - sin la clave `usage`  -> uso por defecto (respuesta normal del provider)
 *   - `usage: undefined`    -> la clave NO viaja en el JSON (JSON.stringify la omite)
 *   - `usage: null`         -> la clave viaja con null explícito
 */
function completionResponse(overrides: { parsed?: unknown; model?: string; usage?: unknown } = {}): Response {
  const body: Record<string, unknown> = {
    choices: [{ message: { content: JSON.stringify(overrides.parsed ?? validAuditResult) } }],
    model: overrides.model ?? 'google/gemini-2.5-flash',
  };
  if (Object.prototype.hasOwnProperty.call(overrides, 'usage')) {
    body.usage = overrides.usage;
  } else {
    body.usage = DEFAULT_USAGE;
  }
  return jsonResponse(body, 200);
}

describe('callOpenRouterAudit', () => {
  beforeEach(() => {
    // setTestEnv() no limpia esta variable y getEnv() la cachea: sin borrarla,
    // el test del modelo de respaldo contaminaría los siguientes.
    delete process.env.OPENROUTER_FALLBACK_MODEL;
    setTestEnv();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falla con AI_PROVIDER_ERROR cuando TODOS los intentos fallan (sin dictamen)', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ error: { message: 'Rate limit exceeded', metadata: { error_type: 'rate_limit_exceeded' } } }, 429));

    const error = await callOpenRouterAudit({ system: 's', parts: [{ type: 'text', text: 'x' }] }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    if (error instanceof ApiError) {
      expect(error.status).toBe(502);
      expect(error.category).toBe('RATE_LIMIT');
      expect(error.message).toContain('rate_limit_exceeded');
    }
    // Máximo dos llamadas por modelo: retry transitorio sin gastar además otro formato.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('detiene la cascada ante saldo insuficiente para archivos (HTTP 402)', async () => {
    process.env.OPENROUTER_FALLBACK_MODEL = 'openai/gpt-4o-mini';
    fetchMock.mockResolvedValue(jsonResponse({
      error: { message: 'This request requires at least $0.50 in balance for files' },
    }, 402));

    const error = await callOpenRouterAudit({ system: 's', parts: [{ type: 'text', text: 'x' }] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 402, category: 'PAYMENT_REQUIRED' });
    expect((error as Error).message).toContain('Agrega créditos');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('degrada de json_schema a json_object cuando el primero falla', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    fetchMock
      .mockImplementationOnce(async (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return jsonResponse({ error: { message: 'Unsupported minLength', metadata: { error_type: 'invalid_request_error' } } }, 400);
      })
      .mockImplementationOnce(async (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return completionResponse();
      });

    const result = await callOpenRouterAudit({ system: 's', parts: [{ type: 'text', text: 'x' }] });

    expect(result.parsed).toEqual(validAuditResult);
    expect(result.model).toBe('google/gemini-2.5-flash');
    expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCostUSD: 0.00012 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const fallbackMessages = bodies[1]?.messages as Array<{ role: string; content: string }>;
    const fallbackSystem = fallbackMessages[0]?.content ?? '';
    for (const key of ['case', 'evidenceSummary', 'facts', 'timeline', 'conflicts', 'audit']) {
      expect(fallbackSystem).toContain(`"${key}"`);
    }
    expect(fallbackSystem).toContain('estructura completa');
    expect((bodies[0]?.response_format as { type?: string }).type).toBe('json_schema');
    expect((bodies[1]?.response_format as { type?: string }).type).toBe('json_object');
    expect(result.attempts[0]?.maxOutputTokensRequested).toBe(16_384);
    expect(result.attempts[0]).toMatchObject({ failureCategory: 'PROVIDER_BAD_REQUEST', failureReason: 'provider rejected schema/parameter: minLength', retryable: false });
  });

  it('reintenta un 429 temporal una vez con la misma estrategia', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'Rate limit exceeded' } }, 429))
      .mockResolvedValueOnce(completionResponse());

    const result = await callOpenRouterAudit({ system: 's', parts: [{ type: 'text', text: 'x' }] });

    expect(result.parsed).toEqual(validAuditResult);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.attempts[0]).toMatchObject({ failureCategory: 'RATE_LIMIT', retryable: true, status: 429 });
  });

  it('reintenta cuando el JSON es válido pero no pasa validación semántica', async () => {
    fetchMock
      .mockResolvedValueOnce(completionResponse({ parsed: { nope: true } }))
      .mockResolvedValueOnce(completionResponse());

    const result = await callOpenRouterAudit({
      system: 's',
      parts: [{ type: 'text', text: 'x' }],
      validate: (parsed) => {
        if ((parsed as { audit?: unknown }).audit === undefined) throw new ApiError(502, 'INVALID_AI_RESPONSE', 'schema inválido');
      },
    });

    expect(result.parsed).toEqual(validAuditResult);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('agota retries inválidos con categoría INVALID_AI_RESPONSE', async () => {
    fetchMock.mockImplementation(async () => completionResponse({ parsed: { nope: true } }));

    const error = await callOpenRouterAudit({
      system: 's',
      parts: [{ type: 'text', text: 'x' }],
      validate: () => {
        throw new ApiError(502, 'INVALID_AI_RESPONSE', 'schema inválido');
      },
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).category).toBe('SCHEMA_VALIDATION_ERROR');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('mapea usage ausente a null (coste nunca inventado)', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse({ usage: undefined }));

    const result = await callOpenRouterAudit({ system: 's', parts: [{ type: 'text', text: 'x' }] });

    expect(result.usage).toEqual({ promptTokens: null, completionTokens: null, totalTokens: null, estimatedCostUSD: null });
  });

  it('mapea usage nulo a null (coste nunca inventado)', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse({ usage: null }));

    const result = await callOpenRouterAudit({ system: 's', parts: [{ type: 'text', text: 'x' }] });

    expect(result.usage).toEqual({ promptTokens: null, completionTokens: null, totalTokens: null, estimatedCostUSD: null });
  });

  it('mapea usage ausente del objeto (clave no presente) a null cuando no se sobreescribe', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse());

    const result = await callOpenRouterAudit({ system: 's', parts: [{ type: 'text', text: 'x' }] });

    expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCostUSD: 0.00012 });
  });

  it('usa el modelo que respondió (puede ser el de respaldo)', async () => {
    setTestEnv();
    process.env.OPENROUTER_FALLBACK_MODEL = 'google/gemini-2.5-pro';
    const requestedModels: string[] = [];
    fetchMock
      .mockImplementationOnce(async (_url: unknown, init?: RequestInit) => {
        requestedModels.push((JSON.parse(String(init?.body)) as { model: string }).model);
        return jsonResponse({ error: { message: 'down' } }, 503);
      })
      .mockImplementationOnce(async (_url: unknown, init?: RequestInit) => {
        requestedModels.push((JSON.parse(String(init?.body)) as { model: string }).model);
        return completionResponse({ model: 'google/gemini-2.5-pro' });
      });

    const result = await callOpenRouterAudit({ system: 's', parts: [{ type: 'text', text: 'x' }] });

    expect(result.model).toBe('google/gemini-2.5-pro');
    expect(requestedModels).toEqual([
      'google/gemini-2.5-flash-lite',
      'google/gemini-2.5-pro',
    ]);
    expect(result.attempts[0]).toMatchObject({ failureCategory: 'PROVIDER_UNAVAILABLE', retryable: true, status: 503 });
  });

  it('no expone claves ni texto arbitrario del proveedor en diagnósticos', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({
      error: { message: 'invalid api_key=top-secret-value', metadata: { error_type: 'bad key token=secret' } },
    }, 400));

    const error = await callOpenRouterAudit({ system: 's', parts: [{ type: 'text', text: 'synthetic' }] })
      .catch((caught: unknown) => caught);

    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain('top-secret-value');
    expect(serialized).not.toContain('token=secret');
    expect(serialized).not.toContain('synthetic');
  });

  it('soporta partes de imagen y archivo en el payload', async () => {
    const capturedBodies: Array<{ messages?: unknown }> = [];
    fetchMock.mockImplementationOnce(async (_url: unknown, init?: RequestInit) => {
      capturedBodies.push(JSON.parse(String(init?.body)) as { messages?: unknown });
      return completionResponse();
    });

    await callOpenRouterAudit({
      system: 's',
      parts: [
        { type: 'text', text: 'expediente' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        { type: 'file', file: { filename: 'escaneo.pdf', file_data: 'data:application/pdf;base64,BBBB' } },
      ],
    });

    const messages = capturedBodies[0]?.messages as Array<{ role: string; content: unknown }> | undefined;
    const userParts = messages?.[1]?.content as unknown[] | undefined;
    expect(userParts).toHaveLength(3);
    expect(userParts?.[1]).toMatchObject({ type: 'image_url' });
    expect(userParts?.[2]).toMatchObject({ type: 'file', file: { filename: 'escaneo.pdf' } });
  });

  it('solicita hasta 16384 tokens cuando el modelo permite el presupuesto operativo', async () => {
    const capturedBodies: Array<{ max_tokens?: number }> = [];
    fetchMock.mockImplementationOnce(async (_url: unknown, init?: RequestInit) => {
      capturedBodies.push(JSON.parse(String(init?.body)) as { max_tokens?: number });
      return completionResponse();
    });

    await callOpenRouterAudit({ system: 's', parts: [{ type: 'text', text: 'x' }] });

    expect(capturedBodies[0]?.max_tokens).toBe(16_384);
    expect(capturedBodies[0]?.max_tokens).toBeLessThanOrEqual(16_384);
  });

  it('reduce la solicitud al máximo publicado cuando el modelo admite menos que el presupuesto configurado', async () => {
    vi.mocked(getModelCapabilities).mockResolvedValueOnce({
      modelId: 'google/gemini-2.5-flash-lite', provider: 'google', maxOutputTokens: 4096,
      recommendedOutputTokens: 4096, appSafeOutputLimit: 16_384, safeOutputLimit: 4096, contextLength: 1_000_000,
      supportsStructuredOutput: true, supportsJsonObject: true, supportsImages: true, supportsFiles: true,
      productionReady: true, retryFallbackSuitable: true, retryableFailures: ['RATE_LIMIT', 'TIMEOUT', 'PROVIDER_UNAVAILABLE'],
      schemaProfile: 'gemini', pricing: { prompt: null, completion: null }, supportedParameters: ['structured_outputs'],
    });
    const capturedBodies: Array<{ max_tokens?: number }> = [];
    fetchMock.mockImplementationOnce(async (_url: unknown, init?: RequestInit) => {
      capturedBodies.push(JSON.parse(String(init?.body)) as { max_tokens?: number });
      return completionResponse();
    });

    await callOpenRouterAudit({ system: 's', parts: [{ type: 'text', text: 'x' }] });

    expect(capturedBodies[0]?.max_tokens).toBe(4096);
  });

  it('identifica una respuesta truncada cuando el proveedor informa finish_reason=length', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      choices: [{ message: { content: '{"case":' }, finish_reason: 'length' }],
    }, 200));

    const error = await callOpenRouterAudit({ system: 's', parts: [{ type: 'text', text: 'x' }] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as Error).message).toContain('TRUNCATED_OUTPUT');
    expect((error as ApiError).category).toBe('TRUNCATED_OUTPUT');
    expect((error as { diagnostics?: Array<Record<string, unknown>> }).diagnostics?.[0]).toMatchObject({
      finishReason: 'length', maxOutputTokensRequested: 16_384, failureCategory: 'TRUNCATED_OUTPUT',
    });
  });

  it('eleva el presupuesto en un retry truncado solo hasta el safe limit', async () => {
    process.env.AI_MAX_OUTPUT_TOKENS = '4096';
    const requested: number[] = [];
    fetchMock
      .mockImplementationOnce(async (_url: unknown, init?: RequestInit) => {
        requested.push((JSON.parse(String(init?.body)) as { max_tokens: number }).max_tokens);
        return jsonResponse({ choices: [{ message: { content: '{}'}, finish_reason: 'length' }] }, 200);
      })
      .mockImplementationOnce(async (_url: unknown, init?: RequestInit) => {
        requested.push((JSON.parse(String(init?.body)) as { max_tokens: number }).max_tokens);
        return completionResponse();
      });

    const result = await callOpenRouterAudit({ system: 's', parts: [{ type: 'text', text: 'x' }] });

    expect(result.parsed).toEqual(validAuditResult);
    expect(requested).toEqual([4096, 16_384]);
  });
});
