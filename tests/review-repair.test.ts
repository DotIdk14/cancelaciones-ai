import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { callOpenRouterAudit, OpenRouterAuditError } from '../src/server/openrouter';
import { withAiProvider } from '../src/server/ai/provider';
import { ApiError } from '../src/server/errors';
import { setTestEnv } from './helpers/env';
import { annotateReviewReferenceFailure, reviewReferenceDiagnostic } from '../src/server/ai/review-contract';
import { wrapUntrusted } from '../src/skills/sanitize';

vi.mock('../src/server/ai/model-capabilities', () => ({
  getModelCapabilities: vi.fn(async () => ({ supportsImages: true, supportsFiles: true, supportsStructuredOutput: true,
    supportsJsonObject: true, safeOutputLimit: 16384, schemaProfile: 'gemini', catalogVerified: true, retryFallbackSuitable: true })),
  resolveOutputTokenBudget: vi.fn(() => 16384),
}));
const reply = (ok: boolean) => new Response(JSON.stringify({ model: 'same-reviewer',
  choices: [{ message: { content: JSON.stringify({ ok, note: 'PRIVATE_MODEL_CONTENT' }) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0.1 },
}));
const input = () => ({ system: 'Sistema original', schemaName: 'AuditSemanticReview', maxAttempts: 1 as const,
  parts: [{ type: 'text' as const, text: 'Propuesta y originales intactos' }], deadlineMs: Date.now() + 10000,
  schema: z.object({ ok: z.boolean(), note: z.string() }), validate: (raw: unknown) => {
    if (!(raw as { ok: boolean }).ok) {
      const error = new ApiError(502, 'INVALID_AI_RESPONSE', 'Contrato no satisfecho');
      error.failurePath = 'reliabilityReview'; error.sanitizedDetail = 'La cita no pertenece al hecho o a la evidencia real'; throw error;
    }
  },
});
beforeEach(() => { setTestEnv(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('una corrección acotada del contraste productivo', () => {
  it('no consume otra llamada si el primer contraste es válido', async () => {
    vi.mocked(fetch).mockResolvedValue(reply(true));
    await withAiProvider('openrouter', () => callOpenRouterAudit(input()));
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('repara solo la revisión, conserva la propuesta y agrega el uso real de ambas respuestas', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(reply(false)).mockResolvedValueOnce(reply(true));
    const source = input(); const parts = structuredClone(source.parts);
    const result = await withAiProvider('openrouter', () => callOpenRouterAudit(source));
    expect(result.parsed).toMatchObject({ ok: true }); expect(fetch).toHaveBeenCalledTimes(2);
    const bodies = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies[1].model).toBe(bodies[0].model);
    expect(bodies[1].messages[0]).toEqual(bodies[0].messages[0]);
    expect(bodies[1].messages[1].content[0]).toEqual(parts[0]);
    expect(bodies[1].messages[1].content[1].text).toContain('RESPUESTA ANTERIOR RECHAZADA');
    expect(bodies[1].messages[1].content[1].text).toContain('PRIVATE_MODEL_CONTENT');
    expect(source.parts).toEqual(parts);
    expect(result.attempts).toHaveLength(2); expect(result.usage).toEqual({ promptTokens: 20, completionTokens: 40, totalTokens: 60, estimatedCostUSD: 0.2 });
  });
  it('termina tras la corrección fallida sin otra llamada ni publicar el contenido rechazado', async () => {
    vi.mocked(fetch).mockImplementation(async () => reply(false));
    const failure = await withAiProvider('openrouter', () => callOpenRouterAudit(input())).catch(error => error);
    expect(failure).toBeInstanceOf(OpenRouterAuditError); expect(fetch).toHaveBeenCalledTimes(2);
    expect(failure.diagnostics).toHaveLength(2); expect(JSON.stringify(failure)).not.toContain('PRIVATE_MODEL_CONTENT');
  });
  it.each([400, 402, 429, 500])('no gasta la corrección ante HTTP %s', async status => {
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ error: { message: 'error' } }), { status }));
    await expect(withAiProvider('openrouter', () => callOpenRouterAudit(input()))).rejects.toBeInstanceOf(OpenRouterAuditError);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('no añade intentos a propuesta, comparación o evaluación directa', async () => {
    vi.mocked(fetch).mockImplementation(async () => reply(false));
    for (const schemaName of ['AuditResult', 'CaseComparison']) {
      await expect(withAiProvider('openrouter', () => callOpenRouterAudit({ ...input(), schemaName }))).rejects.toBeInstanceOf(OpenRouterAuditError);
    }
    await expect(callOpenRouterAudit(input())).rejects.toBeInstanceOf(OpenRouterAuditError);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('respeta el plazo global antes de intentar corregir', async () => {
    vi.useFakeTimers(); const source = input();
    vi.mocked(fetch).mockImplementation(async () => { vi.setSystemTime(source.deadlineMs - 100); return reply(false); });
    await expect(withAiProvider('openrouter', () => callOpenRouterAudit(source))).rejects.toBeInstanceOf(OpenRouterAuditError);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('ruta concreta de las referencias rechazadas sin PII', () => {
  const fact = { key: 'PRIVATE_FACT_KEY', evidenceIds: ['ev-1'] };
  const parts = [{ type: 'text' as const, text: wrapUntrusted('PROPUESTA A CONTRASTAR — NO ES EVIDENCIA', JSON.stringify({ facts: [fact] })) }];
  const review = () => ({ verdict: 'CONFIRMED', revisedAssessment: null,
    factGrounding: [{ factKey: fact.key, citations: [{ evidenceId: 'ev-1' }, { evidenceId: 'ev-2' }] }] });
  it('identifica la cita ajena al hecho sin registrar nombres, citas ni IDs inventados', () => {
    const raw = review(); const before = structuredClone(raw);
    const detail = reviewReferenceDiagnostic(parts, raw, ['ev-1', 'ev-2']);
    expect(detail?.path).toBe('reliabilityReview.factGrounding[0].citations[1].evidenceId');
    expect(detail?.detail).toContain('no pertenece'); expect(JSON.stringify(detail)).not.toContain(fact.key);
    expect(raw).toEqual(before);
  });
  it('distingue una evidencia inexistente y una cita faltante', () => {
    expect(reviewReferenceDiagnostic(parts, review(), ['ev-1'])?.detail).toContain('inexistente');
    const raw = review(); raw.factGrounding[0]!.citations = [];
    expect(reviewReferenceDiagnostic(parts, raw, ['ev-1'])?.detail).toContain('faltan citas para 1');
  });
  it('usa los hechos corregidos y no los de la propuesta descartada', () => {
    const raw = { ...review(), verdict: 'CORRECTED', revisedAssessment: { facts: [{ ...fact, evidenceIds: ['ev-2'] }] } };
    expect(reviewReferenceDiagnostic([], raw, ['ev-1', 'ev-2'])?.path).toBe('reliabilityReview.factGrounding[0].citations[0].evidenceId');
  });
  it('solo enriquece el error original de referencias, sin alterar otra validación', () => {
    const error = new ApiError(502, 'INVALID_AI_RESPONSE', 'error'); error.failurePath = 'reliabilityReview';
    error.sanitizedDetail = 'La cita no pertenece al hecho o a la evidencia real';
    annotateReviewReferenceFailure({ parts, schemaName: 'AuditSemanticReview', evidenceIds: ['ev-1','ev-2'] }, review(), error);
    expect(error.failurePath).toBe('reliabilityReview.factGrounding[0].citations[1].evidenceId');
    const other = new ApiError(502, 'INVALID_AI_RESPONSE', 'otra causa'); other.failurePath = 'reliabilityReview'; other.sanitizedDetail = 'La cita normativa no existe';
    annotateReviewReferenceFailure({ parts, schemaName: 'AuditSemanticReview' }, review(), other);
    expect(other.failurePath).toBe('reliabilityReview');
    expect(reviewReferenceDiagnostic([], review(), ['ev-1'])).toBeNull();
  });
});
