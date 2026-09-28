import { MAX_TOOL_OUTPUT_CHARS } from '@cancelaciones/shared';
import { readPolicySection, searchPolicy } from './policy';
import type { ToolDefinition } from './openrouter';

/**
 * Tools del agente.
 *
 * El agente no escribe en base de datos: sus tools son de lectura sobre la
 * evidencia y sobre el procedimiento, más una tool terminal que entrega el
 * assessment. `onToolExecution` es el único punto por el que el runtime
 * persiste la traza durable, y por eso vive en el contexto en vez de recibir un
 * repositorio: este paquete no depende de `@cancelaciones/db`.
 */
export interface ToolContext {
  audit: { id: string } & Record<string, unknown>;
  evidence?: ReadonlyArray<{ id: string; text?: string } & Record<string, unknown>>;
  timeline?: readonly unknown[];
  policyRootDir?: string;
  onToolExecution?: (event: {
    name: string;
    kind: ToolExecutionKindName;
    arguments: Record<string, unknown>;
    output?: string;
    error?: string;
  }) => Promise<void> | void;
}

export type ToolExecutionKindName = 'EVIDENCE' | 'POLICY' | 'CASE';

export interface ToolExecutionResult {
  /** Texto JSON que se devuelve al modelo como contenido del mensaje `role: 'tool'`. */
  content: string;
  /** Sección de procedimiento leída, si esta llamada fue `readPolicySection`. */
  policySectionConsulted?: string;
  /** Assessment entregado, si esta llamada fue `submitAssessment`. */
  terminalAssessment?: unknown;
}

const POLICY_DOCUMENT = 'GDM_GAM_PRD_MLG_003 versión 5';

export const analystToolDefinitions: ToolDefinition[] = [
  { name: 'listEvidence', description: 'Lista las evidencias disponibles del expediente con su identificador, nombre y estado de preparación.', parameters: objectSchema({}) },
  { name: 'readEvidence', description: 'Devuelve el contenido de una evidencia por su identificador. Úsala antes de concluir que algo no está en el expediente.', parameters: objectSchema({ evidenceId: { type: 'string', minLength: 1, description: 'Identificador de la evidencia, tal como aparece en listEvidence.' } }, ['evidenceId']) },
  { name: 'searchEvidence', description: 'Busca una cadena dentro del contenido de todas las evidencias. Úsala para localizar un hecho sin leer todo.', parameters: objectSchema({ query: { type: 'string', minLength: 1 } }, ['query']) },
  { name: 'searchPolicy', description: `Busca secciones del procedimiento oficial ${POLICY_DOCUMENT} que mencionen un término. Devuelve sección, título, relevancia y un fragmento.`, parameters: objectSchema({ query: { type: 'string', minLength: 1 } }, ['query']) },
  { name: 'readPolicySection', description: `Devuelve el texto íntegro de una sección del procedimiento oficial ${POLICY_DOCUMENT}, con su número de página.`, parameters: objectSchema({ sectionId: { type: 'string', minLength: 1, description: 'Identificador de sección, por ejemplo "5.2".' } }, ['sectionId']) },
  { name: 'getCaseMetadata', description: 'Devuelve los datos declarados del caso: CaVe, estudiante, fechas de inicio y matrícula.', parameters: objectSchema({}) },
  { name: 'getTimeline', description: 'Devuelve los eventos ordenados del expediente.', parameters: objectSchema({}) },
  { name: 'submitAssessment', description: 'Entrega el assessment final. Es la única forma de terminar: tras esta tool el run se cierra y no se vuelve a llamar al modelo.', parameters: objectSchema({ assessment: { type: 'object', description: 'Assessment estructurado conforme al contrato del sistema.' } }, ['assessment']) },
];

/**
 * El revisor solo lee. No necesita `submitAssessment`: su veredicto es
 * CONFIRMED o REJECTED y lo entrega por su propio canal, no por una tool.
 */
export const reviewerToolDefinitions: ToolDefinition[] = analystToolDefinitions.filter(
  (tool) => tool.name !== 'submitAssessment',
);

const TOOL_KINDS: Record<string, ToolExecutionKindName> = {
  listEvidence: 'EVIDENCE',
  readEvidence: 'EVIDENCE',
  searchEvidence: 'EVIDENCE',
  searchPolicy: 'POLICY',
  readPolicySection: 'POLICY',
  searchPolicyTool: 'POLICY',
  readPolicySectionTool: 'POLICY',
  getCaseMetadata: 'CASE',
  getTimeline: 'CASE',
  submitAssessment: 'CASE',
  submitAssessmentTool: 'CASE',
};

/**
 * Ejecuta una tool y devuelve texto para el modelo más lo que el runtime necesita
 * observar (sección de política consultada, assessment terminal).
 *
 * Un tool inexistente lanza. La distinción es deliberada: `UNKNOWN_TOOL` es un
 * error técnico del runtime y debe terminar el run en FAILED, no convertirse en un
 * NEEDS_INPUT que finge que al expediente le falta información.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  const kind = TOOL_KINDS[name];
  try {
    const result = await runTool(name, args, context);
    const content = truncate(JSON.stringify(result.value));
    await context.onToolExecution?.({ name, kind: kind ?? 'CASE', arguments: args, output: content });
    return {
      content,
      ...(result.policySectionConsulted ? { policySectionConsulted: result.policySectionConsulted } : {}),
      ...(result.terminalAssessment !== undefined ? { terminalAssessment: result.terminalAssessment } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await context.onToolExecution?.({ name, kind: kind ?? 'CASE', arguments: args, error: message });
    throw error;
  }
}

type ToolOutcome = { value: unknown; policySectionConsulted?: string; terminalAssessment?: unknown };

async function runTool(name: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolOutcome> {
  switch (name) {
    case 'listEvidence':
      return { value: listEvidence(context) };
    case 'readEvidence':
      return { value: readEvidence(String(args.evidenceId ?? ''), context) };
    case 'searchEvidence':
      return { value: searchEvidence(String(args.query ?? ''), context) };
    case 'searchPolicy':
    case 'searchPolicyTool':
      return { value: searchPolicy(String(args.query ?? ''), context.policyRootDir) };
    case 'readPolicySection':
    case 'readPolicySectionTool':
      return {
        value: readPolicySection(String(args.sectionId ?? ''), context.policyRootDir),
        policySectionConsulted: String(args.sectionId ?? ''),
      };
    case 'getCaseMetadata':
      return { value: getCaseMetadata(context) };
    case 'getTimeline':
      return { value: getTimeline(context) };
    case 'submitAssessment':
    case 'submitAssessmentTool':
      return { value: { accepted: true }, terminalAssessment: args.assessment };
    default:
      throw new Error(`UNKNOWN_TOOL:${name}`);
  }
}

export function listEvidence(context: ToolContext): unknown {
  return (context.evidence ?? []).map((item) => ({
    id: item.id,
    originalFilename: item.originalFilename,
    kind: item.kind,
    contentStatus: item.contentStatus,
    contentError: item.contentError,
  }));
}

export function readEvidence(evidenceId: string, context: ToolContext): unknown {
  return (context.evidence ?? []).find((item) => item.id === evidenceId) ?? null;
}

export function searchEvidence(query: string, context: ToolContext): unknown {
  const tokens = query.toLowerCase().split(/\W+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return (context.evidence ?? [])
    .map((item) => ({ item, text: String(item.text ?? '').toLowerCase() }))
    .filter((entry) => tokens.some((token) => entry.text.includes(token)))
    .map((entry) => ({ id: entry.item.id, snippet: snippetAround(entry.item.text ?? '', tokens) }));
}

export function getCaseMetadata(context: ToolContext): unknown {
  return context.audit;
}

export function getTimeline(context: ToolContext): unknown {
  return context.timeline ?? [];
}

function snippetAround(text: string, tokens: string[]): string {
  const lower = text.toLowerCase();
  const first = tokens
    .map((token) => lower.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  return text.slice(Math.max(0, first - 150), Math.max(0, first - 150) + 500);
}

function truncate(value: string): string {
  return value.length > MAX_TOOL_OUTPUT_CHARS ? value.slice(0, MAX_TOOL_OUTPUT_CHARS) : value;
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false };
}
