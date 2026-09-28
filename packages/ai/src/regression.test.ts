import { describe, expect, test } from 'vitest';
import { MAX_TOOL_CALLS } from '@cancelaciones/shared';
import { runCaseAnalyst, type AnalystProvider } from './analyst';
import { executeTool, analystToolDefinitions, reviewerToolDefinitions, type ToolContext } from './tools';
import type { ToolCall } from './openrouter';
import { evalDataset } from './eval-dataset';

const base = evalDataset[0]!;
const context: ToolContext = {
  audit: { ...base.audit },
  evidence: [...base.evidence],
  timeline: [...base.timeline],
};

interface ScriptedCall {
  name: string;
  args?: Record<string, unknown>;
}

interface ScriptedTurn {
  calls: ScriptedCall[];
  /** Si se omite, el provider NO devuelve `message` y se ejercita el assistant de respaldo. */
  message?: boolean;
}

type SentMessage = { role?: string; tool_call_id?: string; tool_calls?: Array<{ id: string }>; content?: unknown };

function assistantMessage(calls: ToolCall[]): unknown {
  return {
    role: 'assistant',
    content: 'turno',
    tool_calls: calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })),
  };
}

/**
 * Provider guionizado que devuelve turnos reales de assistant con `tool_calls`.
 *
 * Devuelve el `message` crudo solo en los turnos que lo piden, para poder
 * comparar el historial que se construye cuando el provider lo entrega contra el
 * que se construye cuando hay que armarlo a mano. Un historial válido depende de
 * los dos caminos: el mensaje crudo puede llegar con contenido `null` y hay que
 * conservarlo tal cual, y el de respaldo tiene que llevar los `tool_calls` o los
 * `role: 'tool'` siguientes quedan huérfanos.
 */
function scriptedProvider(turns: ScriptedTurn[]) {
  const histories: SentMessage[][] = [];
  let index = 0;
  const provider: AnalystProvider = {
    async generateWithTools(input) {
      histories.push(structuredClone(input.messages) as SentMessage[]);
      const turn = turns[Math.min(index, turns.length - 1)]!;
      index += 1;
      const calls: ToolCall[] = turn.calls.map((call, position) => ({
        id: `t${index}-c${position}`,
        name: call.name,
        arguments: call.args ?? {},
      }));
      return {
        content: 'turno',
        ...(turn.message === false ? {} : { message: assistantMessage(calls) }),
        toolCalls: calls,
        usage: {
          provider: 'scripted',
          model: input.model,
          purpose: input.purpose,
          inputTokens: 10,
          outputTokens: 5,
          estimatedCostUsd: 0,
          latencyMs: 1,
          errorCode: null,
        },
      };
    },
  };
  return { provider, histories };
}

const submitTurn = (): ScriptedTurn => ({ calls: [{ name: 'submitAssessment', args: { assessment: base.expected } }] });

/** Tres turnos: investigar, consultar el procedimiento y entregar el dictamen. */
const turns: ScriptedTurn[] = [
  { calls: [{ name: 'listEvidence' }, { name: 'readEvidence', args: { evidenceId: 'ev-1' } }] },
  { calls: [{ name: 'readPolicySection', args: { sectionId: '5.2' } }] },
  submitTurn(),
];

describe('contrato de tools entre analista y revisor', () => {
  test('el revisor recibe las tools de lectura y ninguna terminal', () => {
    const names = reviewerToolDefinitions.map((tool) => tool.name);

    expect(names).not.toContain('submitAssessment');
    expect(names).toContain('readPolicySection');
    // El conjunto tiene que ser exactamente el del analista menos la terminal: si
    // se añade una tool de lectura hay que decidir si el revisor la ve.
    expect([...names].sort()).toEqual(analystToolDefinitions.map((tool) => tool.name).filter((name) => name !== 'submitAssessment').sort());
  });

  test('toda tool declarada por el revisor es ejecutable de verdad', async () => {
    const failures: string[] = [];

    for (const tool of reviewerToolDefinitions) {
      // Solo readPolicySection exige un argumento real; el resto acepta `{}`.
      const args = tool.name === 'readPolicySection' ? { sectionId: '5.2' } : {};
      try {
        const result = await executeTool(tool.name, args, { ...context, onToolExecution: undefined });
        if (typeof result.content !== 'string' || result.content.length === 0) failures.push(`${tool.name}: contenido vacio`);
      } catch (error) {
        failures.push(`${tool.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    expect(failures).toEqual([]);
  });
});

describe('integridad del historial que ve el modelo', () => {
  test('ningún role=tool queda sin el assistant que lo pidio, en ningun turno', async () => {
    const { provider, histories } = scriptedProvider(turns);
    const result = await runCaseAnalyst({ provider, model: 'scripted', context, maxSteps: 3, maxToolCalls: MAX_TOOL_CALLS });

    expect(result.status).toBe('COMPLETED');
    expect(histories.length).toBe(3);

    for (const history of histories) {
      const roles = history.map((message) => message.role);
      expect(roles[0]).toBe('user');

      // Invariante del protocolo: cada `role: 'tool'` pertenece a un bloque de
      // tools que va justo detrás del assistant que pidió esas llamadas, y su
      // tool_call_id está entre las de ese assistant. Un 'tool' suelto es
      // exactamente el mensaje que un proveedor OpenAI-compatible rechaza.
      let position = 0;
      while (position < history.length) {
        if (history[position]!.role !== 'tool') {
          position += 1;
          continue;
        }
        const assistant = history[position - 1];
        expect(assistant?.role).toBe('assistant');
        const requested = assistant?.tool_calls?.map((call) => call.id) ?? [];
        while (position < history.length && history[position]!.role === 'tool') {
          expect(requested).toContain(history[position]!.tool_call_id);
          position += 1;
        }
        // Todas las tool_calls del assistant deben tener su mensaje 'tool'.
        expect(requested).toHaveLength(
          [...history.slice(0, position)].reverse().findIndex((message) => message.role !== 'tool'),
        );
      }
    }
  });

  test('el historial solo crece: cada turno es un prefijo intacto del siguiente', async () => {
    const { provider, histories } = scriptedProvider(turns);
    await runCaseAnalyst({ provider, model: 'scripted', context, maxSteps: 3, maxToolCalls: MAX_TOOL_CALLS });

    for (let turn = 1; turn < histories.length; turn += 1) {
      const previous = histories[turn - 1]!;
      const current = histories[turn]!;
      expect(current.length).toBeGreaterThan(previous.length);
      expect(current.slice(0, previous.length)).toEqual(previous);
    }
  });

  test('el assistant de respaldo también lleva tool_calls cuando el provider no devuelve message', async () => {
    const { provider, histories } = scriptedProvider(
      turns.map((turn) => ({ ...turn, message: false })),
    );
    const result = await runCaseAnalyst({ provider, model: 'scripted', context, maxSteps: 3, maxToolCalls: MAX_TOOL_CALLS });

    expect(result.status).toBe('COMPLETED');
    const finalHistory = histories.at(-1)!;
    // Dos assistants visibles: el del último turno ya no se envía a nadie porque
    // submitAssessment cierra el run, pero los anteriores sí deben haber
    // sobrevivido con sus tool_calls.
    const assistants = finalHistory.filter((message) => message.role === 'assistant');
    expect(assistants.length).toBe(2);
    for (const assistant of assistants) expect(assistant.tool_calls?.length).toBeGreaterThan(0);
    expect(finalHistory.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'assistant', 'tool']);
  });

  test('el system prompt viaja en su propio campo y no se cuela en messages', async () => {
    const { provider } = scriptedProvider(turns);
    const seen: Array<{ system: string; roles: (string | undefined)[] }> = [];
    const spying: AnalystProvider = {
      async generateWithTools(input) {
        seen.push({ system: input.system, roles: (input.messages as SentMessage[]).map((message) => message.role) });
        return provider.generateWithTools(input);
      },
    };

    await runCaseAnalyst({ provider: spying, model: 'scripted', context, maxSteps: 3, maxToolCalls: MAX_TOOL_CALLS });

    for (const call of seen) {
      expect(call.system).toContain('GDM_GAM_PRD_MLG_003');
      expect(call.roles).not.toContain('system');
    }
  });
});

describe('conteo de herramientas', () => {
  test('toolCallCount coincide con las ejecuciones reales y con la traza', async () => {
    const events: Array<{ name: string; error?: string }> = [];
    const { provider } = scriptedProvider(turns);
    const result = await runCaseAnalyst({
      provider,
      model: 'scripted',
      context: { ...context, onToolExecution: (event) => { events.push({ name: event.name, error: event.error }); } },
      maxSteps: 3,
      maxToolCalls: MAX_TOOL_CALLS,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.toolCallCount).toBe(events.length);
    expect(result.toolCallCount).toBe(4);
    expect(events.map((event) => event.name)).toEqual(['listEvidence', 'readEvidence', 'readPolicySection', 'submitAssessment']);
    expect(events.every((event) => event.error === undefined)).toBe(true);
    // Las secciones consultadas se acumulan sin repetir.
    expect(result.policySectionsConsulted).toEqual(['5.2']);
  });

  test('una tool que lanza cuenta en toolCallCount y en la traza, con su error', async () => {
    const events: Array<{ name: string; error?: string }> = [];
    const provider: AnalystProvider = {
      async generateWithTools() {
        return { content: '', toolCalls: [{ id: 'x', name: 'readPolicySection', arguments: { sectionId: '99.99' } }] };
      },
    };

    const result = await runCaseAnalyst({
      provider,
      model: 'scripted',
      context: { ...context, onToolExecution: (event) => { events.push({ name: event.name, error: event.error }); } },
    });

    expect(result).toMatchObject({ status: 'FAILED', errorCode: 'TOOL_EXECUTION_FAILED', toolCallCount: 1 });
    expect(events).toHaveLength(1);
    expect(events[0]!.error).toContain('POLICY_SECTION_NOT_FOUND');
  });

  test('el límite de tool calls se comprueba antes de ejecutar, no después', async () => {
    const events: string[] = [];
    const { provider } = scriptedProvider([{ calls: [{ name: 'listEvidence' }, { name: 'listEvidence' }] }]);

    const result = await runCaseAnalyst({
      provider,
      model: 'scripted',
      context: { ...context, onToolExecution: (event) => { events.push(event.name); } },
      maxSteps: 3,
      maxToolCalls: 1,
    });

    expect(result).toMatchObject({ status: 'FAILED', errorCode: 'AGENT_TOOL_LIMIT' });
    // Si ejecutara primero y contara después, dejaría llamadas hechas y cobradas
    // que nunca entraron en el historial del modelo.
    expect(events).toEqual([]);
  });

  test('submitAssessment corta el bucle: la tool terminal también queda registrada', async () => {
    const events: string[] = [];
    const { provider } = scriptedProvider([submitTurn()]);
    const result = await runCaseAnalyst({
      provider,
      model: 'scripted',
      context: { ...context, onToolExecution: (event) => { events.push(event.name); } },
      maxSteps: 5,
      maxToolCalls: MAX_TOOL_CALLS,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.agentStepCount).toBe(1);
    expect(events).toEqual(['submitAssessment']);
  });
});
