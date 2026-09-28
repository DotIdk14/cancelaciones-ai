import { estimateCostUsd, type AiCallRecord } from '@cancelaciones/shared';
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

export interface AssistantToolMessage {
  content: string;
  toolCalls?: ToolCall[];
  finalAssessment?: unknown;
}

export class OpenRouterProvider {
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

  async generateWithTools(input: { model: string; purpose?: string; messages?: unknown[]; tools?: unknown[]; user?: string; signal?: AbortSignal }): Promise<AssistantToolMessage> {
    const response = await this.fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', 'http-referer': this.appUrl },
      body: JSON.stringify({ model: input.model, messages: input.messages ?? [{ role: 'user', content: input.user ?? '' }], tools: input.tools }),
      signal: input.signal,
    });
    if (!response.ok) throw new Error(`OPENROUTER_HTTP_${response.status}`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }> };
    const message = body.choices?.[0]?.message;
    return {
      content: message?.content ?? '',
      toolCalls: message?.tool_calls?.map((call, index) => ({
        id: call.id ?? `tool-${index}`,
        name: call.function?.name ?? '',
        arguments: parseToolArguments(call.function?.arguments),
      })),
    };
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
