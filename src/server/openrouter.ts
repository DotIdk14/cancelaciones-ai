// =============================================================================
// OpenRouter — transporte de IA del Audit Skill (sección 7 del encargo).
// =============================================================================
// Único módulo que habla con OpenRouter. Hay un máximo de dos llamadas reales:
// un 400 de json_schema cambia a json_object; fallos transitorios usan retry o
// fallback sin repetir una llamada determinista; y una salida que el validador
// LOCAL rechaza se reintenta en el modelo de respaldo con feedback correctivo
// (ver `resolveSecondAttemptRoute`). Zod sigue siendo autoridad.
// =============================================================================

import { AiAuditAssessmentSchema } from '../skills/audit/schema.js';
import type { ModelUsage } from '../skills/audit/types.js';
import type { ZodTypeAny } from 'zod';
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
  /**
   * Contrato de salida del modelo (structured output / json_object).
   * Por defecto, el assessment de auditoría. La comparación IA↔humana pasa su
   * propio `ComparisonResultSchema`: el TRANSPORTE es único, el contrato no.
   */
  schema?: ZodTypeAny;
  /** Nombre del `json_schema` enviado al proveedor. */
  schemaName?: string;
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
  constructor(
    readonly diagnostic: OpenRouterAttemptDiagnostic,
    message: string,
    /**
     * Fallo del validador LOCAL sobre la respuesta del modelo. Viaja
     * únicamente dentro de la petición correctiva saliente: `detail` se sanea
     * antes de usarlo y ni `detail` ni el contenido del modelo se registran ni
     * se guardan en el diagnóstico, que sí consume la UI. `undefined` cuando el
     * fallo no proviene de validar la respuesta (transporte, HTTP, timeout...).
     */
    readonly validation?: { detail: string; path: string },
  ) {
    super(message);
  }
}

// =============================================================================
// Enrutado del último intento.
// =============================================================================

/**
 * Fallos cuyo origen es la SALIDA del modelo, no el transporte: el proveedor
 * respondió 200 y devolvió JSON, pero ese JSON no cumple el contrato.
 *
 * Son DOS familias distintas y por eso el último intento se enruta distinto:
 *  - `SCHEMA_VALIDATION_ERROR` / `INVALID_EVIDENCE_REFERENCE` nacen de reglas que
 *    `json_schema` no puede expresar. La decodificación restringida garantiza
 *    validez ESTRUCTURAL, nunca SEMÁNTICA; la invariante
 *    `audit.result === 'EVIDENCIA_INSUFICIENTE' ⟺ audit.provisionalResolution !== null`
 *    de `src/skills/audit/schema.ts` es una restricción ENTRE campos que ninguna
 *    gramática json_schema puede declarar, así que el modelo puede emitir dos
 *    mitades individualmente válidas y una combinación inválida. En `json_object`
 *    directamente no hay ninguna garantía estructural (típico:
 *    `facts[i].value` como objeto en vez de `string|number|boolean|null`).
 *  - `PROVIDER_BAD_REQUEST` / `UNSUPPORTED_MODEL_CAPABILITY` dicen sólo que el
 *    PROVEEDOR rechazó la petición. No hay nada del contenido que corregir.
 */
const MODEL_OUTPUT_VALIDATION_FAILURES: ReadonlySet<AttemptFailureCategory> = new Set<AttemptFailureCategory>([
  'SCHEMA_VALIDATION_ERROR',
  'INVALID_EVIDENCE_REFERENCE',
]);

/** Tope del detalle del validador dentro del feedback correctivo. */
const CORRECTIVE_FEEDBACK_MAX_CHARS = 240;

/**
 * Sanea el mensaje del validador para poder reenviarlo al modelo. Se acota el
 * largo, se colapsan espacios y se restringe a ASCII imprimible: el detalle de
 * Zod puede interpolar valores emitidos por el modelo, y no queremos arrastrar
 * bloques largos de texto libre (ni nada que parezca credencial) al prompt.
 */
function sanitizeValidationDetail(message: string): string {
  return message
    .replace(/INVALID_AI_RESPONSE:\s*/gi, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CORRECTIVE_FEEDBACK_MAX_CHARS);
}

/**
 * Feedback correctivo para el reintento. Sin él, el segundo intento es la misma
 * lotería de siempre: mismo prompt, misma temperatura, mismo modelo, y la única
 * diferencia sería el formato — insuficiente frente a un fallo cuyo origen es
 * una combinación de campos.
 */
function buildCorrectiveFeedback(category: AttemptFailureCategory, validation: { detail: string; path: string }): string {
  const detail = sanitizeValidationDetail(validation.detail);
  return [
    '## Corrección requerida: tu respuesta anterior fue rechazada',
    '',
    'La respuesta que acabas de emitir NO superó la validación del contrato de salida:',
    `- Categoría del fallo: ${category}`,
    `- Ruta que falló: ${validation.path}`,
    ...(detail ? [`- Detalle del validador: ${detail}`] : []),
    '',
    'Reemite el objeto JSON COMPLETO con la misma estructura, corrigiendo exactamente ese punto.',
    'Algunas reglas del contrato son invariantes ENTRE campos y ningún formato de salida puede garantizarlas: revísalas tú mismo antes de responder.',
    'No inventes datos ni cites evidencia que no aparezca en el expediente.',
  ].join('\n');
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
  /**
   * Feedback correctivo del intento anterior (ya saneado). Viaja como turno de
   * usuario PROPIO para que el prompt de sistema y el expediente queden byte a
   * byte idénticos al primer intento: así el modelo puede contrastar qué se le
   * pidió contra qué se le rechaza.
   */
  correction?: string,
): Promise<CallOpenRouterAuditOutput> {
  const env = getEnv();
  const startedAt = Date.now();
  const contractSchema = buildProviderJsonSchema(input.schema ?? AiAuditAssessmentSchema, attempt.capabilities.schemaProfile);
  const messages: unknown[] = [
    {
      role: 'system',
      content: attempt.format === 'json_object'
        ? `${input.system}\n\n## Contrato JSON requerido\n${buildJsonObjectContract(contractSchema)}`
        : input.system,
    },
    { role: 'user', content: input.parts },
  ];
  if (correction) {
    messages.push({ role: 'user', content: [{ type: 'text', text: correction }] });
  }
  const body: Record<string, unknown> = {
    model: attempt.model,
    messages,
    temperature: 0,
    max_tokens: attempt.maxTokens,
  };

  if (attempt.format === 'json_schema') {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: input.schemaName ?? 'AuditResult', strict: true, schema: contractSchema },
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
        { detail: message, path: schemaPath },
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
  /**
   * Feedback correctivo pendiente del último fallo de validación de salida. Se
   * consume en el siguiente intento (y sólo en ése): es lo que convierte el
   * reintento en algo distinto de repetir la misma lotería.
   */
  let correctiveFeedback: string | null = null;

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
        // El feedback se consume una sola vez: si este intento también falla, el
        // siguiente feedback se reconstruye a partir del fallo más reciente.
        const feedbackForThisAttempt = correctiveFeedback;
        correctiveFeedback = null;
        try {
          const result = await singleAttempt(
            attempt,
            input,
            Math.min(perAttemptTimeoutMs, remainingMs),
            feedbackForThisAttempt ?? undefined,
          );
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

          // ── Enrutado del segundo y último intento ────────────────────────
          // El validador LOCAL rechazó una respuesta que el proveedor SÍ aceptó
          // (HTTP 200 con JSON bien formado pero fuera de contrato). Aquí
          // degradar `json_schema` -> `json_object` es EXACTAMENTE lo
          // contrario de lo que sirve: `json_object` no lleva esquema, así que
          // el segundo intento tendría MENOS garantías de validez estructural
          // que el primero. Lo que falló no fue la forma, fue una invariante
          // entre campos (p. ej. `result` <-> `provisionalResolution`), y eso
          // solo se comunica en texto.
          //
          // Por eso el intento restante se gasta en MÁS información y no en
          // MENOS restricciones: mismo modelo (el proveedor ya demostrado en
          // producción), mismo formato estricto, más el feedback correctivo.
          // No se escala a otro proveedor: su catálogo de capacidades no está
          // verificado contra este esquema en producción.
          //
          // Un rechazo del PROVEEDOR al esquema (HTTP 400 /
          // `PROVIDER_BAD_REQUEST` / `UNSUPPORTED_MODEL_CAPABILITY`) NO entra
          // por aquí: no dice nada del contenido, y el comportamiento histórico
          // (mismo modelo, siguiente formato) se conserva intacto.
          if (MODEL_OUTPUT_VALIDATION_FAILURES.has(finalFailure) && error.validation) {
            correctiveFeedback ??= buildCorrectiveFeedback(finalFailure, error.validation);
            // `continue` reintenta el MISMO formato con el feedback pendiente;
            // las guardas `tryNumber < 2` y `attemptsMade < 2` lo acotan a una
            // única llamada extra.
            if (tryNumber === 0 && attemptsMade < 2) continue;
            break;
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
