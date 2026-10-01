import { z } from 'zod';
import {
  HUMAN_RESOLUTIONS,
  REVIEW_COMMENT_MAX,
  REVIEW_COMMENT_MIN,
} from './types.js';
import { ApiError } from '../../server/http.js';

// =============================================================================
// Schemas del módulo de revisión humana.
// El LLM sólo emite el veredicto de la COMPARACIÓN. La resolución final del
// caso es la de la persona y no se valida aquí contra el modelo: se valida
// contra el vocabulario cerrado, en servidor, antes de persistirla.
// =============================================================================

/**
 * Veredicto de la comparación entre el dictamen original y la decisión humana.
 *
 * `strict` por la misma razón que en el Audit Skill: un campo que el contrato
 * no declara no puede viajar en la respuesta del modelo. Aquí ese campo
 * concreto sería `result`, es decir, un SEGUNDO dictamen emitido desde la
 * comparación, que es exactamente lo que este módulo no es.
 *
 * La regla de coherencia va con `.superRefine()` y no en el parser a secas
 * porque es parte del CONTRATO, no un extra: quien use `safeParse` —el
 * validador del proveedor, un test, una futuro consumidor— tiene que obtener el
 * mismo veredicto que `parseComparisonResult`.
 */
const ComparisonResultObject = z
  .object({
    agrees: z.boolean(),
    // `.trim()` antes que `.min(1)`: un texto de espacios no es una explicación.
    explanation: z.string().trim().min(1),
    confidence: z.number().min(0).max(1),
    discrepancyReason: z.string().trim().min(1).nullable(),
    procedureSections: z.array(z.string().min(1)).min(1),
    evidenceIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

/**
 * Lo que se persiste: el veredicto más la metadata técnica REAL de OpenRouter.
 * La agrega el servidor desde la respuesta del transporte, nunca desde el
 * modelo (mismo contrato que `AuditResultSchema`).
 */
const ComparisonOutcomeObject = ComparisonResultObject.extend({
  model: z.object({
    provider: z.literal('openrouter'),
    model: z.string(),
  }),
  usage: z.object({
    promptTokens: z.number().nullable(),
    completionTokens: z.number().nullable(),
    totalTokens: z.number().nullable(),
    estimatedCostUSD: z.number().nullable(),
  }),
}).strict();

interface ComparableResult {
  agrees: boolean;
  discrepancyReason: string | null;
}

/**
 * Coherencia interna del veredicto.
 *
 * No reclasifica ni corrige: RECHAZA. La regla es simétrica porque las dos
 * mitades del contrato dependen la una de la otra:
 *   - `agrees === false` sin `discrepancyReason` deja una discrepancia sin
 *     explicar, que es el dato inútil para el producto.
 *   - `agrees === true` CON `discrepancyReason` afirma a la vez que hay y que
 *     no hay discrepancia, y el consumidor no puede saber cuál creer.
 */
function validateCoherence(
  result: ComparableResult,
  ctx: z.RefinementCtx,
): void {
  if (result.agrees && result.discrepancyReason !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['discrepancyReason'],
      message: 'si agrees === true la discrepancia es null; el campo afirma una causa de discrepancia en una comparación que dice coincidir',
    });
  }
  if (!result.agrees && result.discrepancyReason === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['discrepancyReason'],
      message: 'agrees === false exige la causa concreta de la discrepancia',
    });
  }
}

export const ComparisonResultSchema = ComparisonResultObject.superRefine(validateCoherence);
export const ComparisonOutcomeSchema = ComparisonOutcomeObject.superRefine(validateCoherence);

/**
 * Body de `POST /api/cases/:caseId/review`.
 *
 * Es la validación de ENTRADA del servidor, no del modelo: sin ella, un
 * comentario vacío o una clasificación inventada llegarían a `case_reviews` y
 * de ahí al contexto de la comparación. `.strict()` también aquí: `auditId` no
 * lo elige quien revisa (lo resuelve el servidor contra la auditoría
 * COMPLETED vigente), y aceptarlo sería permitir que un cliente señale qué
 * dictamen se compara.
 */
export const HumanReviewInputSchema = z
  .object({
    result: z.enum(HUMAN_RESOLUTIONS),
    comment: z
      .string()
      .trim()
      .min(REVIEW_COMMENT_MIN, `El comentario debe tener al menos ${REVIEW_COMMENT_MIN} caracteres`)
      .max(REVIEW_COMMENT_MAX, `El comentario no puede superar ${REVIEW_COMMENT_MAX} caracteres`),
  })
  .strict();

export type ComparisonResultPayload = z.infer<typeof ComparisonResultSchema>;
export type ComparisonOutcomePayload = z.infer<typeof ComparisonOutcomeSchema>;
export type HumanReviewInput = z.infer<typeof HumanReviewInputSchema>;

/** Veredicto del modelo, sin metadata técnica. */
export function parseComparisonResult(raw: unknown): ComparisonResultPayload {
  return parseWithInvalidAiError(ComparisonResultSchema, raw);
}

/** Veredicto + metadata técnica, tal como queda en `result_json`. */
export function parseComparisonOutcome(raw: unknown): ComparisonOutcomePayload {
  return parseWithInvalidAiError(ComparisonOutcomeSchema, raw);
}

/**
 * Body de la revisión, validado en servidor.
 *
 * Traduce los fallos de Zod al `ApiError` con el que trabaja `handleRoute`, para
 * que el endpoint no tenga que distinguir "validación de entrada" de "el modelo
 * devolvió basura". Nunca se loguea el valor recibido: `comment` es texto
 * humano y puede contener PII.
 */
export function parseHumanReviewInput(raw: unknown): HumanReviewInput {
  const result = HumanReviewInputSchema.safeParse(raw);
  if (result.success) return result.data;
  const detail = result.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join(' | ');
  throw new ApiError(400, 'VALIDATION_ERROR', `Revisión humana inválida — ${detail}`);
}

function parseWithInvalidAiError<T>(schema: z.ZodType<T>, raw: unknown): T {
  try {
    return schema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      throw new ApiError(502, 'INVALID_AI_RESPONSE', `INVALID_AI_RESPONSE: ${details.join(' | ')}`);
    }
    throw error;
  }
}