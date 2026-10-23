import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { callOpenRouterAudit as rawCall, OpenRouterAuditError } from '../src/server/openrouter';
import { callCopilotAudit } from '../src/server/ai/copilot';
import { readCopilotModels } from '../src/server/ai/copilot-capabilities';
import { withAiProvider, prepareCopilotProvider, currentAiProvider } from '../src/server/ai/provider';
import { setTestEnv } from './helpers/env';
import { resetEnvCache } from '../src/server/env';

vi.mock('../src/server/ai/copilot', () => ({ callCopilotAudit: vi.fn() }));
vi.mock('../src/server/ai/copilot-capabilities', async original => ({
  ...await original<typeof import('../src/server/ai/copilot-capabilities')>(), readCopilotModels: vi.fn(),
}));
vi.mock('../src/server/ai/model-capabilities', () => ({
  getModelCapabilities: vi.fn(async () => ({ supportsImages: true, supportsFiles: true, supportsStructuredOutput: true,
    supportsJsonObject: true, safeOutputLimit: 16384, schemaProfile: 'gemini', catalogVerified: true, retryFallbackSuitable: true })),
  resolveOutputTokenBudget: vi.fn(() => 16384),
}));
function callOpenRouterAudit(input: Parameters<typeof rawCall>[0]) {
  return currentAiProvider() ? rawCall(input) : withAiProvider('openrouter', () => rawCall(input), undefined,
    () => prepareCopilotProvider([], input.deadlineMs ?? Date.now() + 10000));
}
const request = () => ({ system: 'Prueba sintética', parts: [{ type: 'text' as const, text: 'Sin PII' }],
  schema: z.object({ ok: z.boolean() }).strict(), maxAttempts: 1 as const, deadlineMs: Date.now() + 10000 });
const response = (status: number, limit_source?: string) => new Response(JSON.stringify(status === 200
  ? { choices: [{ message: { content: '{"ok":true}' } }], model: 'or-model' }
  : { error: { code: status, message: 'Error sintético', metadata: limit_source ? { limit_source } : {} } }), { status });

beforeEach(() => {
  vi.clearAllMocks(); setTestEnv(); vi.stubEnv('AI_PROVIDER_MODE', 'auto'); vi.stubEnv('COPILOT_GITHUB_TOKEN', 'test-token');
  vi.stubEnv('COPILOT_MODEL', 'copilot-proposal'); vi.stubEnv('COPILOT_REVIEW_MODEL', 'copilot-review'); resetEnvCache();
  vi.stubGlobal('fetch', vi.fn());
  vi.mocked(readCopilotModels).mockResolvedValue(['copilot-proposal', 'copilot-review'].map(id => ({ id, capabilities: { supports: { vision: true }, limits: { vision: { max_prompt_images: 5, max_prompt_image_size: 3145728, supported_media_types: ['image/png','application/pdf'] } } } })) as never);
  vi.mocked(callCopilotAudit).mockResolvedValue({ provider: 'github-copilot', parsed: { ok: true }, model: 'copilot-model',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, estimatedCostUSD: null }, attempts: [] });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetEnvCache(); });

describe('respaldo exclusivamente por créditos agotados', () => {
  it('conserva OpenRouter con una respuesta válida y no consulta saldo ni Copilot', async () => {
    vi.mocked(fetch).mockResolvedValue(response(200));
    expect((await callOpenRouterAudit(request())).model).toBe('or-model');
    expect(fetch).toHaveBeenCalledOnce(); expect(readCopilotModels).not.toHaveBeenCalled(); expect(callCopilotAudit).not.toHaveBeenCalled();
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain('/chat/completions');
  });
  it.each([undefined, 'openrouter_credits', 'openrouter_key_limit'])('activa respaldo tras HTTP 402 de créditos: %s', async source => {
    vi.mocked(fetch).mockResolvedValue(response(402, source));
    const result = await callOpenRouterAudit(request());
    expect(result.provider).toBe('github-copilot'); expect(fetch).toHaveBeenCalledOnce(); expect(callCopilotAudit).toHaveBeenCalledOnce();
    expect(result.attempts).toEqual([expect.objectContaining({ status: 402, creditExhausted: true })]);
  });
  it.each([400, 401, 403, 429, 500, 503])('no cambia a Copilot por HTTP %s', async status => {
    vi.mocked(fetch).mockResolvedValue(response(status));
    await expect(callOpenRouterAudit(request())).rejects.toBeInstanceOf(OpenRouterAuditError);
    expect(callCopilotAudit).not.toHaveBeenCalled(); expect(readCopilotModels).not.toHaveBeenCalled();
  });
  it.each(['openrouter_in_flight_budget', 'openrouter_guardrail_budget', 'unknown'])('no confunde %s con saldo agotado', async source => {
    vi.mocked(fetch).mockResolvedValue(response(402, source));
    await expect(callOpenRouterAudit(request())).rejects.toMatchObject({ category: 'PAYMENT_REQUIRED' });
    expect(callCopilotAudit).not.toHaveBeenCalled();
  });
  it('si falla el contraste por créditos conserva la propuesta y cambia solo la etapa pendiente', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(200)).mockResolvedValueOnce(response(402));
    const prepare = vi.fn(() => prepareCopilotProvider([], Date.now() + 10000));
    await withAiProvider('openrouter', async () => {
      await callOpenRouterAudit(request());
      await callOpenRouterAudit({ ...request(), provider: 'openrouter', schemaName: 'AuditSemanticReview' });
      expect(currentAiProvider()).toBe('github-copilot');
    }, undefined, prepare);
    expect(fetch).toHaveBeenCalledTimes(2); expect(callCopilotAudit).toHaveBeenCalledOnce(); expect(prepare).toHaveBeenCalledOnce();
    expect(vi.mocked(callCopilotAudit).mock.calls[0]![0].schemaName).toBe('AuditSemanticReview');
  });
  it('si se agotan en propuesta mantiene Copilot en contraste y vuelve a OpenRouter en el siguiente expediente', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(402)).mockResolvedValueOnce(response(200));
    await withAiProvider('openrouter', async () => {
      await callOpenRouterAudit(request());
      await callOpenRouterAudit({ ...request(), provider: 'openrouter', schemaName: 'AuditSemanticReview' });
    }, undefined, () => prepareCopilotProvider([], Date.now() + 10000));
    expect(callCopilotAudit).toHaveBeenCalledTimes(2); expect(fetch).toHaveBeenCalledOnce();
    await withAiProvider('openrouter', () => callOpenRouterAudit(request()));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('no reintenta Copilot cuando falla ni pierde el diagnóstico de créditos', async () => {
    vi.mocked(fetch).mockResolvedValue(response(402));
    vi.mocked(callCopilotAudit).mockRejectedValueOnce(new OpenRouterAuditError('INVALID_JSON', [], 'JSON inválido'));
    await expect(callOpenRouterAudit(request())).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ status: 402 })] });
    expect(fetch).toHaveBeenCalledOnce(); expect(callCopilotAudit).toHaveBeenCalledOnce();
  });
  it('no activa respaldo por red, timeout o salida invalida', async () => {
    for (const value of [new Error('network'), new DOMException('aborted', 'AbortError')]) {
      vi.mocked(fetch).mockRejectedValueOnce(value);
      await expect(callOpenRouterAudit(request())).rejects.toBeInstanceOf(OpenRouterAuditError);
    }
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'no-json' } }] })));
    await expect(callOpenRouterAudit(request())).rejects.toBeInstanceOf(OpenRouterAuditError);
    expect(callCopilotAudit).not.toHaveBeenCalled();
  });
  it('una evaluacion directa sigue midiendo OpenRouter y no cambia al modelo de respaldo', async () => {
    vi.mocked(fetch).mockResolvedValue(response(402));
    await expect(rawCall(request())).rejects.toMatchObject({ category: 'PAYMENT_REQUIRED' });
    expect(callCopilotAudit).not.toHaveBeenCalled();
  });
  it('una comparacion textual usa el mismo respaldo por creditos y su proveedor real', async () => {
    vi.mocked(fetch).mockResolvedValue(response(402));
    expect((await rawCall({ ...request(), schemaName: 'CaseComparison' })).provider).toBe('github-copilot');
    expect(callCopilotAudit).toHaveBeenCalledOnce();
  });
  it('no infiere en Copilot si falla la persistencia del cambio', async () => {
    vi.mocked(fetch).mockResolvedValue(response(402));
    const persist = vi.fn().mockRejectedValue(new Error('durable-write-failed'));
    await expect(withAiProvider('openrouter', () => rawCall(request()), undefined, persist)).rejects.toThrow('durable-write-failed');
    expect(callCopilotAudit).not.toHaveBeenCalled();
  });
  it('el modo exclusivo de OpenRouter no cambia de proveedor', async () => {
    vi.stubEnv('AI_PROVIDER_MODE', 'openrouter'); resetEnvCache(); vi.mocked(fetch).mockResolvedValue(response(402));
    await expect(callOpenRouterAudit(request())).rejects.toMatchObject({ category: 'PAYMENT_REQUIRED' });
    expect(callCopilotAudit).not.toHaveBeenCalled();
  });
});
