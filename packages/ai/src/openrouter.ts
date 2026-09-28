import { estimateCostUsd, MAX_PROVIDER_ATTEMPTS, PROVIDER_TIMEOUT_MS, type AiCallRecord } from '@cancelaciones/shared';
import type { z } from 'zod';

type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface OpenRouterProviderConfig {
  apiKey: string;
  appUrl: string;
  fastModel: string;
  analystModel: string;
  reviewerModel: string;
  visionModel: string;
  fetchImpl?: FetchImpl;
}

export interface GenerateStructuredInput<T> {
  model: string;
  purpose: string;
  system?: string;
  user: string;
  schema: z.ZodType<T>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AssistantToolMessage {
  content: string;
  toolCalls?: ToolCall[];
  message?: unknown;
  usage: AiCallRecord;
}

export class OpenRouterProvider {
  readonly name = 'openrouter';
  readonly fastModel: string;
  readonly analystModel: string;
  readonly reviewerModel: string;
  readonly visionModel: string;
  private readonly apiKey: string;
  private readonly appUrl: string;
  private readonly fetchImpl: FetchImpl;

  constructor(config: OpenRouterProviderConfig) {
    this.apiKey = config.apiKey;
    this.appUrl = config.appUrl;
    this.fastModel = config.fastModel;
    this.analystModel = config.analystModel;
    this.reviewerModel = config.reviewerModel;
    this.visionModel = config.visionModel;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async generateStructured<T>(input: GenerateStructuredInput<T>): Promise<{ value: T; raw: string; usage: AiCallRecord }> {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = input.timeoutMs ? setTimeout(() => controller.abort(), input.timeoutMs) : null;
    const abortFromCaller = () => controller.abort();
    input.signal?.addEventListener('abort', abortFromCaller, { once: true });

    try {
      const messages = [
        ...(input.system ? [{ role: 'system', content: input.system }] : []),
        { role: 'user', content: input.user },
      ];
      const response = await this.fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          'http-referer': this.appUrl,
        },
        body: JSON.stringify({ model: input.model, messages, response_format: { type: 'json_object' } }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`OPENROUTER_HTTP_${response.status}`);
      const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const raw = body.choices?.[0]?.message?.content ?? '';
      const parsed = parseJsonFromMessage(raw);
      const value = input.schema.parse(parsed);
      const inputTokens = body.usage?.prompt_tokens ?? null;
      const outputTokens = body.usage?.completion_tokens ?? null;
      return {
        value,
        raw,
        usage: {
          provider: 'openrouter',
          model: input.model,
          purpose: input.purpose,
          inputTokens,
          outputTokens,
          estimatedCostUsd: estimateCostUsd(input.model, inputTokens, outputTokens),
          latencyMs: Date.now() - started,
          errorCode: null,
        },
      };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('OPENROUTER_TIMEOUT');
      if (error instanceof SyntaxError) throw new Error('OPENROUTER_INVALID_JSON');
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
      input.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  async generateWithTools(input: { model: string; purpose: string; system?: string; messages: unknown[]; tools?: ToolDefinition[]; toolChoice?: unknown; timeoutMs?: number; signal?: AbortSignal }): Promise<AssistantToolMessage> {
    const started = Date.now();
    const messages = [...(input.system ? [{ role: 'system', content: input.system }] : []), ...input.messages];
    const tools = input.tools?.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? PROVIDER_TIMEOUT_MS);
      const abortFromCaller = () => controller.abort();
      input.signal?.addEventListener('abort', abortFromCaller, { once: true });
      try {
        const response = await this.fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', 'http-referer': this.appUrl },
          body: JSON.stringify({ model: input.model, messages, tools, tool_choice: input.toolChoice }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = new Error(`OPENROUTER_HTTP_${response.status}`);
          if (!isRetryableStatus(response.status) || attempt >= MAX_PROVIDER_ATTEMPTS) throw error;
          lastError = error;
          continue;
        }
        const body = await response.json() as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        const message = body.choices?.[0]?.message;
        const inputTokens = body.usage?.prompt_tokens ?? null;
        const outputTokens = body.usage?.completion_tokens ?? null;
        return {
          content: message?.content ?? '',
          message,
          toolCalls: message?.tool_calls?.map((call, index) => ({
            id: call.id ?? `tool-${index}`,
            name: call.function?.name ?? '',
            arguments: parseToolArguments(call.function?.arguments),
          })),
          usage: {
            provider: 'openrouter',
            model: input.model,
            purpose: input.purpose,
            inputTokens,
            outputTokens,
            estimatedCostUsd: estimateCostUsd(input.model, inputTokens, outputTokens),
            latencyMs: Date.now() - started,
            errorCode: null,
          },
        };
      } catch (error) {
        const callerAborted = input.signal?.aborted === true;
        const timeoutError = controller.signal.aborted && !callerAborted;
        lastError = timeoutError ? new Error('OPENROUTER_TIMEOUT') : error;
        if (callerAborted || !timeoutError || attempt >= MAX_PROVIDER_ATTEMPTS) break;
      } finally {
        clearTimeout(timeout);
        input.signal?.removeEventListener('abort', abortFromCaller);
      }
    }
    throw lastError;
  }

  async describeImage(input: { base64: string; mimeType: string; filename: string; prompt: string; timeoutMs: number; signal?: AbortSignal }): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null; model: string }> {
    return this.describeMultimodal({ ...input, contentType: 'image_url' });
  }

  async describeDocument(input: { base64: string; mimeType: string; filename: string; prompt: string; timeoutMs: number; signal?: AbortSignal }): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null; model: string }> {
    return this.describeMultimodal({ ...input, contentType: 'file' });
  }

  private async describeMultimodal(input: { base64: string; mimeType: string; filename: string; prompt: string; timeoutMs: number; signal?: AbortSignal; contentType: 'image_url' | 'file' }): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null; model: string }> {
    const dataUrl = `data:${input.mimeType};base64,${input.base64}`;
    const content = input.contentType === 'image_url'
      ? [{ type: 'text', text: input.prompt }, { type: 'image_url', image_url: { url: dataUrl } }]
      : [{ type: 'text', text: input.prompt }, { type: 'file', file: { filename: input.filename, file_data: dataUrl } }];

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
      const abortFromCaller = () => controller.abort();
      input.signal?.addEventListener('abort', abortFromCaller, { once: true });
      try {
        const response = await this.fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', 'http-referer': this.appUrl },
          body: JSON.stringify({ model: this.visionModel, messages: [{ role: 'user', content }] }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`OPENROUTER_HTTP_${response.status}`);
        const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        const text = body.choices?.[0]?.message?.content?.trim() ?? '';
        if (!text) throw new Error('OPENROUTER_EMPTY_VISION_RESPONSE');
        return {
          text,
          inputTokens: body.usage?.prompt_tokens ?? null,
          outputTokens: body.usage?.completion_tokens ?? null,
          model: this.visionModel,
        };
      } catch (error) {
        lastError = controller.signal.aborted ? new Error('OPENROUTER_TIMEOUT') : error;
        if (attempt >= MAX_PROVIDER_ATTEMPTS) break;
      } finally {
        clearTimeout(timeout);
        input.signal?.removeEventListener('abort', abortFromCaller);
      }
    }
    throw lastError;
  }
}

function parseJsonFromMessage(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  try {
    return JSON.parse(fenced ?? raw);
  } catch {
    throw new Error('OPENROUTER_INVALID_JSON');
  }
}

function parseToolArguments(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
