// =============================================================================
// Servicio de revisión humana y comparación — orquestación durable.
// =============================================================================
// ESTE MÓDULO NO DECIDE NADA. Registra lo que una persona decidió, llama al
// modelo para que evalúe la distancia entre ese dictamen y esa decisión, y
// persiste el resultado. La resolución que resuelve el caso es siempre la de la
// persona: el modelo dice si discrepa, no replaces la decisión (NO_RULES_ENGINE).
//
// EL CICLO DE VIDA ES EL DE `audit-service.ts`, y por el mismo motivo: la fila
// `case_comparisons` (status RUNNING) se inserta ANTES de llamar al modelo. Si
// la función de Vercel muere a mitad de ejecución, el estado queda durable, y
// la llamada siguiente lo retoma SOBRE LA MISMA fila en vez de crear otra
// (`case_review_id` es UNIQUE). Sin estado en memoria de proceso.
//
// LÍMITES DURABLES DE REINTENTO
//   El transporte (`callOpenRouterAudit`) ya limita los intentos por llamada a
//   2. Aquí se aplica un tope duro por FILA: `attempt_count` se incrementa en
//   cada rearm y se rechaza con 429 cuando se supera `COMPARISON_MAX_RETRIES`.
//   También hay un backoff mínimo entre rearms medido con `updated_at`.
// =============================================================================

import type { InsForgeClient } from './insforge.js';
import { ApiError } from './http.js';
import { getEnv } from './env.js';
import {
  getAuditById,
  getCaseOr404,
  latestCompletedAudit,
  listEvidenceRows,
  type AuditRow,
  type CaseRow,
} from './cases.js';
import { buildAuditInputs } from './audit-service.js';
import { checkPaidQuota } from './quotas.js';
import {
  createCaseReview,
  getCaseReview,
  getLatestComparisonForReview,
  insertComparison,
  rearmComparison,
  updateComparisonError,
  updateComparisonResult,
  type CaseReviewRow,
  type ComparisonRow,
} from './reviews.js';
import { comparisonSkill } from '../skills/review/execute.js';
import { caseReviewToDto, comparisonToDto, deriveWorkflowState, type CaseReviewDto, type ComparisonDto } from './dto.js';
import type { ErrorCategory } from '../skills/audit/types.js';
import type { ComparisonSkillInput, HumanResolution, WorkflowState } from '../skills/review/types.js';

export type StartComparisonOutcome =
  | { phase: 'running'; comparison: ComparisonDto }
  | { phase: 'done'; comparison: ComparisonDto }
  | { phase: 'error'; comparison: ComparisonDto; errorCategory: ErrorCategory };

export interface SubmitCaseReviewInput {
  result: HumanResolution;
  comment: string;
  userId: string;
  /** Correo de la sesión: la atribución DERIVADA del servidor, nunca un nombre del cliente. */
  reviewerEmail: string;
}

export interface SubmitCaseReviewOutcome {
  review: CaseReviewDto;
  comparison: ComparisonDto;
  /**
   * Estado del flujo DERIVADO de la fila recién persistida: tras una revisión de
   * asesor es `PENDING_COORDINATOR`. Se deriva aquí y no en el endpoint para que
   * el 201 y el GET posterior no puedan discrepar (el estado es de la fila, no
   * del camino de código que la escribió).
   */
  workflowState: WorkflowState;
}

interface ComparisonContext {
  caseRow: CaseRow;
  review: CaseReviewRow;
  /** SIEMPRE la auditoría referenciada por `case_reviews.audit_id`. */
  audit: AuditRow;
  comparison: ComparisonRow | null;
}

/**
 * Registra la revisión humana y arranca su comparación en la misma llamada.
 *
 * El `audit_id` lo RESUELVE el servidor contra la auditoría COMPLETED vigente;
 * el cliente no lo envía (`HumanReviewInputSchema` es `strict` y lo rechaza).
 * Quien revisa señala el resultado y el motivo; a qué dictamen se compara lo
 * decide el sistema, que es lo único que garantiza que la comparación sea
 * siempre sobre el dictamen que el caso tiene encima.
 *
 * La atribución (`reviewer_name`) se deriva del correo de la sesión
 * (`input.reviewerEmail`), nunca de un nombre que envíe el cliente. La
 * comparación se dispara AQUÍ, en la etapa de asesor, y evalúa la resolución
 * del ASESOR: un `CHANGE` posterior del coordinador no la vuelve a disparar.
 */
export async function submitCaseReview(
  client: InsForgeClient,
  caseId: string,
  input: SubmitCaseReviewInput,
): Promise<SubmitCaseReviewOutcome> {
  await getCaseOr404(client, caseId);

  const audit = await latestCompletedAudit(client, caseId);
  if (!audit) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'El caso no tiene una auditoría completada; ejecuta la auditoría antes de registrar la revisión.',
    );
  }

  const review = await createCaseReview(client, {
    caseId,
    auditId: audit.id,
    result: input.result,
    reviewerName: input.reviewerEmail,
    comment: input.comment,
    userId: input.userId,
  });

  const outcome = await startComparison(client, caseId, { userId: input.userId });
  return {
    review: caseReviewToDto(review),
    comparison: outcome.comparison,
    workflowState: deriveWorkflowState(review),
  };
}

/**
 * Arranca (o retoma) la comparación del caso.
 *
 * La AUDITABILIDAD se comprueba PRIMERO, antes de mirar cualquier comparación
 * existente, y por eso el orden importa: "sólo se compara un dictamen emitido"
 * tiene que valer en todos los caminos, no sólo en el que abre la fila. Si el
 * dictamen de la revisión dejó de estar COMPLETED, responder `done` con el
 * resultado guardado sería sostener una comparación sobre un dictamen que ya no
 * existe, y responder `running` dejaría al cliente esperando un veredicto que no
 * puede llegar. En los dos casos la respuesta honesta es 409.
 *
 * Después, los cuatro caminos, sin relanzar nada por su cuenta:
 *   - ya hay COMPLETED      → `done`, sin reprocesar (DO_NOT_REPROCESS_AI_UNNECESSARILY);
 *   - hay ERROR             → `error`; reintentar es una llamada explícita aparte;
 *   - hay RUNNING vigente   → `running` (el cliente pollea);
 *   - no hay comparación, o la RUNNING caducó → se ejecuta (fila nueva, o la misma reabierta).
 */
export async function startComparison(
  client: InsForgeClient,
  caseId: string,
  options?: { userId?: string },
): Promise<StartComparisonOutcome> {
  const context = await loadContext(client, caseId);
  assertReviewableAudit(context.audit);
  const existing = context.comparison;

  if (existing?.status === 'COMPLETED') {
    return { phase: 'done', comparison: comparisonToDto(existing) };
  }
  if (existing?.status === 'ERROR') {
    return { phase: 'error', comparison: comparisonToDto(existing), errorCategory: existing.error_category ?? 'UNKNOWN' };
  }
  if (existing && existing.status === 'RUNNING' && !isStale(existing)) {
    return { phase: 'running', comparison: comparisonToDto(existing) };
  }

  // El expediente se prepara ANTES de tocar la fila: un 413 de tamaño o un
  // error de descarga son accionables por quien revisa y no deben dejar una
  // comparación técnica fallida detrás.
  const inputs = await buildComparisonInputs(client, context);
  const deadlineAt = new Date(Date.now() + getEnv().TOTAL_AUDIT_TIMEOUT_MS).toISOString();

  // Cuota antes de abrir/reabrir la fila y antes del proveedor: reutilizar una
  // comparación COMPLETED o una RUNNING vigente (los `return` de arriba) no
  // cuesta dinero. Un 429 no deja fila técnica escrita ni error en el historial.
  if (options?.userId) {
    await checkPaidQuota(options.userId, `comparison:${caseId}:${context.review.id}`);
  }

  // Una comparación RUNNING caducada se RETOMA sobre su propia fila; si no había
  // ninguna, se abre una nueva. Nunca hay dos filas por revisión.
  if (existing) assertCanRearm(existing);
  const row = existing
    ? await rearmComparison(client, existing.id, {
        deadlineAt,
        attemptCount: existing.attempt_count + 1,
        model: getEnv().OPENROUTER_MODEL,
      })
    : await insertComparison(client, {
        caseReviewId: context.review.id,
        auditId: context.audit.id,
        deadlineAt,
        model: getEnv().OPENROUTER_MODEL,
      });

  return executeComparison(client, inputs, row);
}

/**
 * Reintenta UNA comparación en ERROR o una RUNNING caducada.
 *
 * - COMPLETED no es reintentable (el resultado es durable).
 * - RUNNING vigente se devuelve tal cual, sin duplicar la ejecución.
 * - RUNNING caducada se reanuda sobre la misma fila.
 * - ERROR reabre la fila existente, salvo que se haya superado el tope de
 *   reintentos o no haya pasado el backoff mínimo.
 *
 * Nunca crea una revisión ni una comparación nuevas.
 */
export async function retryComparison(
  client: InsForgeClient,
  caseId: string,
  options?: { userId?: string },
): Promise<ComparisonDto> {
  const context = await loadContext(client, caseId);
  assertReviewableAudit(context.audit);

  const existing = context.comparison;

  if (!existing) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'No hay comparación que reintentar: la revisión del caso todavía no generó ninguna.',
    );
  }
  if (existing.status === 'RUNNING' && !isStale(existing)) {
    return comparisonToDto(existing);
  }
  if (existing.status === 'COMPLETED') {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'La comparación ya terminó correctamente y no es reintentable.',
    );
  }

  assertCanRearm(existing);
  const inputs = await buildComparisonInputs(client, context);

  // Un reintento SÍ vuelve a llamar al proveedor: cobra cuota (fail-closed si el
  // servicio no responde). Va antes de reabrir la fila para que un 429 no deje
  // la comparación en un estado técnico a medio camino.
  if (options?.userId) {
    await checkPaidQuota(options.userId, `comparison-retry:${caseId}:${existing.id}`);
  }

  const deadlineAt = new Date(Date.now() + getEnv().TOTAL_AUDIT_TIMEOUT_MS).toISOString();
  const row = await rearmComparison(client, existing.id, {
    deadlineAt,
    attemptCount: existing.attempt_count + 1,
    model: getEnv().OPENROUTER_MODEL,
  });
  const outcome = await executeComparison(client, inputs, row);
  return outcome.comparison;
}

async function loadContext(client: InsForgeClient, caseId: string): Promise<ComparisonContext> {
  const caseRow = await getCaseOr404(client, caseId);

  const review = await getCaseReview(client, caseId);
  if (!review) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'El caso no tiene revisión humana; regístrala en POST /api/cases/:caseId/review antes de comparar.',
    );
  }

  const audit = await getAuditById(client, review.audit_id);
  if (!audit) {
    throw new ApiError(404, 'NOT_FOUND', 'No existe la auditoría a la que apunta la revisión del caso.');
  }

  return { caseRow, review, audit, comparison: await getLatestComparisonForReview(client, review.id) };
}

/**
 * Sólo se compara un dictamen emitido.
 *
 * Una auditoría RUNNING no tiene veredicto (su `result_json` es NULL) y una en
 * ERROR no lo tendrá nunca. Compáralas produciría una comparación sobre una
 * ausencia de dictamen, que es la forma más sutil de fabricar un veredicto.
 */
function assertReviewableAudit(audit: AuditRow): void {
  if (audit.status !== 'COMPLETED') {
    throw new ApiError(
      409,
      'VALIDATION_ERROR',
      `La auditoría a la que apunta la revisión está en estado ${audit.status} y no admite comparación: sólo se compara un dictamen completado.`,
    );
  }
}

/** Una comparación RUNNING más pasada su deadline es de un proceso que ya no existe. */
function isStale(comparison: ComparisonRow): boolean {
  const raw = comparison.deadline_at
    ? Date.parse(comparison.deadline_at)
    : Date.parse(comparison.created_at) + getEnv().AUDIT_STALE_AFTER_MS;
  const deadline = Number.isNaN(raw) ? Date.parse(comparison.created_at) : raw;
  return Date.now() > deadline;
}

/**
 * Sana una comparación RUNNING abandonada marcándola como ERROR.
 *
 * Se llama en los endpoints de lectura para que un cliente que pollea nunca se
 * quede atascado viendo un RUNNING de un proceso que ya no existe.
 */
export async function healStaleComparison(client: InsForgeClient, caseId: string): Promise<void> {
  const review = await getCaseReview(client, caseId);
  if (!review) return;
  const comparison = await getLatestComparisonForReview(client, review.id);
  if (!comparison || comparison.status !== 'RUNNING' || !isStale(comparison)) return;

  const ageMs = Date.now() - new Date(comparison.created_at).getTime();
  await updateComparisonError(client, comparison.id, {
    errorCategory: 'AI_PROVIDER_ERROR',
    latencyMs: ageMs,
  }).catch(() => undefined);
}

/** Tope duro de reintentos y backoff mínimo entre rearms. */
function assertCanRearm(comparison: ComparisonRow): void {
  const env = getEnv();
  if (comparison.attempt_count > env.COMPARISON_MAX_RETRIES) {
    throw new ApiError(
      429,
      'RATE_LIMIT',
      `Se alcanzó el límite de ${env.COMPARISON_MAX_RETRIES} reintentos para esta comparación.`,
    );
  }
  const elapsedMs = Date.now() - new Date(comparison.updated_at).getTime();
  if (elapsedMs < env.COMPARISON_RETRY_MIN_BACKOFF_MS) {
    throw new ApiError(
      429,
      'RATE_LIMIT',
      `Espera ${Math.ceil((env.COMPARISON_RETRY_MIN_BACKOFF_MS - elapsedMs) / 1000)} segundos antes de reintentar esta comparación.`,
    );
  }
}

/**
 * Expediente de la comparación.
 *
 * El dictamen es el de `review.audit_id`, NUNCA el de la auditoría más reciente.
 * Las evidencias son las del caso, que son las mismas que leyó esa auditoría: el
 * modelo necesita contrastar contra ellas tanto el razonamiento del dictamen
 * como la afirmación de la persona.
 */
async function buildComparisonInputs(
  client: InsForgeClient,
  context: ComparisonContext,
): Promise<ComparisonSkillInput> {
  const evidences = await listEvidenceRows(client, context.caseRow.id);
  // `buildAuditInputs` devuelve un `AuditSkillInput` completo; la comparación
  // necesita SÓLO sus evidencias, porque el expediente lo arma este servicio
  // (dictamen + resolución humana) y no el del Skill de auditoría.
  const { evidences: items } = await buildAuditInputs(client, context.caseRow, evidences);
  return {
    caseId: context.caseRow.id,
    studentIdentifier: context.caseRow.student_identifier,
    humanResult: context.review.result,
    humanComment: context.review.comment,
    auditResultJson: context.audit.result_json,
    evidences: items,
  };
}

/**
 * Ejecuta la comparación sobre una fila que YA está en RUNNING.
 *
 * Si el proceso muere aquí, la fila queda RUNNING y la siguiente llamada la
 * retoma: por eso el error NO se traga, se marca ERROR y se vuelve a lanzar,
 * igual que hace `runAudit`. El comentario humano del expediente y el dictamen
 * comparado nunca se loguean: son PII.
 */
async function executeComparison(
  client: InsForgeClient,
  inputs: ComparisonSkillInput,
  row: ComparisonRow,
): Promise<StartComparisonOutcome> {
  const startedAt = Date.now();
  const deadlineMs = row.deadline_at ? Date.parse(row.deadline_at) : undefined;

  try {
    const execution = await comparisonSkill.executeWithMetadata(inputs, { deadlineMs });
    const done = await updateComparisonResult(client, row.id, {
      resultJson: execution.result,
      provider: 'openrouter',
      model: execution.model,
      latencyMs: Date.now() - startedAt,
    });
    return { phase: 'done', comparison: comparisonToDto(done) };
  } catch (error) {
    const category: ErrorCategory = error instanceof ApiError ? error.category : 'AI_PROVIDER_ERROR';
    await updateComparisonError(client, row.id, {
      errorCategory: category,
      latencyMs: Date.now() - startedAt,
    }).catch(() => undefined);
    if (error instanceof ApiError) throw error;
    // Fallo no tipado: el mensaje puede incluir respuestas del proveedor,
    // contenido del expediente o PII. Solo se registra el tipo de excepción.
    console.error('[comparison] fallo técnico no controlado:', error instanceof Error ? error.name : typeof error);
    throw new ApiError(502, category, 'La comparación falló; reintenta más tarde.');
  }
}
