import type { CandidateDecision } from '@cancelaciones/policy-engine';
import { parseJsonFromCompletion, requestStructuredCompletion, type StructuredOutput } from '@/server/ai/openrouter';
import type { EvidenceGraph, GraphFactView } from './evidence-graph';
import { buildReasonerUserPrompt, candidateDecisionSchema, POLICY_REASONER_SYSTEM_PROMPT, PROMPT_VERSION } from './prompts/policy-reasoner/v1/prompt';

export type ReasonerErrorKind = 'MODEL_ERROR' | 'PARSING_ERROR' | 'SCHEMA_INVALID';

export class ReasonerError extends Error {
  readonly kind: ReasonerErrorKind;
  constructor(kind: ReasonerErrorKind, message: string) {
    super(message);
    this.name = 'ReasonerError';
    this.kind = kind;
  }
}

export type CompletionFn = (input: { system: string; user: string; json: true }) => Promise<StructuredOutput>;

const defaultCompletion: CompletionFn = async ({ system, user }) => requestStructuredCompletion({ system, user, json: true });

function isGraphFactView(value: unknown): value is GraphFactView {
  return Boolean(value && typeof value === 'object' && 'factType' in (value as Record<string, unknown>) && 'value' in (value as Record<string, unknown>));
}

/**
 * Policy Reasoner (IA): interpreta el grafo de evidencia y produce la decisión
 * candidata. Temperatura 0, salida estructurada validada con Zod, prompt
 * versionado. Ante respuestas inválidas falla de forma controlada
 * (ReasonerError) para que la corrida sea reintentable y nunca se propague un
 * JSON inválido al flujo.
 */
export async function runPolicyReasoner(input: {
  graph: EvidenceGraph;
  complete?: CompletionFn;
}): Promise<{ candidate: CandidateDecision; promptVersion: string }> {
  const complete = input.complete ?? defaultCompletion;
  const user = buildReasonerUserPrompt({
    policyCode: 'GDM_GAM_PRD_MLG_003',
    policyVersion: '5',
    graph: {
      factTypes: input.graph.factTypes,
      facts: input.graph.resolvedFacts
        .map((fact) => ({
          factType: fact.factType,
          value: fact.value,
          evidenceId: typeof fact.sourceRef.evidenceId === 'string' ? fact.sourceRef.evidenceId : '',
          confidence: fact.confidence,
        }))
        .filter(isGraphFactView),
      conflicts: input.graph.conflicts.map(({ factType, reason }) => ({ factType, reason })),
      notes: input.graph.notes.map(({ factType, note }) => ({ factType, note })),
      missingFacts: input.graph.missingFacts,
    },
  });

  let output: StructuredOutput;
  try {
    output = await complete({ system: POLICY_REASONER_SYSTEM_PROMPT, user, json: true });
  } catch (error) {
    throw new ReasonerError('MODEL_ERROR', error instanceof Error ? error.message : 'El modelo no produjo respuesta.');
  }

  let raw: unknown;
  try {
    raw = parseJsonFromCompletion<unknown>(output.content);
  } catch {
    throw new ReasonerError('PARSING_ERROR', 'La respuesta del modelo no es JSON valido.');
  }

  const parsed = candidateDecisionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ReasonerError('SCHEMA_INVALID', `La respuesta no cumple el esquema: ${parsed.error.issues.map((issue) => issue.path.join('.') + ' ' + issue.message).join('; ')}`);
  }

  return { candidate: parsed.data as CandidateDecision, promptVersion: PROMPT_VERSION };
}