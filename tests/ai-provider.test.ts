import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectAiProvider } from '../src/server/ai/provider';
import { setTestEnv } from './helpers/env';
import { resetEnvCache } from '../src/server/env';

const response = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
beforeEach(() => { setTestEnv(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetEnvCache(); });
function auto() {
  vi.stubEnv('AI_PROVIDER_MODE', 'auto'); vi.stubEnv('COPILOT_GITHUB_TOKEN', 'synthetic-copilot-token');
  vi.stubEnv('COPILOT_MODEL', 'synthetic-vision'); vi.stubEnv('COPILOT_REVIEW_MODEL', 'synthetic-review'); resetEnvCache();
}
describe('selección de proveedor antes de gastar intentos', () => {
  it('conserva OpenRouter sin nuevas consultas si el respaldo está desactivado', async () => {
    expect(await selectAiProvider()).toBe('openrouter'); expect(fetch).not.toHaveBeenCalled();
  });
  it('distingue el límite de la clave del saldo real de la cuenta', async () => {
    auto(); vi.mocked(fetch).mockResolvedValueOnce(response({limit_remaining: 10})).mockResolvedValueOnce(response({total_credits: 5,total_usage: 4.9}));
    expect(await selectAiProvider()).toBe('github-copilot'); expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes('chat/completions'))).toBe(true);
  });
  it('conserva OpenRouter con saldo suficiente y clave sin límite', async () => {
    auto(); vi.mocked(fetch).mockResolvedValueOnce(response({limit_remaining: null})).mockResolvedValueOnce(response({total_credits: 10,total_usage: 1}));
    expect(await selectAiProvider()).toBe('openrouter');
  });
  it('usa el respaldo autorizado ante información de presupuesto no comprobable', async () => {
    auto(); vi.mocked(fetch).mockResolvedValueOnce(response({})).mockResolvedValueOnce(response({}));
    expect(await selectAiProvider()).toBe('github-copilot');
  });
  it('no intenta llamadas pagadas ni relaja configuración si falta autorización de Copilot', async () => {
    auto(); vi.stubEnv('COPILOT_GITHUB_TOKEN',''); resetEnvCache();
    await expect(selectAiProvider()).rejects.toThrow('credenciales'); expect(fetch).not.toHaveBeenCalled();
  });
});
