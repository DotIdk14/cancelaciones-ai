import { describe, expect, it } from 'vitest';
import { assessmentSchema, ASSESSMENT_PROMPT_VERSION } from './assessment';

describe('assessmentSchema', () => {
  it('acepta un dictamen COMPLETED con classification y rellena las listas vacías', () => {
    const resultado = assessmentSchema.safeParse({
      status: 'COMPLETED',
      classification: 'CANCELACION_VENTA',
      summary: 'La carta de desistimiento firmada acredita la venta de la materia en el periodo indicado.',
      procedureVersion: 'GDM_GAM_PRD_MLG_003 v5',
    });

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.classification).toBe('CANCELACION_VENTA');
      expect(resultado.data.missingEvidence).toEqual([]);
      expect(resultado.data.findings).toEqual([]);
    }
  });

  it('rechaza NEEDS_INPUT sin missingEvidence', () => {
    const resultado = assessmentSchema.safeParse({
      status: 'NEEDS_INPUT',
      summary: 'No hay evidencia suficiente para dictaminar.',
      procedureVersion: 'GDM_GAM_PRD_MLG_003 v5',
    });

    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      const issue = resultado.error.issues.find((item) => item.path[0] === 'missingEvidence');
      expect(issue?.message).toContain('missingEvidence');
    }
  });

  it('acepta NEEDS_INPUT con la evidencia faltante explicada', () => {
    const resultado = assessmentSchema.safeParse({
      status: 'NEEDS_INPUT',
      summary: 'Falta la carta de desistimiento firmada.',
      procedureVersion: 'GDM_GAM_PRD_MLG_003 v5',
      missingEvidence: [
        {
          description: 'Carta de desistimiento firmada',
          reason: 'Es la única fuente que acredita la fecha de desistimiento del estudiante.',
          suggestedEvidence: 'PDF escaneado de la carta con la firma visible.',
        },
      ],
    });

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.classification).toBeUndefined();
      expect(resultado.data.missingEvidence).toHaveLength(1);
    }
  });

  it('rechaza COMPLETED sin classification', () => {
    const resultado = assessmentSchema.safeParse({
      status: 'COMPLETED',
      summary: 'Dictamen sin clasificar.',
      procedureVersion: 'GDM_GAM_PRD_MLG_003 v5',
    });

    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues.some((item) => item.path[0] === 'classification')).toBe(true);
    }
  });

  it('rechaza NEEDS_INPUT con classification porque no hay dictamen que clasificar', () => {
    const resultado = assessmentSchema.safeParse({
      status: 'NEEDS_INPUT',
      classification: 'BAJA',
      summary: 'Se propone baja sin evidencia suficiente.',
      procedureVersion: 'GDM_GAM_PRD_MLG_003 v5',
      missingEvidence: [
        {
          description: 'Resolución de baja',
          reason: 'No consta en la evidencia aportada.',
          suggestedEvidence: 'Resolución firmada por la coordinación académica.',
        },
      ],
    });

    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      const issue = resultado.error.issues.find((item) => item.path[0] === 'classification');
      expect(issue?.message).toContain('NEEDS_INPUT no puede llevar classification');
    }
  });

  it('rechaza por strict() un resultado INDETERMINADO que llega como campo extra', () => {
    const resultado = assessmentSchema.safeParse({
      status: 'COMPLETED',
      classification: 'DICTAMINACION',
      summary: 'El modelo devolvió un veredicto que el contrato no admite.',
      procedureVersion: 'GDM_GAM_PRD_MLG_003 v5',
      result: 'INDETERMINADO',
    });

    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      const issue = resultado.error.issues.find((item) => item.code === 'unrecognized_keys');
      expect(issue?.keys).toContain('result');
    }
  });

  it('acota la longitud de los textos y fija la versión del prompt', () => {
    const resultado = assessmentSchema.safeParse({
      status: 'COMPLETED',
      classification: 'BAJA',
      summary: 'x'.repeat(4001),
      procedureVersion: 'GDM_GAM_PRD_MLG_003 v5',
    });

    expect(resultado.success).toBe(false);
    expect(ASSESSMENT_PROMPT_VERSION).toBe('analyst-assessment-v1');
  });
});
