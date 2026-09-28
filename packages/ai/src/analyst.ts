import {
  assessmentSchema,
  MAX_AGENT_STEPS,
  MAX_TOOL_CALLS,
  type AiCallRecord,
  type Assessment,
} from '@cancelaciones/shared';
import { analystToolDefinitions, executeTool, type ToolContext } from './tools';
import type { ToolCall } from './openrouter';

export const ANALYST_PROMPT_VERSION = 'analyst-assessment-v2';

/**
 * Prompt del analista.
 *
 * Deliberadamente NO contiene reglas de negocio. El procedimiento se consulta
 * con `searchPolicy`/`readPolicySection`: si las reglas vivieran en el prompt,
 * serían una copia congelada que el agente consultaría en vez del documento, y
 * además quedarían desincronizadas en cuanto el procedimiento cambiara.
 */
export const ANALYST_SYSTEM_PROMPT = `Eres un auditor experto en Cancelaciones de Venta y Deserción de Estudiantes.

La única fuente normativa disponible para este run es:
GDM_GAM_PRD_MLG_003
PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES
VERSIÓN 5

Investiga el expediente usando las tools disponibles.

Reglas de trabajo:
- No inventes hechos. Todo lo que afirmes debe venir de una evidencia.
- No concluyas que una evidencia no existe sin haberla buscado primero.
- Consulta el procedimiento con searchPolicy y readPolicySection cuando
  necesites determinar qué tratamiento corresponde. No uses conocimiento
  externo ni criterio propio en lugar del procedimiento.
- No memorices reglas de negocio en lugar de consultar el procedimiento.

Debes terminar usando la tool submitAssessment.

Resultados permitidos:
- COMPLETED, con una clasificación: CANCELACION_VENTA, BAJA,
  CANCELACION_VENTA_OPERATIVA o DICTAMINACION.
- NEEDS_INPUT, únicamente cuando al expediente le falta información.

NEEDS_INPUT exige explicar qué información falta, por qué es necesaria y qué
evidencia podría resolverlo.

Antes de finalizar:
- Busca contradicciones entre evidencias.
- Revisa la evidencia contraria a tu conclusión.
- Verifica que cada cita de política apunte a una sección real.
- Verifica que cada evidenceId que citas exista en el expediente.

No uses INDETERMINADO.`;

export interface AnalystProvider {
  generateWithTools(input: {
    model: string;
    purpose: string;
    system: string;
    messages: unknown[];
    tools: typeof analystToolDefinitions;
    signal?: AbortSignal;
  }): Promise<{
    content: string;
    message?: unknown;
    toolCalls?: ToolCall[];
    usage?: AiCallRecord;
  }>;
}

export type AnalystResult =
  | {
      status: 'COMPLETED' | 'NEEDS_INPUT';
      assessment: Assessment;
      agentStepCount: number;
      toolCallCount: number;
      policySectionsConsulted: string[];
      usage: AiCallRecord[];
    }
  | {
      status: 'FAILED';
      errorCode: string;
      errorMessage: string;
      agentStepCount: number;
      toolCallCount: number;
      policySectionsConsulted: string[];
      usage: AiCallRecord[];
    };

export interface RunCaseAnalystInput {
  provider: AnalystProvider;
  model: string;
  context: ToolContext;
  maxSteps?: number;
  maxToolCalls?: number;
  signal?: AbortSignal;
  promptVersion?: string;
}

/**
 * Bucle del analista.
 *
 * El historial se mantiene íntegro porque es un requisito del protocolo: cada
 * `role: 'tool'` debe ir precedido del `assistant` que pidió esa llamada, con su
 * `tool_calls`. Sin ese assistant, los proveedores OpenAI-compatibles rechazan
 * el mensaje y el agente se queda sin contexto en el segundo turno.
 *
 * El presupuesto es duro y su agotamiento es un fallo del run, no una
 * conclusión sobre el expediente: un agente que se pasó de vueltas no ha
 * demostrado que falte información, ha demostrado que no pudo decidir.
 */
export async function runCaseAnalyst(input: RunCaseAnalystInput): Promise<AnalystResult> {
  const maxSteps = input.maxSteps ?? MAX_AGENT_STEPS;
  const maxToolCalls = input.maxToolCalls ?? MAX_TOOL_CALLS;
  const usage: AiCallRecord[] = [];
  const policySections = new Set<string>();
  let toolCallCount = 0;
  let step = 0;

  const messages: unknown[] = [
    { role: 'user', content: buildInitialUserMessage(input.context) },
  ];

  const finishFailure = (errorCode: string, errorMessage: string): AnalystResult => ({
    status: 'FAILED',
    errorCode,
    errorMessage,
    agentStepCount: step,
    toolCallCount,
    policySectionsConsulted: [...policySections],
    usage,
  });

  const finishSuccess = (assessment: Assessment): AnalystResult => ({
    status: assessment.status,
    assessment,
    agentStepCount: step,
    toolCallCount,
    policySectionsConsulted: [...policySections],
    usage,
  });

  while (step < maxSteps) {
    step += 1;
    let response: Awaited<ReturnType<AnalystProvider['generateWithTools']>>;
    try {
      response = await input.provider.generateWithTools({
        model: input.model,
        purpose: 'case-analyst',
        system: ANALYST_SYSTEM_PROMPT,
        messages,
        tools: analystToolDefinitions,
        signal: input.signal,
      });
    } catch (error) {
      // Un provider caído es un fallo de infraestructura. Si se propagara, el run
      // se quedaría en ANALYZING sin estado terminal y sin explanation.
      const message = error instanceof Error ? error.message : String(error);
      return finishFailure(errorCodeOf(message), `El proveedor de modelos falló: ${message}`);
    }
    if (response.usage) usage.push(response.usage);

    const calls = response.toolCalls ?? [];
    if (calls.length === 0) {
      return finishFailure(
        'ASSESSMENT_NOT_SUBMITTED',
        'El modelo terminó su turno sin llamar a submitAssessment. El assessment solo se acepta por esa tool.',
      );
    }

    if (toolCallCount + calls.length > maxToolCalls) {
      return finishFailure(
        'AGENT_TOOL_LIMIT',
        `El analista superan el maximo de ${maxToolCalls} llamadas a tools.`,
      );
    }

    // El assistant queoriginó las llamadas se conserva antes de los role: 'tool'.
    messages.push(
      response.message ?? {
        role: 'assistant',
        content: response.content,
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      },
    );

    for (const call of calls) {
      toolCallCount += 1;
      let result;
      try {
        result = await executeTool(call.name, toRecord(call.arguments), input.context);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = message.startsWith('UNKNOWN_TOOL') ? 'UNKNOWN_TOOL' : 'TOOL_EXECUTION_FAILED';
        return finishFailure(code, `Fallo la tool ${call.name}: ${message}`);
      }

      if (result.policySectionConsulted) policySections.add(result.policySectionConsulted);
      messages.push({ role: 'tool', tool_call_id: call.id, content: result.content });

      if (result.terminalAssessment !== undefined) {
        return finishSuccess(assessmentSchema.parse(result.terminalAssessment));
      }
    }
  }

  return finishFailure(
    'AGENT_STEP_LIMIT',
    `El analista agoto su maximo de ${maxSteps} pasos sin entregar assessment.`,
  );
}

/**
 * Mensaje de arranque. No incluye el contenido de las evidencias: el agente debe
 * descubrirlo con `listEvidence` y `readEvidence`, y así queda en la traza que
 * fue a buscarlas en vez de que se le entregaran servidas.
 */
function buildInitialUserMessage(context: ToolContext): string {
  const count = context.evidence?.length ?? 0;
  const lines = [
    `Expediente a analizar: ${context.audit.id}.`,
    `La auditoría tiene ${count} evidencia(s) disponible(s).`,
    'Empieza por listEvidence para conocer cuáles son y su estado de preparación.',
    'Investiga con las tools, consulta el procedimiento y termina con submitAssessment.',
  ];
  return lines.join('\n');
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Convierte el mensaje de un provider caído en un código estable, para que el
 * run que se guarda en la base diga por qué falló sin tener que parsear texto.
 */
function errorCodeOf(message: string): string {
  if (message.startsWith('OPENROUTER_TIMEOUT')) return 'OPENROUTER_TIMEOUT';
  if (message.startsWith('OPENROUTER_INVALID_JSON')) return 'OPENROUTER_INVALID_JSON';
  if (message.startsWith('OPENROUTER_HTTP_429')) return 'OPENROUTER_RATE_LIMITED';
  if (message.startsWith('OPENROUTER_HTTP_5')) return 'OPENROUTER_UNAVAILABLE';
  if (message.startsWith('OPENROUTER_HTTP_')) return 'OPENROUTER_ERROR';
  if (message.startsWith('VISION_FAILED')) return 'VISION_FAILED';
  return 'AI_PROVIDER_FAILED';
}
