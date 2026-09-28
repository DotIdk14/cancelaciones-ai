import { describe, expect, test } from 'vitest';
import { resolve } from 'node:path';
import { runCaseAnalyst } from './analyst';
import { runAuditReviewer } from './reviewer';
import { readPolicySection, searchPolicy } from './policy';
import { createFakeAiProvider, FakeOpenRouterScenario } from './fakes';
import { evalDataset } from './eval-dataset';
import type { ToolContext } from './tools';

/**
 * Prueba de humo del recorrido real de política.
 *
 * No usa un policy de mentira: lee `policy/` desde el disco. El provider está
 * guionizado para obligar al agente al orden correcto —buscar, leer la sección
 * encontrada y solo entonces dictaminar— de modo que si `searchPolicy` o
 * `readPolicySection` estuvieran rotos el assessment se caería solo.
 */
const POLICY_ROOT = resolve(__dirname, '../../../policy');
const SEARCH_QUERY = 'intentos de contacto';
const SECTION = '5.2';

function guidedProvider() {
  let turn = 0;
  return {
    async generateWithTools() {
      turn += 1;
      if (turn === 1) {
        return {
          content: 'busco en el procedimiento',
          toolCalls: [
            { id: 't1', name: 'searchPolicy', arguments: { query: SEARCH_QUERY } },
            { id: 't2', name: 'listEvidence', arguments: {} },
          ],
        };
      }
      if (turn === 2) {
        return {
          content: 'leo la sección encontrada',
          toolCalls: [{ id: 't3', name: 'readPolicySection', arguments: { sectionId: SECTION } }],
        };
      }
      return {
        content: 'entrego el dictamen',
        toolCalls: [
          {
            id: 't4',
            name: 'submitAssessment',
            arguments: {
              assessment: {
                status: 'COMPLETED',
                classification: 'CANCELACION_VENTA',
                summary: 'Cancelación de venta sustentada en la sección 5.2 del procedimiento V5.',
                findings: [
                  {
                    title: 'Contactos documentados',
                    detail: 'El expediente registra los intentos de contacto exigidos por la sección 5.2.',
                    evidence: [{ evidenceId: 'ev-1', snippet: 'intentos de contacto documentados' }],
                  },
                ],
                evidenceReferences: [{ evidenceId: 'ev-1', snippet: 'intentos de contacto documentados' }],
                policyReferences: [
                  { procedureVersion: '5', section: SECTION, quote: 'Intentos de contacto mínimos al estudiante' },
                ],
                contradictions: [],
                missingEvidence: [],
                procedureVersion: '5',
              },
            },
          },
        ],
      };
    },
  };
}

function contextWithTrace(): { context: ToolContext; executed: string[] } {
  const executed: string[] = [];
  const base = evalDataset[0]!;
  return {
    executed,
    context: {
      audit: { ...base.audit },
      evidence: [{ id: 'ev-1', text: 'El expediente registra 3 intentos de contacto antes de la baja.' }],
      policyRootDir: POLICY_ROOT,
      timeline: [],
      onToolExecution: (event) => {
        executed.push(event.name);
      },
    },
  };
}

describe('humo con policy/ real', () => {
  test('el agente busca, lee la sección y dictamina con el texto del disco', async () => {
    const { context, executed } = contextWithTrace();
    const result = await runCaseAnalyst({ provider: guidedProvider(), model: 'guided', context });

    expect(result.status).toBe('COMPLETED');
    if (result.status === 'FAILED') throw new Error(`${result.errorCode}: ${result.errorMessage}`);

    expect(executed).toEqual(['searchPolicy', 'listEvidence', 'readPolicySection', 'submitAssessment']);
    expect(result.policySectionsConsulted).toContain(SECTION);
    expect(result.toolCallCount).toBe(4);
    expect(result.assessment?.classification).toBe('CANCELACION_VENTA');
    expect(result.assessment?.policyReferences[0]?.section).toBe(SECTION);
  });

  test('searchPolicy encuentra la sección contra el manifest real', () => {
    const hits = searchPolicy(SEARCH_QUERY, POLICY_ROOT);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((hit) => hit.section === SECTION)).toBe(true);
    expect(hits[0]?.snippet.length).toBeGreaterThan(0);
  });

  test('readPolicySection devuelve el texto real del procedimiento V5', () => {
    const { section, text } = readPolicySection(SECTION, POLICY_ROOT);
    expect(section.id).toBe(SECTION);
    expect(text.length).toBeGreaterThan(200);
    expect(text.toLowerCase()).toContain('contacto');
  });

  test('una sección inexistente falla y no inventa contenido', () => {
    expect(() => readPolicySection('99.99', POLICY_ROOT)).toThrow(/POLICY_SECTION_NOT_FOUND/);
  });

  test('el revisor confirma un assessment sostenido en política real', async () => {
    const { context } = contextWithTrace();
    const analysis = await runCaseAnalyst({ provider: guidedProvider(), model: 'guided', context });
    if (analysis.status === 'FAILED') throw new Error(`${analysis.errorCode}: ${analysis.errorMessage}`);

    const reviewed = await runAuditReviewer({
      provider: createFakeAiProvider(FakeOpenRouterScenario.CASE_CV),
      model: 'reviewer',
      assessment: analysis.assessment,
      context,
    });

    expect(reviewed.status).toBe('COMPLETED');
    expect(reviewed.rounds).toBe(1);
    expect(reviewed.review.verdict).toBe('CONFIRMED');
  });
});
