// =============================================================================
// Contratos del módulo de revisión humana: vocabulario cerrado, esquema Zod
// `strict` de la comparación y validación del comentario humano.
// =============================================================================
//
// La comparación NO es un segundo dictamen: es un juicio sobre si el dictamen
// original coincide con la decisión humana. Por eso el schema no tiene campo
// `result`: la resolución final del caso es la de la persona.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { AUDIT_RESULTS } from '../src/skills/audit/types';
import { buildProviderJsonSchema } from '../src/server/ai/provider-schema';
import {
  HUMAN_RESOLUTIONS,
  REVIEW_COMMENT_MAX,
  REVIEW_COMMENT_MIN,
} from '../src/skills/review/types';
import {
  ComparisonResultSchema,
  HumanReviewInputSchema,
  parseComparisonOutcome,
  parseComparisonResult,
} from '../src/skills/review/schema';

/** Comparación válida de referencia. */
const validComparison = {
  agrees: false,
  explanation:
    'El dictamen original aplicó la baja por solicitud posterior al inicio, pero la persona responsable accreditation contacto efectivo previo.',
  confidence: 0.78,
  discrepancyReason: 'Falta acreditar el supuesto de contacto efectivo exigido por la sección 5.8.',
  procedureSections: ['5.8', '5.3'],
  evidenceIds: ['ev-1'],
};

describe('vocabulario de la resolución humana', () => {
  it('deriva HUMAN_RESOLUTIONS de AUDIT_RESULTS: la persona elige en el mismo vocabulario cerrado', () => {
    expect([...HUMAN_RESOLUTIONS]).toEqual([...AUDIT_RESULTS]);
    // Alias, no copia: no puede existir una lista humana que se desvíe del Skill.
    expect(HUMAN_RESOLUTIONS).toBe(AUDIT_RESULTS);
  });

  it('el comentario humano tiene límites declarados', () => {
    expect(REVIEW_COMMENT_MIN).toBe(0);
    expect(REVIEW_COMMENT_MAX).toBe(2000);
  });
});

describe('ComparisonResultSchema', () => {
  it('acepta la comparación de referencia sin transformarla', () => {
    const parsed = parseComparisonResult(validComparison);
    expect(parsed).toEqual(validComparison);
  });

  it('rechaza campos extra (strict): el modelo no puede inventar un segundo dictamen', () => {
    const result = ComparisonResultSchema.safeParse({
      ...validComparison,
      result: 'BAJA',
    });
    expect(result.success).toBe(false);
  });

  it.each([1.0001, -0.0001, 42, Number.NaN])('rechaza confidence fuera de [0,1]: %s', (confidence) => {
    const result = ComparisonResultSchema.safeParse({ ...validComparison, confidence });
    expect(result.success).toBe(false);
  });

  it('rechaza explanation vacía', () => {
    expect(ComparisonResultSchema.safeParse({ ...validComparison, explanation: '' }).success).toBe(false);
    expect(ComparisonResultSchema.safeParse({ ...validComparison, explanation: '   ' }).success).toBe(false);
  });

  it('exige discrepancyReason cuando agrees === false', () => {
    expect(ComparisonResultSchema.safeParse({ ...validComparison, discrepancyReason: null }).success).toBe(false);
    expect(ComparisonResultSchema.safeParse({ ...validComparison, discrepancyReason: '  ' }).success).toBe(false);
  });

  it('exige discrepancyReason === null cuando agrees === true', () => {
    const result = ComparisonResultSchema.safeParse({ ...validComparison, agrees: true });
    expect(result.success).toBe(false);
  });

  it('TRACE_EVERY_DECISION: exige al menos una sección del procedimiento y una evidencia', () => {
    expect(ComparisonResultSchema.safeParse({ ...validComparison, procedureSections: [] }).success).toBe(false);
    expect(ComparisonResultSchema.safeParse({ ...validComparison, evidenceIds: [] }).success).toBe(false);
    expect(ComparisonResultSchema.safeParse({ ...validComparison, evidenceIds: [''] }).success).toBe(false);
  });

  it('parseComparisonResult traduce el fallo del modelo a ApiError 502 INVALID_AI_RESPONSE', () => {
    expect(() => parseComparisonResult({ ...validComparison, confidence: 3 })).toThrowError(
      expect.objectContaining({ status: 502, category: 'INVALID_AI_RESPONSE' }),
    );
  });

  it('el contrato que ve el proveedor conserva los 6 campos pese al superRefine', () => {
    // `buildProviderJsonSchema` serializa el schema Zod; si el `.superRefine()`
    // de la coherencia se comiera la forma del objeto, el structured output
    // sería un `{}` inútil y el proveedor devolvería texto libre.
    const providerSchema = buildProviderJsonSchema(ComparisonResultSchema, 'openai') as {
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    expect(Object.keys(providerSchema.properties ?? {}).sort()).toEqual([
      'agrees',
      'confidence',
      'discrepancyReason',
      'evidenceIds',
      'explanation',
      'procedureSections',
    ]);
    expect(providerSchema.additionalProperties).toBe(false);
  });

  it('el outcome persistido añade metadata real de OpenRouter sin cambiar el veredicto', () => {
    const outcome = parseComparisonOutcome({
      ...validComparison,
      model: { provider: 'openrouter', model: 'google/gemini-2.5-flash-lite' },
      usage: { promptTokens: 900, completionTokens: 120, totalTokens: 1020, estimatedCostUSD: 0.0002 },
    });
    expect(outcome.agrees).toBe(false);
    expect(outcome.procedureSections).toEqual(['5.8', '5.3']);
    expect(outcome.model.model).toBe('google/gemini-2.5-flash-lite');
    expect(outcome.usage.estimatedCostUSD).toBe(0.0002);
  });
});

describe('HumanReviewInputSchema', () => {
  const valid = {
    result: 'BAJA' as const,
    reviewerName: 'Revisora de pruebas',
    comment: 'Se acredita la baja por solicitud posterior al inicio de ciclo.',
  };

  it('acepta la revisión de referencia', () => {
    expect(HumanReviewInputSchema.parse(valid)).toEqual(valid);
  });

  it('permite notas vacías porque son opcionales', () => {
    expect(HumanReviewInputSchema.parse({ ...valid, comment: '' }).comment).toBe('');
    expect(HumanReviewInputSchema.parse({ ...valid, comment: '    ' }).comment).toBe('');
  });

  it('exige identificar a la persona revisora', () => {
    expect(HumanReviewInputSchema.safeParse({ ...valid, reviewerName: '' }).success).toBe(false);
    expect(HumanReviewInputSchema.safeParse({ ...valid, reviewerName: '    ' }).success).toBe(false);
    expect(HumanReviewInputSchema.safeParse({ ...valid, reviewerName: 'R'.repeat(121) }).success).toBe(false);
  });

  it('rechaza comentario por encima del máximo', () => {
    expect(HumanReviewInputSchema.safeParse({ ...valid, comment: 'a'.repeat(REVIEW_COMMENT_MAX + 1) }).success).toBe(false);
  });

  it('acepta el comentario vacío y el tamaño máximo', () => {
    expect(HumanReviewInputSchema.safeParse({ ...valid, comment: 'a'.repeat(REVIEW_COMMENT_MIN) }).success).toBe(true);
    expect(HumanReviewInputSchema.safeParse({ ...valid, comment: 'a'.repeat(REVIEW_COMMENT_MAX) }).success).toBe(true);
  });

  it('rechaza una resolución fuera del vocabulario cerrado', () => {
    const result = HumanReviewInputSchema.safeParse({ ...valid, result: 'RESULTADO_INVENTADO' });
    expect(result.success).toBe(false);
  });

  it('rechaza campos extra en el body de la revisión', () => {
    expect(HumanReviewInputSchema.safeParse({ ...valid, auditId: 'audit-1' }).success).toBe(false);
  });
});