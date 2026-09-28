import { assessmentSchema, MAX_AGENT_STEPS, MAX_TOOL_CALLS, type Assessment } from '@cancelaciones/shared';
import { executeTool, type ToolContext } from './tools';

export async function runCaseAnalyst(input: ToolContext & {
  provider: { generateWithTools(input: unknown): Promise<{ content: string; toolCalls?: Array<{ id: string; name: string; arguments: unknown }>; finalAssessment?: unknown }>; stepCount?: number; toolCallCount?: number };
  model: string;
  maxSteps?: number;
  maxToolCalls?: number;
}): Promise<Assessment> {
  const maxSteps = input.maxSteps ?? MAX_AGENT_STEPS;
  const maxToolCalls = input.maxToolCalls ?? MAX_TOOL_CALLS;
  let toolCalls = 0;
  const messages: unknown[] = [];

  for (let step = 0; step < maxSteps; step += 1) {
    const response = await input.provider.generateWithTools({ model: input.model, messages });
    if (response.finalAssessment) return assessmentSchema.parse(response.finalAssessment);
    for (const call of response.toolCalls ?? []) {
      if (toolCalls >= maxToolCalls) return needsInput('Se agoto el limite de tools antes de concluir.', 'Limite de tools alcanzado.', 'Reducir evidencia o aportar resumen validado.');
      toolCalls += 1;
      try {
        messages.push({ role: 'tool', toolCallId: call.id, content: await executeTool(call.name, asRecord(call.arguments), input) });
      } catch (error) {
        return needsInput('Fallo una tool requerida por el analista.', `Fallo tool ${call.name}: ${error instanceof Error ? error.message : 'error desconocido'}`, 'Revisar disponibilidad de herramientas y evidencia fuente.');
      }
    }
  }
  return needsInput('Se agoto el limite de pasos del analista.', 'El agente no emitio dictamen dentro del presupuesto.', 'Aportar evidencia mas concreta o ejecutar revision manual.');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function needsInput(description: string, reason: string, suggestedEvidence: string): Assessment {
  return assessmentSchema.parse({
    status: 'NEEDS_INPUT',
    summary: description,
    findings: [],
    evidenceReferences: [],
    policyReferences: [],
    contradictions: [],
    missingEvidence: [{ description, reason, suggestedEvidence }],
    procedureVersion: '5',
  });
}
