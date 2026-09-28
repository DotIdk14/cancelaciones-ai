import {
  assessmentSchema,
  MAX_REVIEW_ROUNDS,
  reviewSchema,
  type Assessment,
  type Review,
} from '@cancelaciones/shared';
import { reviewerToolDefinitions, type ToolContext } from './tools';
import type { ToolCall } from './openrouter';

export const REVIEWER_PROMPT_VERSION = 'reviewer-verdict-v2';

const POLICY_DOCUMENT = 'GDM_GAM_PRD_MLG_003 versión 5';

/**
 * Prompt del revisor.
 *
 * El revisor no rehace el caso: busca contraevidencia. Por eso sus tools son de
 * lectura y por eso el prompt no incluye el procedimiento: su trabajo es
 * comprobar que las citas del dictamen existen, no dictaminar por su cuenta.
 */
export const REVIEWER_SYSTEM_PROMPT = `Eres el revisor de una auditoría de cancelaciones de venta y deserción.

Recibes el assessment propuesto por el analista sobre el procedimiento oficial
${POLICY_DOCUMENT}.

Tu trabajo es buscar contraevidencia, no rehacer el dictamen:
- Comprueba que las citas de política apunten a secciones reales del procedimiento.
  Usa searchPolicy y readPolicySection para verificarlas.
- Comprueba que la evidencia citada exista y diga lo que el assessment afirma.
- Busca contradicciones que el analista no resolvió.
- Señala afirmaciones que no tienen sustento en la evidencia.

Devuelve un veredicto CONFIRMED o REJECTED con explicación.
Si rechazas, indica explícitamente qué falta para poder confirmar y qué
evidencia lo resolvería.`;

export interface ReviewerProvider {
  review(input: {
    model: string;
    system: string;
    messages: unknown[];
    tools: typeof reviewerToolDefinitions;
    signal?: AbortSignal;
  }): Promise<{ value: Review; usage?: unknown }>;
}

export type ReviewerResult = {
  status: 'COMPLETED' | 'NEEDS_INPUT' | 'FAILED';
  finalAssessment: Assessment;
  review: Review;
  rounds: number;
  errorCode?: string;
  errorMessage?: string;
  usage: unknown[];
};

export interface RunAuditReviewerInput {
  provider: ReviewerProvider;
  model: string;
  assessment: Assessment;
  context: ToolContext;
  maxReviewRounds?: number;
  reviseAssessment?: (review: Review, previous: Assessment) => Promise<Assessment>;
  signal?: AbortSignal;
}

/**
 * Revisión con presupuesto de dos rondas.
 *
 * Un REJECTED abre UNA corrección del analista y una segunda revisión. Si el
 * conflicto persiste, el run termina en NEEDS_INPUT: eso sí es una conclusión
 * sobre el expediente, porque significa que dos lecturas independientes del
 * procedimiento no convergen con la evidencia disponible. Un error del proveedor
 * es otra cosa y termina en FAILED.
 */
export async function runAuditReviewer(input: RunAuditReviewerInput): Promise<ReviewerResult> {
  const maxRounds = input.maxReviewRounds ?? MAX_REVIEW_ROUNDS;
  const usage: unknown[] = [];
  let current = input.assessment;
  let rounds = 0;

  while (rounds < maxRounds) {
    rounds += 1;
    let review: Review;
    try {
      const response = await input.provider.review({
        model: input.model,
        system: REVIEWER_SYSTEM_PROMPT,
        messages: [buildReviewUserMessage(current, rounds)],
        tools: reviewerToolDefinitions,
        signal: input.signal,
      });
      if (response.usage) usage.push(response.usage);
      review = reviewSchema.parse(response.value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: 'FAILED',
        finalAssessment: current,
        review: emptyReview('REJECTED', `El revisor no pudo completar su veredicto: ${message}`),
        rounds,
        errorCode: 'REVIEWER_FAILED',
        errorMessage: message,
        usage,
      };
    }

    if (review.verdict === 'CONFIRMED') {
      return { status: current.status, finalAssessment: current, review, rounds, usage };
    }

    const isLastRound = rounds >= maxRounds;
    if (isLastRound || !input.reviseAssessment) {
      return { status: 'NEEDS_INPUT', finalAssessment: needsInput(review), review, rounds, usage };
    }

    // UNA corrección del analista con el feedback del revisor, sin empezar de cero.
    try {
      current = assessmentSchema.parse(await input.reviseAssessment(review, current));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: 'FAILED',
        finalAssessment: current,
        review,
        rounds,
        errorCode: 'REVISION_FAILED',
        errorMessage: message,
        usage,
      };
    }
  }

  return {
    status: 'NEEDS_INPUT',
    finalAssessment: needsInput(emptyReview('REJECTED', 'El revisor agotó sus rondas.')),
    review: emptyReview('REJECTED', 'El revisor agotó sus rondas.'),
    rounds,
    usage,
  };
}

function buildReviewUserMessage(assessment: Assessment, round: number): string {
  const header = round === 1 ? 'Assessment propuesto por el analista:' : 'Assessment corregido tras tu feedback:';
  return [
    header,
    JSON.stringify(assessment),
    '',
    'Verifica las citas de política y la evidencia citada antes de decidir.',
  ].join('\n');
}

function needsInput(review: Review): Assessment {
  return assessmentSchema.parse({
    status: 'NEEDS_INPUT',
    summary: 'El revisor mantiene un conflicto con el dictamen propuesto y el expediente no permite resolverlo.',
    findings: [],
    evidenceReferences: [],
    policyReferences: [],
    contradictions: [],
    missingEvidence:
      review.missingEvidence.length > 0
        ? review.missingEvidence
        : [
            {
              description: 'Evidencia que el revisor considera indispensable y el expediente no contiene',
              reason: review.summary,
              suggestedEvidence: review.instruction ?? 'Revisión humana del expediente con la evidencia señalada.',
            },
          ],
    procedureVersion: '5',
  });
}

function emptyReview(verdict: 'CONFIRMED' | 'REJECTED', summary: string): Review {
  return { verdict, summary, counterEvidence: [], unsupportedClaims: [], missingEvidence: [] };
}
