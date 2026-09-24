import { z } from 'zod';
import { EXPECTED_OUTCOMES, type Outcome } from '@cancelaciones/policy-engine';

export const PROMPT_VERSION = 'policy-reasoner/v1';

/**
 * Prompt de sistema del Policy Reasoner (v1).
 *
 * Reglas invariables:
 * - La política GDM_GAM_PRD_MLG_003 es INMUTABLE: la IA interpreta evidencia y
 *   propone un resultado probable, pero NUNCA inventa, altera o flexibiliza
 *   reglas, ni crea excepciones inexistentes.
 * - Toda conclusión debe trazarse a sección/numeral/regla y a evidencia.
 * - No se pide ni se produce cadena de pensamiento privada: solo el JSON
 *   estructurado final con el razonamiento trazable.
 */
export const POLICY_REASONER_SYSTEM_PROMPT = `Eres el Policy Reasoner de un sistema de auditoria de cancelaciones de venta (politica GDM_GAM_PRD_MLG_003, version 5).

Tu tarea: interpretar el grafo de evidencia y proponer una DECISION CANDIDATA (resultado probable) que un Rule Engine validador verificara contra las reglas formales.

REGLAS INMUTABLES:
1. NUNCA inventes, alteres, flexibilices reglas ni crees excepciones inexistentes de la politica. La politica es INMUTABLE.
2. Toda conclusion debe citar: una regla del catalogo formal (ruleId como GDM-V5-5.8-A-NON-LICENCIATURA), una seccion/numeral (p. ej. 5.8.a) y evidencia.
3. No interpretes un comentario temprano (p. ej. "se rechaza") como resolucion final: solo el dictamen final resuelve.
4. UNKNOWN no es FALSE: si falta evidencia, declara el gap en evidenceGaps.
5. Si la evidencia es insuficiente o contradictoria, declara INSUFFICIENT_EVIDENCE o CONFLICTED con gaps explicitos.
6. No incluyas cadena de pensamiento privada: reasoningTrace solo pasos de interpretacion trazables (hecho -> condicion -> regla -> conclusion).

Resultados posibles (enum): ${EXPECTED_OUTCOMES.join(', ')}.

Salida: JSON estricto que cumpla el esquema (probableOutcome, outcomeStatus, ruleRefs[], evidenceRefs[], evidenceGaps[], conditionNotes[], explanation, reasoningTrace[]).`;

export const candidateDecisionSchema = z.object({
  probableOutcome: z.enum(EXPECTED_OUTCOMES as [Outcome, ...Outcome[]], { message: 'probableOutcome debe ser un outcome del catalogo' }),
  outcomeStatus: z.enum(['SUPPORTED', 'PROBABLE', 'UNCERTAIN', 'INSUFFICIENT_EVIDENCE', 'CONFLICTED'], {
    message: 'outcomeStatus debe ser SUPPORTED | PROBABLE | UNCERTAIN | INSUFFICIENT_EVIDENCE | CONFLICTED',
  }),
  ruleRefs: z.array(z.object({
    ruleId: z.string().min(3, 'ruleId muy corto'),
    section: z.string().min(1, 'section obligatoria'),
    justification: z.string().min(1, 'justificacion obligatoria'),
  })).min(1, 'al menos una regla del catalogo debe sustentar la decision'),
  evidenceRefs: z.array(z.object({
    evidenceId: z.string().min(1, 'evidenceId obligatorio'),
    artifactId: z.string().optional(),
    page: z.number().int().nonnegative().optional(),
    timestampStart: z.number().optional(),
    timestampEnd: z.number().optional(),
  })).max(50),
  evidenceGaps: z.array(z.string()),
  conditionNotes: z.array(z.object({
    factType: z.string(),
    note: z.string(),
    evidenceId: z.string().optional(),
  })),
  explanation: z.string().min(10, 'explicacion demasiado corta'),
  reasoningTrace: z.array(z.object({
    step: z.string().min(1),
    factType: z.string().optional(),
    ruleId: z.string().optional(),
    evidenceId: z.string().optional(),
  })).min(1, 'al menos un paso de razonamiento trazable'),
});

export type CandidateDecisionOutput = z.infer<typeof candidateDecisionSchema>;

export interface GraphFactView {
  factType: string;
  value: unknown;
  evidenceId: string;
  confidence: number | null;
}

export function buildReasonerUserPrompt(input: {
  graph: {
    factTypes: string[];
    facts: GraphFactView[];
    conflicts: Array<{ factType: string; reason: string }>;
    notes: Array<{ factType: string; note: string }>;
    missingFacts: string[];
  };
  policyCode: string;
  policyVersion: string;
}): string {
  const lines = [
    `Politica: ${input.policyCode} v${input.policyVersion}.`,
    `Tipos de hechos observados: ${input.graph.factTypes.join(', ') || '(ninguno)'}.`,
    '',
    'Hechos con evidencia (factType | valor | evidencia | confianza):',
  ];
  for (const fact of input.graph.facts) {
    lines.push(`- ${fact.factType} = ${JSON.stringify(fact.value)} | evidencia ${fact.evidenceId} | confianza ${fact.confidence ?? 'n/a'}`);
  }
  if (input.graph.conflicts.length) {
    lines.push('', 'Contradicciones detectadas (deben declararse o resolverse con evidencia):');
    for (const conflict of input.graph.conflicts) lines.push(`- ${conflict.factType}: ${conflict.reason}`);
  }
  if (input.graph.notes.length) {
    lines.push('', 'Notas de normalizacion de grafo:');
    for (const note of input.graph.notes) lines.push(`- ${note.factType}: ${note.note}`);
  }
  lines.push('', `Evidencia faltante: ${input.graph.missingFacts.join(', ') || 'ninguna declarada'}.`);
  lines.push('', 'Produce la decision candidata en JSON estricto segun el esquema.');
  return lines.join('\n');
}
