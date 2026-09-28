import { describe, expect, test } from 'vitest';
import { MAX_PROVIDER_ATTEMPTS } from '@cancelaciones/shared';
import { OpenRouterProvider, type ToolDefinition } from './openrouter';
import { analystToolDefinitions, reviewerToolDefinitions } from './tools';

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function assistantWithCalls(calls: Array<{ id: string; name: string; args: string }>): Response {
  return ok({
    choices: [{ message: { role: 'assistant', content: null, tool_calls: calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.args } })) } }],
    usage: { prompt_tokens: 3, completion_tokens: 4 },
  });
}

function provider(fetchImpl: (url: string | URL, init?: RequestInit) => Promise<Response>) {
  return new OpenRouterProvider({
    apiKey: 'test',
    appUrl: 'http://localhost',
    fastModel: 'm',
    analystModel: 'm',
    reviewerModel: 'm',
    visionModel: 'vision-model',
    fetchImpl,
  });
}

describe('generateWithTools: presupuesto de intentos', () => {
  test('un 503 insistente se intenta MAX_PROVIDER_ATTEMPTS veces y el error se propaga', async () => {
    let calls = 0;
    const client = provider(async () => {
      calls += 1;
      return new Response('', { status: 503 });
    });

    await expect(
      client.generateWithTools({ model: 'm', purpose: 'analyst', messages: [{ role: 'user', content: 'u' }] }),
    ).rejects.toThrow('OPENROUTER_HTTP_503');

    // Ni uno más (se cobra dos veces una llamada caída) ni uno menos (no habría
    // tolerancia a un 503 transitorio del proveedor).
    expect(calls).toBe(MAX_PROVIDER_ATTEMPTS);
    expect(MAX_PROVIDER_ATTEMPTS).toBe(2);
  });

  test('un 400 no se reintenta: el mismo request volverá a fallar igual', async () => {
    let calls = 0;
    const client = provider(async () => {
      calls += 1;
      return new Response('bad request', { status: 400 });
    });

    await expect(
      client.generateWithTools({ model: 'm', purpose: 'analyst', messages: [{ role: 'user', content: 'u' }] }),
    ).rejects.toThrow('OPENROUTER_HTTP_400');
    expect(calls).toBe(1);
  });

  test('un 401 no se reintenta tampoco', async () => {
    let calls = 0;
    const client = provider(async () => {
      calls += 1;
      return new Response('', { status: 401 });
    });

    await expect(
      client.generateWithTools({ model: 'm', purpose: 'analyst', messages: [{ role: 'user', content: 'u' }] }),
    ).rejects.toThrow('OPENROUTER_HTTP_401');
    expect(calls).toBe(1);
  });

  test('el timeout aborta la llamada y termina en OPENROUTER_TIMEOUT, no en un error opaco', async () => {
    let calls = 0;
    const client = provider((_url, init) => {
      calls += 1;
      // Doble que respeta el signal, como el fetch real: si no lo respetara, el
      // timeout del runtime no podría cortar nada.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });

    await expect(
      client.generateWithTools({ model: 'm', purpose: 'analyst', messages: [{ role: 'user', content: 'u' }], timeoutMs: 5 }),
    ).rejects.toThrow('OPENROUTER_TIMEOUT');
    expect(calls).toBe(MAX_PROVIDER_ATTEMPTS);
  });

  test('el timeout no se dispara cuando el modelo responde a tiempo', async () => {
    let calls = 0;
    const client = provider(async () => {
      calls += 1;
      return assistantWithCalls([{ id: 'c1', name: 'listEvidence', args: '{}' }]);
    });

    const result = await client.generateWithTools({
      model: 'm',
      purpose: 'analyst',
      messages: [{ role: 'user', content: 'u' }],
      timeoutMs: 10_000,
    });

    expect(calls).toBe(1);
    expect(result.toolCalls).toEqual([{ id: 'c1', name: 'listEvidence', arguments: {} }]);
  });

  test('la cancelación del llamador sale como AbortError y no como timeout del proveedor', async () => {
    const controller = new AbortController();
    const client = provider((_url, init) => {
      queueMicrotask(() => controller.abort());
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });

    await expect(
      client.generateWithTools({ model: 'm', purpose: 'analyst', messages: [{ role: 'user', content: 'u' }], signal: controller.signal, timeoutMs: 10_000 }),
    ).rejects.toThrow(/AbortError|aborted/);
  });
});

describe('generateWithTools: cuerpo de la petición', () => {
  test('todas las tool definitions del analista llegan con nombre, descripción y esquema', async () => {
    let body: { tools?: unknown[]; messages?: unknown[] } | undefined;
    const client = provider(async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return assistantWithCalls([]);
    });

    await client.generateWithTools({
      model: 'm',
      purpose: 'analyst',
      system: 'system de prueba',
      messages: [{ role: 'user', content: 'u' }],
      tools: analystToolDefinitions,
    });

    const sent = body?.tools as Array<{ type: string; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
    expect(sent).toHaveLength(analystToolDefinitions.length);
    for (const [index, definition] of analystToolDefinitions.entries()) {
      expect(sent[index]).toEqual({ type: 'function', function: { name: definition.name, description: definition.description, parameters: definition.parameters } });
      expect(definition.description.length).toBeGreaterThan(20);
      expect(definition.parameters.type).toBe('object');
    }
    // El system va delante de todo el historial, no dentro.
    expect((body?.messages as Array<{ role: string }>)[0]).toEqual({ role: 'system', content: 'system de prueba' });
  });

  test('el revisor recibe una tool menos: la terminal no se ofrece', async () => {
    let body: { tools?: Array<{ function: { name: string } }> } | undefined;
    const client = provider(async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return assistantWithCalls([]);
    });

    await client.generateWithTools({ model: 'm', purpose: 'audit-reviewer', messages: [{ role: 'user', content: 'u' }], tools: reviewerToolDefinitions });

    const names = (body?.tools ?? []).map((tool) => tool.function.name);
    expect(names).not.toContain('submitAssessment');
    expect(names).toContain('readPolicySection');
  });

  test('los argumentos de una tool que no son JSON no rompen el turno', async () => {
    const client = provider(async () => assistantWithCalls([{ id: 'c1', name: 'searchPolicy', args: 'query=desistimiento' }]));

    const result = await client.generateWithTools({ model: 'm', purpose: 'analyst', messages: [{ role: 'user', content: 'u' }] });

    // Se entrega crudo en vez de inventar un objeto vacío: un `{}` silencioso
    // haría que searchPolicy buscara la cadena vacía y pareciera un Expedente mudo.
    expect(result.toolCalls).toEqual([{ id: 'c1', name: 'searchPolicy', arguments: 'query=desistimiento' }]);
  });
});

describe('describeDocument: el camino de PDF escaneado', () => {
  test('envía el archivo como bloque file con data URL y nombre, no como image_url', async () => {
    let body: { model: string; messages: Array<{ content: Array<Record<string, unknown>> }> } | undefined;
    const client = provider(async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return ok({ choices: [{ message: { content: '  TRANSCRIPCION  ' } }], usage: { prompt_tokens: 11, completion_tokens: 12 } });
    });

    const result = await client.describeDocument({
      base64: Buffer.from('%PDF-1.7').toString('base64'),
      mimeType: 'application/pdf',
      filename: 'escaneado.pdf',
      prompt: 'Transcribe literalmente',
      timeoutMs: 1_000,
    });

    expect(body?.model).toBe('vision-model');
    const content = body!.messages[0]!.content;
    expect(content[0]).toEqual({ type: 'text', text: 'Transcribe literalmente' });
    expect(content[1]).toEqual({
      type: 'file',
      file: { filename: 'escaneado.pdf', file_data: `data:application/pdf;base64,${Buffer.from('%PDF-1.7').toString('base64')}` },
    });
    // El texto se recorta: un whitespace de más se leería como contenido vacío.
    expect(result).toEqual({ text: 'TRANSCRIPCION', inputTokens: 11, outputTokens: 12, model: 'vision-model' });
  });

  test('una respuesta de visión vacía es un fallo, no un texto vacío', async () => {
    const client = provider(async () => ok({ choices: [{ message: { content: '   ' } }], usage: {} }));

    await expect(
      client.describeImage({ base64: 'aGk=', mimeType: 'image/png', filename: 'a.png', prompt: 'p', timeoutMs: 1_000 }),
    ).rejects.toThrow('OPENROUTER_EMPTY_VISION_RESPONSE');
  });

  test('describeImage y describeDocument comparten presupuesto de intentos pero no payload', async () => {
    let calls = 0;
    const client = provider(async () => {
      calls += 1;
      return new Response('', { status: 502 });
    });

    await expect(
      client.describeImage({ base64: 'aGk=', mimeType: 'image/png', filename: 'a.png', prompt: 'p', timeoutMs: 1_000 }),
    ).rejects.toThrow('OPENROUTER_HTTP_502');
    expect(calls).toBe(MAX_PROVIDER_ATTEMPTS);
  });
});

describe('tipos de tool definition', () => {
  test('una tool definition mínima se convierte igual', async () => {
    const tools: ToolDefinition[] = [{ name: 'noop', description: 'no hace nada', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } }];
    let body: { tools?: unknown[] } | undefined;
    const client = provider(async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return assistantWithCalls([]);
    });

    await client.generateWithTools({ model: 'm', purpose: 'analyst', messages: [{ role: 'user', content: 'u' }], tools });
    expect(body?.tools).toEqual([{ type: 'function', function: { name: 'noop', description: 'no hace nada', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } }]);
  });
});
