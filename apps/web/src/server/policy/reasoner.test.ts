import { describe, expect, it } from 'vitest';
import type { StoredFact } from '@cancelaciones/db';
import { buildEvidenceGraph } from './evidence-graph';
import { ReasonerError, runPolicyReasoner } from './reasoner';
import { PROMPT_VERSION, POLICY_REASONER_SYSTEM_PROMPT } from './prompts/policy-reasoner/v1/prompt';

function storedFact(overrides: Partial<StoredFact>): StoredFact {
  return {
    id: 'fact-x', auditId: 'CaVe-30591', runId: 'run-1',
    factType: 'student.level', classification: 'OBSERVABLE', value: 'Estudiante',
    sourceRef: { evidenceId: 'evidence-1' }, confidence: 0.9, createdAt: '2026-09-24T00:00:00Z',
    ...overrides,
  };
}

const minimalFacts: StoredFact[] = [
  storedFact({ id: 'f1', factType: 'student.level', value: 'Estudiante' }),
  storedFact({ id: 'f2', factType: 'contact.effectiveContact', value: false }),
  storedFact({ id: 'f3', factType: 'classroom.hasActivities', value: false }),
];

const validCandidateJson = {
  probableOutcome: 'CANCELACION_VENTA',
  outcomeStatus: 'PROBABLE',
  ruleRefs: [{ ruleId: 'GDM-V5-5.8-A-NON-LICENCIATURA', section: '5.8.a', justification: 'Sin actividad y sin contacto efectivo.' }],
  evidenceRefs: [{ evidenceId: 'evidence-1' }],
  evidenceGaps: ['classroom.hasGrades'],
  conditionNotes: [],
  explanation: 'El estudiante no tuvo actividad academica ni contacto efectivo; procede la cancelacion por ilocalizable.',
  reasoningTrace: [{ step: 'Sin actividad', factType: 'classroom.hasActivities' }, { step: 'Sin contacto', ruleId: 'GDM-V5-5.8-A-NON-LICENCIATURA' }],
};

const jsonCompletion = (content: string) => async () => ({ content, provider: 'OpenRouter', model: 'google/gemini-2.5-flash' });

describe('policy reasoner (IA) con salida estructurada', () => {
  it('parsea y valida JSON valido con el esquema Zod versionado', async () => {
    const graph = buildEvidenceGraph({ auditId: 'CaVe-30591', runId: 'run-1', storedFacts: minimalFacts });
    const result = await runPolicyReasoner({ graph, complete: jsonCompletion(JSON.stringify(validCandidateJson)) });
    expect(result.promptVersion).toBe(PROMPT_VERSION);
    expect(result.candidate.probableOutcome).toBe('CANCELACION_VENTA');
    expect(result.candidate.ruleRefs[0].ruleId).toBe('GDM-V5-5.8-A-NON-LICENCIATURA');
  });

  it('falla controlado MODEL_ERROR si el modelo no responde', async () => {
    const graph = buildEvidenceGraph({ auditId: 'CaVe-30591', runId: 'run-1', storedFacts: minimalFacts });
    const run = runPolicyReasoner({
      graph,
      complete: async () => { throw new Error('OPENROUTER_ERROR_503'); },
    });
    await expect(run).rejects.toBeInstanceOf(ReasonerError);
    await expect(run).rejects.toMatchObject({ kind: 'MODEL_ERROR' });
  });

  it('falla controlado PARSING_ERROR ante JSON invalido', async () => {
    const graph = buildEvidenceGraph({ auditId: 'CaVe-30591', runId: 'run-1', storedFacts: minimalFacts });
    const run = runPolicyReasoner({ graph, complete: jsonCompletion('esto no es json {') });
    await expect(run).rejects.toMatchObject({ kind: 'PARSING_ERROR' });
  });

  it('falla controlado SCHEMA_INVALID ante JSON que no cumple el esquema (ej. regla inventada)', async () => {
    const graph = buildEvidenceGraph({ auditId: 'CaVe-30591', runId: 'run-1', storedFacts: minimalFacts });
    const run = runPolicyReasoner({
      graph,
      complete: jsonCompletion(JSON.stringify({ ...validCandidateJson, ruleRefs: [] })),
    });
    await expect(run).rejects.toMatchObject({ kind: 'SCHEMA_INVALID' });
  });

  it('el prompt de sistema declara la politica INMUTABLE y prohibe inventar normativa', () => {
    expect(POLICY_REASONER_SYSTEM_PROMPT).toContain('INMUTABLE');
    expect(POLICY_REASONER_SYSTEM_PROMPT.toLowerCase()).toContain('nunca inventes');
  });
});
