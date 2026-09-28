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

  test('describeImage envia prompt e imagen como data URL y devuelve texto', async () => {
    let payload: any;
    const provider = new OpenRouterProvider({
      apiKey: 'test', appUrl: 'http://localhost', fastModel: 'm', analystModel: 'm', reviewerModel: 'm', visionModel: 'vision-model',
      fetchImpl: async (_url, init) => {
        payload = JSON.parse(String(init?.body));
        return response({ choices: [{ message: { content: 'Texto visible' } }], usage: { prompt_tokens: 7, completion_tokens: 8 } });
      },
    });

    const result = await provider.describeImage({ base64: 'aGVsbG8=', mimeType: 'image/png', filename: 'captura.png', prompt: 'Transcribe literal', timeoutMs: 1000 });

    expect(payload.model).toBe('vision-model');
    expect(payload.messages[0].content[0]).toEqual({ type: 'text', text: 'Transcribe literal' });
    expect(payload.messages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } });
    expect(result).toEqual({ text: 'Texto visible', inputTokens: 7, outputTokens: 8, model: 'vision-model' });
  });

  test('generateWithTools envia esquema OpenAI, historial intacto y parsea tool_calls', async () => {
    let request: { messages: unknown[]; tools: unknown[] } | undefined;
    const provider = new OpenRouterProvider({
      apiKey: 'test', appUrl: 'http://localhost', fastModel: 'm', analystModel: 'm', reviewerModel: 'm', visionModel: 'm',
      fetchImpl: async (_url, init) => {
        request = JSON.parse(String(init?.body));
        return response({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'readEvidence', arguments: '{"evidenceId":"ev-1"}' } }] } }], usage: { prompt_tokens: 4, completion_tokens: 5 } });
      },
    });
    const result = await provider.generateWithTools({
      model: 'm',
      purpose: 'analyst',
      system: 's',
      messages: [
        { role: 'user', content: 'u' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'prev', type: 'function', function: { name: 'listEvidence', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'prev', content: '[]' },
      ],
      tools: [{ name: 'readEvidence', description: 'Lee evidencia', parameters: { type: 'object', properties: { evidenceId: { type: 'string' } }, required: ['evidenceId'] } }],
    });
    expect(request?.messages).toEqual([{ role: 'system', content: 's' }, { role: 'user', content: 'u' }, { role: 'assistant', content: '', tool_calls: [{ id: 'prev', type: 'function', function: { name: 'listEvidence', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'prev', content: '[]' }]);
    expect(request?.tools).toEqual([{ type: 'function', function: { name: 'readEvidence', description: 'Lee evidencia', parameters: { type: 'object', properties: { evidenceId: { type: 'string' } }, required: ['evidenceId'] } } }]);
    expect(result.toolCalls).toEqual([{ id: 'call-1', name: 'readEvidence', arguments: { evidenceId: 'ev-1' } }]);
    expect(result.usage.inputTokens).toBe(4);
  });

  test('generateWithTools reintenta una vez HTTP 429 recuperable', async () => {
    let attempts = 0;
    const provider = new OpenRouterProvider({
      apiKey: 'test', appUrl: 'http://localhost', fastModel: 'm', analystModel: 'm', reviewerModel: 'm', visionModel: 'm',
      fetchImpl: async () => {
        attempts += 1;
        return attempts === 1 ? response({}, { status: 429 }) : response({ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: {} });
      },
    });
    const result = await provider.generateWithTools({ model: 'm', purpose: 'analyst', messages: [{ role: 'user', content: 'u' }] });
    expect(result.content).toBe('ok');
    expect(attempts).toBe(2);
  });
});
