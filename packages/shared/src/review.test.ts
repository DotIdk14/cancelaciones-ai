import { describe, expect, it } from 'vitest';
import { reviewSchema, REVIEW_PROMPT_VERSION } from './review';

describe('reviewSchema', () => {
  it('rechaza REJECTED sin afirmaciones sin sustento ni evidencia faltante', () => {
    const resultado = reviewSchema.safeParse({
      verdict: 'REJECTED',
      summary: 'Rechazo sin explicaciones.',
    });

    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      const issue = resultado.error.issues.find((item) => item.path[0] === 'unsupportedClaims');
      expect(issue?.message).toContain('CONFIRMED');
    }
  });

  it('acepta REJECTED cuando señala al menos una afirmación sin sustento', () => {
    const resultado = reviewSchema.safeParse({
      verdict: 'REJECTED',
      summary: 'La fecha de desistimiento no aparece en la evidencia citada.',
      unsupportedClaims: ['El estudiante solicitó la baja antes del periodo indicado.'],
    });

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.unsupportedClaims).toHaveLength(1);
      expect(resultado.data.counterEvidence).toEqual([]);
    }
  });

  it('acepta REJECTED apoyando el rechazo en evidencia faltante', () => {
    const resultado = reviewSchema.safeParse({
      verdict: 'REJECTED',
      summary: 'Falta el documento que sustenta la fecha de la solicitud.',
      missingEvidence: [
        {
          description: 'Formulario de solicitud de desistimiento',
          reason: 'El dictamen se apoya en una fecha que solo consta en ese formulario.',
          suggestedEvidence: 'Formulario escaneado con la fecha de recepción legible.',
        },
      ],
    });

    expect(resultado.success).toBe(true);
  });

  it('acepta CONFIRMED sin campos extra', () => {
    const resultado = reviewSchema.safeParse({
      verdict: 'CONFIRMED',
      summary: 'El dictamen se sostiene con la evidencia citada.',
    });

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.verdict).toBe('CONFIRMED');
      expect(resultado.data.missingEvidence).toEqual([]);
      expect(REVIEW_PROMPT_VERSION).toBe('reviewer-verdict-v1');
    }
  });

  it('rechaza por strict() un veredicto fuera del contrato', () => {
    const resultado = reviewSchema.safeParse({
      verdict: 'APROBADO',
      summary: 'Veredicto no permitido por el contrato.',
    });

    expect(resultado.success).toBe(false);
  });
});
