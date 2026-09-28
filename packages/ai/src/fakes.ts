import { reviewSchema, type AiCallRecord, type Assessment, type Review } from '@cancelaciones/shared';
import { evalDataset } from './eval-dataset';
import type { ToolCall } from './openrouter';
import type { AnalystProvider } from './analyst';
import type { ReviewerProvider } from './reviewer';

export enum FakeOpenRouterScenario {
  CASE_CV = 'CASE_CV',
  CASE_BAJA = 'CASE_BAJA',
  CASE_OPERATIVA = 'CASE_OPERATIVA',
  CASE_DICTAMINACION = 'CASE_DICTAMINACION',
  CASE_NEEDS_INPUT = 'CASE_NEEDS_INPUT',
  CASE_REVIEW_REJECT = 'CASE_REVIEW_REJECT',
  CASE_TOOL_FAILURE = 'CASE_TOOL_FAILURE',
  CASE_TIMEOUT = 'CASE_TIMEOUT',
  /** El provider revienta siempre: representa un fallo de infraestructura, no del expediente. */
  CASE_PROVIDER_FAILURE = 'CASE_PROVIDER_FAILURE',
}

const scenarioAssessment: Record<string, Assessment> = {
  [FakeOpenRouterScenario.CASE_CV]: evalDataset[0].expected,
  [FakeOpenRouterScenario.CASE_BAJA]: evalDataset[1].expected,
  [FakeOpenRouterScenario.CASE_OPERATIVA]: evalDataset[2].expected,
  [FakeOpenRouterScenario.CASE_DICTAMINACION]: evalDataset[3].expected,
  [FakeOpenRouterScenario.CASE_NEEDS_INPUT]: evalDataset[4].expected,
};

function usage(purpose: string, model: string): AiCallRecord {
  return {
    provider: 'fake',
    model,
    purpose,
    inputTokens: 120,
    outputTokens: 60,
    estimatedCostUsd: 0,
    latencyMs: 1,
    errorCode: null,
  };
}

function toolCall(name: string, args: Record<string, unknown>, index: number): ToolCall {
  return { id: `call-${index}`, name, arguments: args };
}

function assistant(content: string, calls: ToolCall[]) {
  return {
    role: 'assistant' as const,
    content,
    tool_calls: calls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    })),
  };
}

/**
 * Provider de mentira que habla el MISMO protocolo que OpenRouter: devuelve
 * mensajes de assistant con `tool_calls` y termina llamando a `submitAssessment`.
 *
 * Antes devolvía `finalAssessment` directo, que no es un mensaje de assistant y
 * por tanto no ejercitaba el historial, ni el orden system/user, ni la
 * terminación por tool. Los tests pasaban sin que un solo turno real hubiera
 * ocurrido.
 */
export interface FakeAiProvider extends AnalystProvider {
  scenario: FakeOpenRouterScenario;
  turns: ToolCall[][];
  analystModel: string;
  reviewerModel: string;
  visionModel: string;
  fastModel: string;
  readonly name: string;
  generateWithTools(input: {
    model: string;
    purpose: string;
    system: string;
    messages: unknown[];
    tools: { name: string }[];
    signal?: AbortSignal;
  }): ReturnType<AnalystProvider['generateWithTools']>;
  review(input: { model: string; system: string; messages: unknown[]; tools: { name: string }[] }): Promise<{
    value: Review;
    usage?: AiCallRecord;
  }>;
  describeImage(input: { prompt: string }): Promise<{ text: string; inputTokens: number; outputTokens: number; model: string }>;
}

export function createFakeAiProvider(scenario: FakeOpenRouterScenario): FakeAiProvider {
  const turns: ToolCall[][] = [];
  let turn = 0;

  return {
    scenario,
    turns,
    name: 'fake-openrouter',
    analystModel: 'fake-analyst',
    reviewerModel: 'fake-reviewer',
    visionModel: 'fake-vision',
    fastModel: 'fake-fast',

    async generateWithTools(input) {
      if (scenario === FakeOpenRouterScenario.CASE_PROVIDER_FAILURE) {
        throw new Error('OPENROUTER_HTTP_503');
      }
      turn += 1;

      if (scenario === FakeOpenRouterScenario.CASE_TIMEOUT) {
        // Nunca entrega assessment: agota el presupuesto de pasos.
        const calls = [toolCall('listEvidence', {}, turn)];
        turns.push(calls);
        return { content: 'sigo buscando', message: assistant('sigo buscando', calls), toolCalls: calls, usage: usage('case-analyst', input.model) };
      }

      if (turn === 1) {
        // Primer turno: investiga, como haría un agente real antes de concluir.
        const calls = [
          toolCall('listEvidence', {}, turn),
          toolCall('readEvidence', { evidenceId: 'ev-1' }, turn),
        ];
        turns.push(calls);
        return { content: 'inspecciono', message: assistant('inspecciono', calls), toolCalls: calls, usage: usage('case-analyst', input.model) };
      }

      const calls = [toolCall('submitAssessment', { assessment: scenarioAssessment[scenario] ?? evalDataset[0].expected }, turn)];
      turns.push(calls);
      return { content: 'listo', message: assistant('listo', calls), toolCalls: calls, usage: usage('case-analyst', input.model) };
    },

    async review(input) {
      if (scenario === FakeOpenRouterScenario.CASE_PROVIDER_FAILURE) {
        throw new Error('OPENROUTER_HTTP_502');
      }
      if (scenario === FakeOpenRouterScenario.CASE_REVIEW_REJECT) {
        return {
          value: reviewSchema.parse({
            verdict: 'REJECTED',
            summary: 'La clasificación no está sostenida por la evidencia citada.',
            unsupportedClaims: ['classification'],
            missingEvidence: [],
            counterEvidence: [],
            instruction: 'Aportar la evidencia que sustenta la clasificación.',
          }),
          usage: usage('audit-reviewer', input.model),
        };
      }
      return {
        value: reviewSchema.parse({
          verdict: 'CONFIRMED',
          summary: 'Dictamen sustentado en evidencia y procedimiento.',
          unsupportedClaims: [],
          missingEvidence: [],
          counterEvidence: [],
        }),
        usage: usage('audit-reviewer', input.model),
      };
    },

    async describeImage() {
      return { text: 'Transcripción literal de la imagen de prueba.', inputTokens: 100, outputTokens: 40, model: 'fake-vision' };
    },
  } satisfies FakeAiProvider as FakeAiProvider;
}

/** Provider de revisor que siempre lanza, para probar que el fallo técnico no se disfraza de NEEDS_INPUT. */
export function createFailingReviewerProvider(): ReviewerProvider {
  return {
    async review() {
      throw new Error('OPENROUTER_HTTP_500');
    },
  };
}
