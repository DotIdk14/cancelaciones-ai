import { reviewSchema, type Assessment, type Review } from '@cancelaciones/shared';
import { evalDataset } from './eval-dataset';

export enum FakeOpenRouterScenario {
  CASE_CV = 'CASE_CV',
  CASE_BAJA = 'CASE_BAJA',
  CASE_OPERATIVA = 'CASE_OPERATIVA',
  CASE_DICTAMINACION = 'CASE_DICTAMINACION',
  CASE_NEEDS_INPUT = 'CASE_NEEDS_INPUT',
  CASE_REVIEW_REJECT = 'CASE_REVIEW_REJECT',
  CASE_TOOL_FAILURE = 'CASE_TOOL_FAILURE',
  CASE_TIMEOUT = 'CASE_TIMEOUT',
}

const scenarioAssessment: Record<string, Assessment> = {
  [FakeOpenRouterScenario.CASE_CV]: evalDataset[0].expected,
  [FakeOpenRouterScenario.CASE_BAJA]: evalDataset[1].expected,
  [FakeOpenRouterScenario.CASE_OPERATIVA]: evalDataset[2].expected,
  [FakeOpenRouterScenario.CASE_DICTAMINACION]: evalDataset[3].expected,
  [FakeOpenRouterScenario.CASE_NEEDS_INPUT]: evalDataset[4].expected,
};

export interface FakeAiProvider {
  scenario: FakeOpenRouterScenario;
  stepCount: number;
  toolCallCount: number;
  generateWithTools(input: unknown): Promise<{ content: string; toolCalls?: Array<{ id: string; name: string; arguments: unknown }>; finalAssessment?: unknown }>;
  review(): Promise<Review>;
}

export function createFakeAiProvider(scenario: FakeOpenRouterScenario): FakeAiProvider {
  return {
    scenario,
    stepCount: 0,
    toolCallCount: 0,
    async generateWithTools() {
      this.stepCount += 1;
      if (scenario === FakeOpenRouterScenario.CASE_TIMEOUT) {
        this.toolCallCount += 1;
        return { content: 'seguir', toolCalls: [{ id: `t-${this.stepCount}`, name: 'listEvidence', arguments: {} }] };
      }
      if (scenario === FakeOpenRouterScenario.CASE_TOOL_FAILURE) {
        return { content: 'tool failure', toolCalls: [{ id: 'bad', name: 'unknownTool', arguments: {} }] };
      }
      return { content: 'final', finalAssessment: scenarioAssessment[scenario] ?? evalDataset[0].expected };
    },
    async review() {
      if (scenario === FakeOpenRouterScenario.CASE_REVIEW_REJECT) {
        return reviewSchema.parse({ verdict: 'REJECTED', summary: 'Falta sustento', unsupportedClaims: ['clasificacion'], missingEvidence: [], counterEvidence: [], instruction: 'Revisar dictamen.' });
      }
      return reviewSchema.parse({ verdict: 'CONFIRMED', summary: 'Sustentado', unsupportedClaims: [], missingEvidence: [], counterEvidence: [] });
    },
  };
}
