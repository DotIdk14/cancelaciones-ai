import { describe, expect, test } from 'vitest';
import { MAX_REVIEW_ROUNDS, type Review } from '@cancelaciones/shared';
import { runAuditReviewer, type ReviewerProvider } from './reviewer';
import { evalDataset } from './eval-dataset';
import type { ToolContext } from './tools';

const base = evalDataset[0]!;
const assessment = base.expected;
const context: ToolContext = { audit: { ...base.audit }, evidence: [...base.evidence] };

const CONFIRMED: Review = { verdict: 'CONFIRMED', summary: 'Sustentado', counterEvidence: [], unsupportedClaims: [], missingEvidence: [] };
const REJECTED: Review = { verdict: 'REJECTED', summary: 'Sin sustento', counterEvidence: [], unsupportedClaims: ['classification'], missingEvidence: [], instruction: 'Aportar evidencia.' };

function reviewerReturning(sequence: Review[]): ReviewerProvider {
  let index = 0;
  return {
    async review() {
      const value = sequence[Math.min(index, sequence.length - 1)]!;
      index += 1;
      return { value };
    },
  };
}

describe('runAuditReviewer', () => {
  test('CONFIRMED devuelve el assessment sin tocarlo', async () => {
    const result = await runAuditReviewer({ provider: reviewerReturning([CONFIRMED]), model: 'fake', assessment, context });
    expect(result.status).toBe('COMPLETED');
    expect(result.finalAssessment).toEqual(assessment);
    expect(result.rounds).toBe(1);
  });

  test('REJECTED en la primera ronda abre exactamente una revisión del analista', async () => {
    let revisiones = 0;
    const result = await runAuditReviewer({
      provider: reviewerReturning([REJECTED, CONFIRMED]),
      model: 'fake',
      assessment,
      context,
      reviseAssessment: async () => {
        revisiones += 1;
        return assessment;
      },
    });

    expect(revisiones).toBe(1);
    expect(result.rounds).toBe(2);
    expect(result.status).toBe('COMPLETED');
  });

  test('segundo rechazo termina NEEDS_INPUT y no se reintenta más', async () => {
    let revisiones = 0;
    const result = await runAuditReviewer({
      provider: reviewerReturning([REJECTED]),
      model: 'fake',
      assessment,
      context,
      maxReviewRounds: MAX_REVIEW_ROUNDS,
      reviseAssessment: async () => {
        revisiones += 1;
        return assessment;
      },
    });

    expect(revisiones).toBe(1);
    expect(result.rounds).toBe(2);
    expect(result.status).toBe('NEEDS_INPUT');
    expect(result.finalAssessment.missingEvidence.length).toBeGreaterThan(0);
  });

  test('NEEDS_INPUT del revisor explica qué evidencia lo resolvería', async () => {
    const result = await runAuditReviewer({
      provider: reviewerReturning([{ ...REJECTED, missingEvidence: [{ description: 'Historial de aula virtual', reason: 'El procedimiento exige verificar actividad académica', suggestedEvidence: 'Historial de Aula Virtual' }] }]),
      model: 'fake',
      assessment,
      context,
      reviseAssessment: async () => assessment,
    });

    const [missing] = result.finalAssessment.missingEvidence;
    expect(missing?.description).toBe('Historial de aula virtual');
    expect(missing?.suggestedEvidence).toBe('Historial de Aula Virtual');
  });

  test('el feedback del revisor se entrega al analista en la corrección', async () => {
    const vistos: Review[] = [];
    await runAuditReviewer({
      provider: reviewerReturning([REJECTED, CONFIRMED]),
      model: 'fake',
      assessment,
      context,
      reviseAssessment: async (review) => {
        vistos.push(review);
        return assessment;
      },
    });

    expect(vistos[0]?.verdict).toBe('REJECTED');
    expect(vistos[0]?.unsupportedClaims).toContain('classification');
  });

  test('veredicto con forma inválida se trata como fallo técnico', async () => {
    const result = await runAuditReviewer({
      provider: { async review() { return { value: { verdict: 'QUIZAS' } as unknown as Review }; } },
      model: 'fake',
      assessment,
      context,
    });
    expect(result).toMatchObject({ status: 'FAILED', errorCode: 'REVIEWER_FAILED' });
  });
});
