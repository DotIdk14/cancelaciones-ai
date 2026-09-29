// =============================================================================
// OpenRouter — transporte de IA del Audit Skill (sección 7 del encargo).
// =============================================================================
// Único módulo que habla con OpenRouter. Hay un máximo de dos llamadas reales:
// un 400 de json_schema cambia a json_object; fallos transitorios usan retry o
// fallback sin repetir una llamada determinista. Zod sigue siendo autoridad.
// =============================================================================

import { AiAuditAssessmentSchema } from '../skills/audit/schema.js';
import type { ModelUsage } from '../skills/audit/types.js';
import { getModelCapabilities, resolveOutputTokenBudget, type ModelCapabilities } from './ai/model-capabilities.js';
import { buildJsonObjectContract, buildProviderJsonSchema } from './ai/provider-schema.js';
import { getEnv } from './env.js';
import { ApiError } from './http.js';

export type OpenRouterContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

export interface CallOpenRouterAuditInput {
  system: string;
  parts: OpenRouterContentPart[];
  /** Milisegundos por intento. */
  timeoutMs?: number;
  /** Deadline global epoch ms; cada intento usa sólo el tiempo restante. */
  deadlineMs?: number;
  /** Validador semántico/Zod aplicado localmente antes de aceptar la respuesta. */
  validate?: (parsed: unknown) => void;
}

export interface CallOpenRouterAuditOutput {
  /** JSON ya parseado (sin validar; la validación Zod ocurre en el Skill). */
  parsed: unknown;
  /** Modelo que realmente respondió. */
  model: string;
  /** Uso reportado por OpenRouter (null cuando no venga; nunca inventado). */
  usage: ModelUsage;
  attempts: OpenRouterAttemptDiagnostic[];
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MIN_ATTEMPT_BUDGET_MS = 1_000;

export type AttemptFailureCategory =
  | 'PROVIDER_BAD_REQUEST'
  | 'RATE_LIMIT'
  | 'PAYMENT_REQUIRED'
  | 'PROVIDER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'INVALID_JSON'
  | 'SCHEMA_VALIDATION_ERROR'
  | 'INVALID_EVIDENCE_REFERENCE'
  | 'TRUNCATED_OUTPUT'
  | 'UNSUPPORTED_MODEL_CAPABILITY'
  | 'CAPABILITY_CATALOG_UNAVAILABLE';

export interface OpenRouterAttemptDiagnostic {
  model: string;
  format: 'json_schema' | 'json_object' | 'capability';
  status: number | null;
  providerErrorType: string | null;
  finishReason: string | null;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cost: number | null;
  maxOutputTokensRequested: number | null;
  /** `false` si las capacidades salieron del perfil conocido sin confirmar el catálogo. */
  capabilitiesVerified: boolean;
  retryable: boolean;
  failureCategory: AttemptFailureCategory | null;
  failureReason: string | null;
}

export class OpenRouterAuditError extends ApiError {
  constructor(category: AttemptFailureCategory, readonly diagnostics: OpenRouterAttemptDiagnostic[], message: string, status = 502) {
    const publicCategory = category === 'INVALID_JSON'
      ? 'INVALID_AI_RESPONSE'
      : category === 'TIMEOUT'
        ? 'PROVIDER_UNAVAILABLE'
        : category === 'PROVIDER_BAD_REQUEST'
          ? 'UNSUPPORTED_MODEL_CAPABILITY'
          : category;
    super(status, publicCategory, message);
    this.name = 'OpenRouterAuditError';
  }
}

interface AttemptSpec {
  model: string;
  format: 'json_schema' | 'json_object';
  capabilities: ModelCapabilities;
  maxTokens: number;
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

class AttemptFailure extends Error {
  constructor(readonly diagnostic: OpenRouterAttemptDiagnostic, message: string) {
    super(message);
  }
}

function diagnostic(
  attempt: AttemptSpec,
  startedAt: number,
  usage?: unknown,
  fields: Partial<OpenRouterAttemptDiagnostic> = {},
): OpenRouterAttemptDiagnostic {
  const modelUsage = toModelUsage(usage);
  return {
    model: attempt.model,
    format: attempt.format,
    status: null,
    providerErrorType: null,
    finishReason: null,
    latencyMs: Date.now() - startedAt,
    promptTokens: modelUsage.promptTokens,
    completionTokens: modelUsage.completionTokens,
    totalTokens: modelUsage.totalTokens,
    cost: modelUsage.estimatedCostUSD,
    maxOutputTokensRequested: attempt.maxTokens,
    capabilitiesVerified: attempt.capabilities.catalogVerified,
    retryable: false,
    failureCategory: null,
    failureReason: null,
    ...fields,
  };
}

function safeProviderReason(message: string): string {
  const knownKeywords = ['minLength', 'maxLength', 'minimum', 'maximum', 'additionalProperties', 'anyOf', 'max_tokens', 'response_format'];
  const keyword = knownKeywords.find((candidate) => message.toLowerCase().includes(candidate.toLowerCase()));
  if (keyword) return `provider rejected schema/parameter: ${keyword}`;
  if (/unsupported|not supported/i.test(message)) return 'provider rejected an unsupported parameter';
  return 'provider rejected request';
}

function failureCategoryForStatus(status: number): AttemptFailureCategory {
  if (status === 400) return 'PROVIDER_BAD_REQUEST';
  if (status === 402) return 'PAYMENT_REQUIRED';
  if (status === 429) return 'RATE_LIMIT';
  return status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_BAD_REQUEST';
}

async function singleAttempt(
  attempt: AttemptSpec,
  input: CallOpenRouterAuditInput,
  timeoutMs: number,
): Promise<CallOpenRouterAuditOutput> {
  const env = getEnv();
  const startedAt = Date.now();
  const contractSchema = buildProviderJsonSchema(AiAuditAssessmentSchema, attempt.capabilities.schemaProfile);
  const body: Record<string, unknown> = {
    model: attempt.model,
    messages: [
      {
        role: 'system',
        content: attempt.format === 'json_object'
          ? `${input.system}\n\n## Contrato JSON requerido\n${buildJsonObjectContract(contractSchema)}`
          : input.system,
      },
      { role: 'user', content: input.parts },
    ],
    temperature: 0,
    max_tokens: attempt.maxTokens,
  };

  if (attempt.format === 'json_schema') {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'AuditResult', strict: true, schema: contractSchema },
    };
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
      const rawProviderErrorType = errInfo?.error?.metadata?.error_type;
      const providerErrorType = typeof rawProviderErrorType === 'string'
        ? rawProviderErrorType.replace(/[^a-z0-9_-]/gi, '').slice(0, 80)
        : null;
      const category = failureCategoryForStatus(response.status);
      const retryable = attempt.capabilities.retryFallbackSuitable &&
        (category === 'RATE_LIMIT' || category === 'PROVIDER_UNAVAILABLE');
      const info = diagnostic(attempt, startedAt, (parsedBody as { usage?: unknown } | null)?.usage, {
        status: response.status,
        providerErrorType,
        retryable,
        failureCategory: category,
        failureReason: category === 'PROVIDER_BAD_REQUEST' ? safeProviderReason(errInfo?.error?.message ?? '') : providerErrorType,
      });
      const reason = response.status === 400
        ? safeProviderReason(errInfo?.error?.message ?? '')
        : providerErrorType ?? category.toLowerCase();
      throw new AttemptFailure(info, `HTTP ${response.status}: ${reason}`);
    }

    const okBody = parsedBody as {
      choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
      model?: unknown;
      usage?: unknown;
    } | null;
    const choice = okBody?.choices?.[0];
    const content = choice?.message?.content;
    const finishReason = choice?.finish_reason ?? null;
    const usage = toModelUsage(okBody?.usage);
    if (finishReason === 'length') {
      throw new AttemptFailure(
        diagnostic(attempt, startedAt, okBody?.usage, {
          finishReason,
          retryable: attempt.capabilities.safeOutputLimit > attempt.maxTokens,
          failureCategory: 'TRUNCATED_OUTPUT',
          failureReason: 'model reached requested output-token limit',
        }),
        'TRUNCATED_OUTPUT: respuesta truncada al alcanzar max_tokens',
      );
    }
    if (!content || content.trim().length === 0) {
      throw new AttemptFailure(
        diagnostic(attempt, startedAt, okBody?.usage, { finishReason, failureCategory: 'INVALID_JSON' }),
        'INVALID_JSON: respuesta vacía',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new AttemptFailure(
        diagnostic(attempt, startedAt, okBody?.usage, { finishReason, failureCategory: 'INVALID_JSON' }),
        'INVALID_JSON: OpenRouter devolvió contenido que no es JSON válido',
      );
    }

    try {
      input.validate?.(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const category: AttemptFailureCategory = /referencia evidencia inexistente/i.test(message)
        ? 'INVALID_EVIDENCE_REFERENCE'
        : 'SCHEMA_VALIDATION_ERROR';
      const schemaPath = message.match(/(?:INVALID_AI_RESPONSE:\s*)?([\w.[\]]+):/)?.[1] ?? 'response';
      throw new AttemptFailure(
        diagnostic(attempt, startedAt, okBody?.usage, {
          finishReason,
          failureCategory: category,
          failureReason: category === 'INVALID_EVIDENCE_REFERENCE' ? 'unknown evidence reference' : `schema validation failed at ${schemaPath}`,
        }),
        `${category}: ${schemaPath}`,
      );
    }

    return {
      parsed,
      model: typeof okBody?.model === 'string' ? okBody.model : attempt.model,
      usage,
      attempts: [diagnostic(attempt, startedAt, okBody?.usage, { status: response.status, finishReason, retryable: false })],
    };
  } catch (error) {
    if (error instanceof AttemptFailure) throw error;
    const timedOut = error instanceof Error && error.name === 'AbortError';
    const category: AttemptFailureCategory = timedOut ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE';
    throw new AttemptFailure(
      diagnostic(attempt, startedAt, undefined, { retryable: true, failureCategory: category }),
      `${category}: ${timedOut ? 'timeout de OpenRouter' : 'OpenRouter no disponible'}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Llama a OpenRouter para auditar con dos llamadas reales como máximo.
 * Nunca inventa resultados: el error final conserva la causa saneada.
 */
export async function callOpenRouterAudit(
  input: CallOpenRouterAuditInput,
): Promise<CallOpenRouterAuditOutput> {
  const env = getEnv();
  const perAttemptTimeoutMs = input.timeoutMs ?? env.AI_TIMEOUT_MS;
  const deadlineMs = input.deadlineMs ?? Date.now() + env.TOTAL_AUDIT_TIMEOUT_MS;
  const diagnostics: OpenRouterAttemptDiagnostic[] = [];
  const models = [env.OPENROUTER_MODEL, env.OPENROUTER_FALLBACK_MODEL].filter((model): model is string => Boolean(model));
  let finalFailure: AttemptFailureCategory = 'PROVIDER_UNAVAILABLE';
  let attemptsMade = 0;

  modelLoop: for (const model of models) {
    let capabilities: ModelCapabilities;
    try {
      capabilities = await getModelCapabilities(model);
    } catch (error) {
      const modelUnsupported = error instanceof Error && /UNSUPPORTED_MODEL_CAPABILITY/.test(error.message);
      const catalogUnavailable = error instanceof Error && /CAPABILITY_CATALOG_UNAVAILABLE/.test(error.message);
      finalFailure = modelUnsupported ? 'UNSUPPORTED_MODEL_CAPABILITY' : catalogUnavailable ? 'CAPABILITY_CATALOG_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE';
      diagnostics.push({
        model,
        format: 'capability',
        status: null,
        providerErrorType: null,
        finishReason: null,
        latencyMs: 0,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        cost: null,
        maxOutputTokensRequested: null,
        capabilitiesVerified: false,
        retryable: false,
        failureCategory: finalFailure,
        failureReason: modelUnsupported ? 'model not listed or unsupported capability profile' : catalogUnavailable ? 'OpenRouter capability catalog unavailable' : 'capabilities could not be determined',
      });
      if (modelUnsupported) continue;
      break;
    }

    if ((input.parts.some((part) => part.type === 'image_url') && !capabilities.supportsImages) ||
      (input.parts.some((part) => part.type === 'file') && !capabilities.supportsFiles)) {
      finalFailure = 'UNSUPPORTED_MODEL_CAPABILITY';
      diagnostics.push({
        model,
        format: 'capability',
        status: null,
        providerErrorType: null,
        finishReason: null,
        latencyMs: 0,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        cost: null,
        maxOutputTokensRequested: null,
        capabilitiesVerified: capabilities.catalogVerified,
        retryable: false,
        failureCategory: finalFailure,
        failureReason: 'model does not support requested image/file modality',
      });
      continue;
    }

    if (!capabilities.supportsJsonObject && !capabilities.supportsStructuredOutput) {
      finalFailure = 'UNSUPPORTED_MODEL_CAPABILITY';
      diagnostics.push({
        model,
        format: 'capability',
        status: null,
        providerErrorType: null,
        finishReason: null,
        latencyMs: 0,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        cost: null,
        maxOutputTokensRequested: null,
        capabilitiesVerified: capabilities.catalogVerified,
        retryable: false,
        failureCategory: finalFailure,
        failureReason: 'model supports neither structured output nor JSON object mode',
      });
      continue;
    }

    let maxTokens: number;
    try {
      maxTokens = resolveOutputTokenBudget(capabilities, env);
    } catch (error) {
      finalFailure = 'UNSUPPORTED_MODEL_CAPABILITY';
      diagnostics.push({
        model,
        format: 'capability',
        status: null,
        providerErrorType: null,
        finishReason: null,
        latencyMs: 0,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        cost: null,
        maxOutputTokensRequested: null,
        capabilitiesVerified: capabilities.catalogVerified,
        retryable: false,
        failureCategory: finalFailure,
        // El motivo solo contiene el valor configurado y el tope; nunca el modelo,
        // el prompt, la evidencia ni credenciales.
        failureReason: error instanceof Error ? error.message : 'invalid output budget',
      });
      continue;
    }

    const formats: Array<AttemptSpec['format']> = [];
    if (capabilities.supportsStructuredOutput) formats.push('json_schema');
    if (capabilities.supportsJsonObject) formats.push('json_object');

    let fallbackOnUnavailable = false;
    for (const format of formats) {
      for (let tryNumber = 0; tryNumber < 2 && attemptsMade < 2; tryNumber += 1) {
        const remainingMs = deadlineMs - Date.now();
        if (remainingMs < MIN_ATTEMPT_BUDGET_MS) break;
        const retryBudget = tryNumber > 0 && diagnostics.at(-1)?.failureCategory === 'TRUNCATED_OUTPUT'
          ? capabilities.safeOutputLimit
          : maxTokens;
        const attempt: AttemptSpec = { model, format, capabilities, maxTokens: retryBudget };
        attemptsMade += 1;
        try {
          const result = await singleAttempt(attempt, input, Math.min(perAttemptTimeoutMs, remainingMs));
          return { ...result, attempts: [...diagnostics, ...result.attempts] };
        } catch (error) {
          if (!(error instanceof AttemptFailure)) throw error;
          diagnostics.push(error.diagnostic);
          finalFailure = error.diagnostic.failureCategory ?? finalFailure;
          if (finalFailure === 'PAYMENT_REQUIRED') {
            throw new OpenRouterAuditError(
              'PAYMENT_REQUIRED',
              diagnostics,
              'OpenRouter requiere saldo disponible para procesar la auditoría. Agrega créditos y vuelve a intentarlo.',
              402,
            );
          }
          if (!error.diagnostic.retryable || tryNumber === 1 || attemptsMade >= 2) break;
          if ((error.diagnostic.failureCategory === 'PROVIDER_UNAVAILABLE' || error.diagnostic.failureCategory === 'TIMEOUT') && models.length > 1) {
            fallbackOnUnavailable = true;
            break;
          }
        }
      }
      if (fallbackOnUnavailable || attemptsMade >= 2) break;
    }
    if (fallbackOnUnavailable) continue modelLoop;
    if (attemptsMade >= 2) break;
  }

  const summary = diagnostics.map((item) => `${item.model} [${item.format}]: ${item.failureCategory ?? 'OK'}${item.status ? ` HTTP ${item.status}` : ''}${item.failureReason ? ` (${item.failureReason})` : ''}`).join(' | ');
  const invalidOutput = diagnostics.find((item) =>
    item.failureCategory === 'TRUNCATED_OUTPUT' ||
    item.failureCategory === 'INVALID_JSON' ||
    item.failureCategory === 'SCHEMA_VALIDATION_ERROR' ||
    item.failureCategory === 'INVALID_EVIDENCE_REFERENCE',
  );
  const finalCategory = invalidOutput?.failureCategory ?? finalFailure;
  throw new OpenRouterAuditError(finalCategory, diagnostics, `OpenRouter no pudo producir un assessment válido. ${summary || 'No hubo estrategias compatibles.'}`);
}
