import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { OpenRouterProvider } from './openrouter';

function response(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

describe('OpenRouterProvider', () => {
  test('generateStructured valida Zod', async () => {
    const provider = new OpenRouterProvider({
      apiKey: 'test', appUrl: 'http://localhost', fastModel: 'm', analystModel: 'm', reviewerModel: 'm', visionModel: 'm',
      fetchImpl: async () => response({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 2, completion_tokens: 3 } }),
    });
    const result = await provider.generateStructured({ model: 'm', purpose: 'test', user: 'u', schema: z.object({ ok: z.boolean() }) });
    expect(result.value.ok).toBe(true);
    expect(result.usage.inputTokens).toBe(2);
  });

  test('generateStructured rechaza JSON invalido', async () => {
    const provider = new OpenRouterProvider({
      apiKey: 'test', appUrl: 'http://localhost', fastModel: 'm', analystModel: 'm', reviewerModel: 'm', visionModel: 'm',
      fetchImpl: async () => response({ choices: [{ message: { content: 'no-json' } }], usage: {} }),
    });
    await expect(provider.generateStructured({ model: 'm', purpose: 'test', user: 'u', schema: z.object({ ok: z.boolean() }) })).rejects.toThrow('OPENROUTER_INVALID_JSON');
  });

  test('timeout aborta con OPENROUTER_TIMEOUT', async () => {
    const provider = new OpenRouterProvider({
      apiKey: 'test', appUrl: 'http://localhost', fastModel: 'm', analystModel: 'm', reviewerModel: 'm', visionModel: 'm',
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    });
    await expect(provider.generateStructured({ model: 'm', purpose: 'test', user: 'u', schema: z.object({ ok: z.boolean() }), timeoutMs: 1 })).rejects.toThrow('OPENROUTER_TIMEOUT');
  });
});
