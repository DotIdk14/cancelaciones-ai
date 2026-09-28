import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callOpenRouterAudit } from '../src/server/openrouter';
import { ApiError } from '../src/server/http';
import { setTestEnv } from './helpers/env';
import { validAuditResult } from './fixtures/audit-result';

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
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'Rate limit exceeded', metadata: { error_type: 'rate_limit_exceeded' } } }, 429));

    const error = await callOpenRouterAudit({ system: 's', parts: [{ type: 'text', text: 'x' }] }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    if (error instanceof ApiError) {
      expect(error.status).toBe(502);
      expect(error.category).toBe('AI_PROVIDER_ERROR');
      expect(error.message).toContain('rate_limit_exceeded');
    }
    // Sin fallback configurado: 2 intentos (primary json_schema → primary json_object).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('degrada de json_schema a json_object cuando el primero falla', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'schema not supported', metadata: { error_type: 'invalid_request_error' } } }, 400))
      .mockResolvedValueOnce(completionResponse());

    const result = await callOpenRouterAudit({ system: 's', parts: [{ type: 'text', text: 'x' }] });

    expect(result.parsed).toEqual(validAuditResult);
    expect(result.model).toBe('google/gemini-2.5-flash');
    expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCostUSD: 0.00012 });
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
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'down' } }, 503));
    fetchMock.mockResolvedValueOnce(completionResponse({ model: 'google/gemini-2.5-pro' }));

    const result = await callOpenRouterAudit({ system: 's', parts: [{ type: 'text', text: 'x' }] });

    expect(result.model).toBe('google/gemini-2.5-pro');
  });

  it('soporta partes de imagen y archivo en el payload', async () => {
    let capturedBody: { messages?: unknown } | null = null;
    fetchMock.mockImplementationOnce(async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
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

    const messages = capturedBody?.messages as Array<{ role: string; content: unknown }> | undefined;
    const userParts = messages?.[1]?.content as unknown[] | undefined;
    expect(userParts).toHaveLength(3);
    expect(userParts?.[1]).toMatchObject({ type: 'image_url' });
    expect(userParts?.[2]).toMatchObject({ type: 'file', file: { filename: 'escaneo.pdf' } });
  });
});