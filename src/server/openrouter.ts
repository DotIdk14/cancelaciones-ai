// =============================================================================
// OpenRouter — transporte de IA del Audit Skill (sección 7 del encargo).
// =============================================================================
// Único módulo que habla con OpenRouter. Estrategia de robustez:
//   1. modelo primario con `response_format: json_schema` (strict)
//   2. modelo primario con `response_format: json_object`
//   3. modelo de respaldo con `json_schema`
//   4. modelo de respaldo con `json_object`
// La validación final SIEMPRE la hace Zod (parseAuditResult). Si todos los
// intentos fallan se lanza AI_PROVIDER_ERROR: jamás se fabrica un dictamen.
// =============================================================================

import { zodToJsonSchema } from 'zod-to-json-schema';
import { AuditResultSchema } from '../skills/audit/schema';
import type { ModelUsage } from '../skills/audit/types';
import { getEnv } from './env';
import { ApiError } from './http';

export type OpenRouterContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

export interface CallOpenRouterAuditInput {
  system: string;
  parts: OpenRouterContentPart[];
  /** Milisegundos por intento (por defecto 180_000). */
  timeoutMs?: number;
}

export interface CallOpenRouterAuditOutput {
  /** JSON ya parseado (sin validar; la validación Zod ocurre en el Skill). */
  parsed: unknown;
  /** Modelo que realmente respondió. */
  model: string;
  /** Uso reportado por OpenRouter (null cuando no venga; nunca inventado). */
  usage: ModelUsage;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 180_000;

/** Deriva el JSON Schema estricto del schema único de Zod. */
function buildStrictJsonSchema(schema: unknown): Record<string, unknown> {
  const base = schema as Record<string, unknown>;
  const { $schema, ...rest } = base;
  const out: Record<string, unknown> = { ...rest };
  applyAdditionalPropertiesFalse(out);
  return out;
}

function applyAdditionalPropertiesFalse(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) applyAdditionalPropertiesFalse(item);
    return;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (obj.type === 'object' && typeof obj.properties === 'object' && obj.properties !== null) {
      obj.additionalProperties = false;
    }
    for (const key of Object.keys(obj)) applyAdditionalPropertiesFalse(obj[key]);
  }
}

const AUDIT_JSON_SCHEMA = buildStrictJsonSchema(
  zodToJsonSchema(AuditResultSchema, { name: 'AuditResult', $refStrategy: 'none' }),
);

interface AttemptSpec {
  model: string;
  format: 'json_schema' | 'json_object';
}

function toModelUsage(usage: unknown): ModelUsage {
  const empty: ModelUsage = {
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    estimatedCostUSD: null,
  };
  if (!usage || typeof usage !== 'object') return empty;
  const u = usage as Record<string, unknown>;
  const num = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  return {
    promptTokens: num(u.prompt_tokens),
    completionTokens: num(u.completion_tokens),
    totalTokens: num(u.total_tokens),
    // OpenRouter devuelve `cost` SIEMPRE (en créditos USD); null/0/ausente ⇒ no disponible.
    estimatedCostUSD: num(u.cost) ?? null,
  };
}

async function singleAttempt(
  attempt: AttemptSpec,
  input: CallOpenRouterAuditInput,
  timeoutMs: number,
): Promise<CallOpenRouterAuditOutput> {
  const env = getEnv();
  const body: Record<string, unknown> = {
    model: attempt.model,
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.parts },
    ],
    temperature: 0,
    max_tokens: 4096,
  };

  if (attempt.format === 'json_schema') {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'AuditResult', strict: true, schema: AUDIT_JSON_SCHEMA },
    };
    // Excluye providers que no soporten los parámetros en vez de ignorarlos
    // silenciosamente (OpenRouter los ignora si ninguno los soporta).
    body.provider = { require_parameters: true };
  } else {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': env.APP_URL,
        'X-Title': 'Cancelaciones AI',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const raw = await response.text();
    let parsedBody: unknown = null;
    try {
      parsedBody = JSON.parse(raw);
    } catch {
      parsedBody = null;
    }

    if (!response.ok) {
      const errInfo = parsedBody as {
        error?: { message?: string; metadata?: { error_type?: string } };
      } | null;
      const reason =
        errInfo?.error?.metadata?.error_type ?? errInfo?.error?.message ?? response.statusText;
      throw new Error(`HTTP ${response.status} (${reason})`);
    }

    const okBody = parsedBody as {
      choices?: Array<{ message?: { content?: string | null } }>;
      model?: unknown;
      usage?: unknown;
    } | null;
    const content = okBody?.choices?.[0]?.message?.content;
    if (!content || content.trim().length === 0) {
      throw new Error('respuesta sin contenido');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('el contenido no es JSON válido');
    }

    return {
      parsed,
      model: typeof okBody?.model === 'string' ? okBody.model : attempt.model,
      usage: toModelUsage(okBody?.usage),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Llama a OpenRouter para auditar. Reintenta en cascada
 * (primario→json_object→respaldo→json_object). Nunca inventa resultados:
 * si todo falla lanza ApiError(AI_PROVIDER_ERROR).
 */
export async function callOpenRouterAudit(
  input: CallOpenRouterAuditInput,
): Promise<CallOpenRouterAuditOutput> {
  const env = getEnv();
  const timeoutMs = input.timeoutMs ?? (Number(process.env.AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);

  const attempts: AttemptSpec[] = [
    { model: env.OPENROUTER_MODEL, format: 'json_schema' },
    { model: env.OPENROUTER_MODEL, format: 'json_object' },
  ];
  if (env.OPENROUTER_FALLBACK_MODEL) {
    attempts.push(
      { model: env.OPENROUTER_FALLBACK_MODEL, format: 'json_schema' },
      { model: env.OPENROUTER_FALLBACK_MODEL, format: 'json_object' },
    );
  }

  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      return await singleAttempt(attempt, input, timeoutMs);
    } catch (error) {
      failures.push(
        `${attempt.model} [${attempt.format}]: ${error instanceof Error ? error.message : 'error desconocido'}`,
      );
    }
  }

  throw new ApiError(
    502,
    'AI_PROVIDER_ERROR',
    `OpenRouter no pudo producir un resultado válido: ${failures.join(' | ')}`,
  );
}