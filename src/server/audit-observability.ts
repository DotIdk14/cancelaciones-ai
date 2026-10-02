// =============================================================================
// Observabilidad de la auditoría — vista SEGURA de `audits.provider_metadata`.
//
// Por qué existe: un fallo de OpenRouter (por ejemplo SCHEMA_VALIDATION_ERROR)
// se persistía en `provider_metadata`, pero ni el log del Function ni el DTO de
// la API lo mostraban: en `vercel logs` solo aparecía ruido de `pdfjs-dist`.
// Sin esto no había forma de responder "¿qué formato falló?, ¿el proveedor
// confirmó el catálogo de capacidades?, ¿cuántos tokens gastó?, ¿el motivo ya
// saneado qué era?".
//
// Qué se expone y por qué (y qué se OMITE deliberadamente):
//   - SÍ: contadores (status, latencias, tokens), estados cerrados (format,
//     finishReason, failureCategory), dos booleanos de decisión del transporte
//     (retryable, capabilitiesVerified) y `failureReason`, que el propio
//     `openrouter.ts` construye con `safeProviderReason()`: devuelve una
//     plantilla de catálogo, no el mensaje crudo del proveedor.
//   - NO: prompts, procedimiento, expediente, contenido de evidencia,
//     transcripciones, nombre/matrícula del estudiante, API keys y el cuerpo
//     crudo de la respuesta del modelo. Esos datos no entran nunca en este
//     módulo: la lista blanca de campos no tiene dónde colarlos.
//
// Defensa en profundidad: `provider_metadata` es JSONB y podría contener
// cualquier cosa (una escritura vieja, un despliegue anterior, un humano). Por
// eso TODO pasa por un saneo por lista blanca: se construye una vista nueva
// campo a campo y cualquier clave o tipo inesperado se descarta en vez de
// propagarse. Un dato con forma rara es un dato que no se publica.
// =============================================================================

import type { AttemptFailureCategory, OpenRouterAttemptDiagnostic } from './openrouter.js';
import type { ErrorCategory, ModelUsage } from '../skills/audit/types.js';

// -----------------------------------------------------------------------------
// Vocabulario permitido (espejo en runtime de los tipos de `openrouter.ts`).
// -----------------------------------------------------------------------------
// El `satisfies` ata estas listas a los tipos del transporte: si el transporte
// añadiera un formato o una categoría que aquí no estén, el typecheck falla en
// vez de dejar que un valor desconocido llegue a la API.

const ATTEMPT_FORMATS = ['json_schema', 'json_object', 'capability'] as const satisfies readonly string[];

const ATTEMPT_FAILURE_CATEGORIES = [
  'PROVIDER_BAD_REQUEST',
  'RATE_LIMIT',
  'PAYMENT_REQUIRED',
  'PROVIDER_UNAVAILABLE',
  'TIMEOUT',
  'INVALID_JSON',
  'SCHEMA_VALIDATION_ERROR',
  'INVALID_EVIDENCE_REFERENCE',
  'TRUNCATED_OUTPUT',
  'UNSUPPORTED_MODEL_CAPABILITY',
  'CAPABILITY_CATALOG_UNAVAILABLE',
] as const satisfies readonly AttemptFailureCategory[];

/** Techos de longitud: acotan el ruido en logs y el tamaño de la respuesta. */
const MAX_FAILURE_REASON_CHARS = 200;
const MAX_FINISH_REASON_CHARS = 40;
const MAX_ISO_DATE_CHARS = 40;
const MAX_FINGERPRINT_CHARS = 128;
const MAX_ERROR_TYPE_CHARS = 60;

// -----------------------------------------------------------------------------
// Vistas públicas
// -----------------------------------------------------------------------------

/**
 * Un intento de OpenRouter, reducido a lo accionable. Misma forma en el log y
 * en el DTO: lo que se lee en `vercel logs` es exactamente lo que devuelve la
 * API, así que no hay dos verdades que puedan divergir.
 */
export interface AuditAttemptDiagnosticView {
  /** Estrategia con la que se pidió el assessment: `json_schema`, `json_object` o `capability`. */
  format: string;
  /** Categoría cerrada del fallo del intento (`null` si el intento fue un éxito). */
  failureCategory: AttemptFailureCategory | null;
  /** Código HTTP del proveedor; `null` si no hubo respuesta HTTP (timeout, catálogo). */
  status: number | null;
  /** `finish_reason` informado por el proveedor (`stop`, `length`, ...). */
  finishReason: string | null;
  /** Duración del intento en ms. */
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  /** ¿El transporte consideró este fallo reintentable con la misma estrategia? */
  retryable: boolean;
  /** ¿Las capacidades del modelo salieron del catálogo confirmado, no de un perfil conocido? */
  capabilitiesVerified: boolean;
  /** Motivo YA saneado por el proveedor; nunca el mensaje crudo ni el body. */
  failureReason: string | null;
}

/**
 * `provider_metadata` saneado. Solo aparecen las claves que existen en la fila
 * y cuyos valores pasaron el tipo esperado; el resto se descarta.
 */
export interface AuditProviderMetadata {
  /** Diagnóstico por intento del transporte de IA. */
  openrouterAttempts?: AuditAttemptDiagnosticView[];
  /** Tokens y coste reportados por el proveedor (nunca inventados: sin dato, `null`). */
  usage?: ModelUsage;
  /** `true` si la auditoría se marcó ERROR por abandono (stale), no por el modelo. */
  stale?: boolean;
  /** Instante del deadline que venció en un audit RUNNING abandonado. */
  deadlineAt?: string;
  /** Huella SHA-256 del expediente; ya es pública en `evidenceFingerprint`. */
  fingerprint?: string;
}

/** Línea de log estructurada del fallo de una auditoría. */
export interface AuditFailureLog {
  /** Id de la fila `audits` en ERROR: permite correlacionar log y base. */
  auditId: string | null;
  /** Id del caso (UUID). No es dato personal: es la clave foránea de `audits`. */
  caseId: string;
  /** Categoría de error del producto tal como se persiste en `error_category`. */
  errorCategory: ErrorCategory;
  /** Solo el TIPO de la excepción (`OpenRouterAuditError`, `TypeError`...); nunca su mensaje. */
  errorType: string;
  /** Modelo configurado para el run (puede no ser el que terminó fallando: por eso van los intentos). */
  model: string;
  /** Latencia total del run en ms. */
  latencyMs: number;
  /** Un ítem por intento real del transporte. */
  openrouterAttempts: AuditAttemptDiagnosticView[];
}

// -----------------------------------------------------------------------------
// Saneo por lista blanca
// -----------------------------------------------------------------------------

/** ¿Es un objeto plano (no array, no null)? */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Entero finito dentro de un rango; `null` si el tipo o el rango no cuadran. */
function intOrNull(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return null;
  return value >= min && value <= max ? value : null;
}

/** Booleano estricto: cualquier otra cosa es `false` (nunca truthy). */
function boolOrFalse(value: unknown): boolean {
  return value === true;
}

/**
 * Texto de una línea y acotado: sin saltos de línea (romperían una línea de log)
 * ni caracteres de control. Un texto que no es string se descarta.
 */
function oneLineText(value: unknown, maxChars: number): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned.slice(0, maxChars) : null;
}

function failureCategoryOrNull(value: unknown): AttemptFailureCategory | null {
  return typeof value === 'string' && (ATTEMPT_FAILURE_CATEGORIES as readonly string[]).includes(value)
    ? (value as AttemptFailureCategory)
    : null;
}

/**
 * Sanea UN diagnóstico de intento.
 *
 * Se construye el objeto campo a campo: cualquier clave que el transporte no
 * declare aquí (`prompt`, `content`, `error`, `raw`...) se pierde, aunque venga
 * en la fila. Devuelve `null` si el intento no es identificable (formato
 * desconocido), porque un intento sin estrategia no ayuda a diagnosticar.
 */
export function sanitizeAttemptDiagnostic(value: unknown): AuditAttemptDiagnosticView | null {
  if (!isPlainObject(value)) return null;
  const format = value.format;
  if (typeof format !== 'string' || !(ATTEMPT_FORMATS as readonly string[]).includes(format)) return null;
  return {
    format,
    failureCategory: failureCategoryOrNull(value.failureCategory),
    status: intOrNull(value.status, 100, 599),
    finishReason: oneLineText(value.finishReason, MAX_FINISH_REASON_CHARS),
    latencyMs: Math.max(0, typeof value.latencyMs === 'number' && Number.isFinite(value.latencyMs) ? value.latencyMs : 0),
    promptTokens: intOrNull(value.promptTokens, 0, Number.MAX_SAFE_INTEGER),
    completionTokens: intOrNull(value.completionTokens, 0, Number.MAX_SAFE_INTEGER),
    retryable: boolOrFalse(value.retryable),
    capabilitiesVerified: boolOrFalse(value.capabilitiesVerified),
    failureReason: oneLineText(value.failureReason, MAX_FAILURE_REASON_CHARS),
  };
}

/** Sanea el bloque `usage` (tokens y coste). Nunca inventa: ausente ⇒ `null`. */
function sanitizeUsage(value: unknown): ModelUsage | null {
  if (!isPlainObject(value)) return null;
  return {
    promptTokens: intOrNull(value.promptTokens, 0, Number.MAX_SAFE_INTEGER),
    completionTokens: intOrNull(value.completionTokens, 0, Number.MAX_SAFE_INTEGER),
    totalTokens: intOrNull(value.totalTokens, 0, Number.MAX_SAFE_INTEGER),
    estimatedCostUSD: typeof value.estimatedCostUSD === 'number' && Number.isFinite(value.estimatedCostUSD) && value.estimatedCostUSD >= 0
      ? value.estimatedCostUSD
      : null,
  };
}

/**
 * Sanea `audits.provider_metadata` para devolverlo por la API.
 *
 * Lista blanca de claves (`openrouterAttempts`, `usage`, `stale`, `deadlineAt`,
 * `fingerprint`); el resto se descarta aunque la fila las tenga. Si no sobrevive
 * ninguna clave recognizable se devuelve `null` en vez de un objeto vacío: para
 * el consumidor es más honesto "no hay metadatos que exponer".
 */
export function sanitizeProviderMetadata(value: unknown): AuditProviderMetadata | null {
  if (!isPlainObject(value)) return null;
  const out: AuditProviderMetadata = {};

  if (Array.isArray(value.openrouterAttempts)) {
    out.openrouterAttempts = value.openrouterAttempts
      .map((item) => sanitizeAttemptDiagnostic(item))
      .filter((item): item is AuditAttemptDiagnosticView => item !== null);
  }
  if (isPlainObject(value.usage)) {
    const usage = sanitizeUsage(value.usage);
    if (usage) out.usage = usage;
  }
  if (typeof value.stale === 'boolean') out.stale = value.stale;
  const deadlineAt = oneLineText(value.deadlineAt, MAX_ISO_DATE_CHARS);
  if (deadlineAt) out.deadlineAt = deadlineAt;
  const fingerprint = oneLineText(value.fingerprint, MAX_FINGERPRINT_CHARS);
  if (fingerprint) out.fingerprint = fingerprint;

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Construye la línea de log del fallo.
 *
 * Deliberadamente NO incluye `error.message`: para un `OpenRouterAuditError` el
 * mensaje trae el resumen de intentos (útil) pero también puede contener texto
 * del proveedor; y para un error desconocido puede contener cualquier cosa
 * (expediente, PII, secretos). Se registra solo el tipo de la excepción y los
 * diagnósticos ya saneados.
 */
export function buildAuditFailureLog(input: {
  auditId: string;
  caseId: string;
  errorCategory: ErrorCategory;
  error: unknown;
  model: string;
  latencyMs: number;
  diagnostics: OpenRouterAttemptDiagnostic[];
}): AuditFailureLog {
  return {
    auditId: oneLineText(input.auditId, MAX_ERROR_TYPE_CHARS),
    caseId: oneLineText(input.caseId, MAX_ERROR_TYPE_CHARS) ?? '',
    errorCategory: input.errorCategory,
    errorType: oneLineText(input.error instanceof Error ? input.error.name : typeof input.error, MAX_ERROR_TYPE_CHARS) ?? 'UnknownError',
    model: oneLineText(input.model, MAX_FINGERPRINT_CHARS) ?? '',
    latencyMs: Math.max(0, Number.isFinite(input.latencyMs) ? input.latencyMs : 0),
    openrouterAttempts: (Array.isArray(input.diagnostics) ? input.diagnostics : [])
      .map((item) => sanitizeAttemptDiagnostic(item))
      .filter((item): item is AuditAttemptDiagnosticView => item !== null),
  };
}
