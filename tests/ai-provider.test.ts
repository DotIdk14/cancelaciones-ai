import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectAiProvider } from '../src/server/ai/provider';
import { setTestEnv } from './helpers/env';
import { resetEnvCache } from '../src/server/env';

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
  it('usa OpenRouter aunque una consulta de saldo devolveria cero', async () => {
    auto(); vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({data:{limit_remaining:0}})));
    expect(await selectAiProvider()).toBe('openrouter'); expect(fetch).not.toHaveBeenCalled();
  });
  it('usa OpenRouter aunque el servicio de saldo este caido', async () => {
    auto(); vi.mocked(fetch).mockRejectedValue(new Error('unavailable'));
    expect(await selectAiProvider()).toBe('openrouter'); expect(fetch).not.toHaveBeenCalled();
  });
  it('no exige configurar Copilot para utilizar OpenRouter en auto', async () => {
    auto(); vi.stubEnv('COPILOT_GITHUB_TOKEN',''); resetEnvCache();
    expect(await selectAiProvider()).toBe('openrouter'); expect(fetch).not.toHaveBeenCalled();
  });
  it('conserva el modo explicito de Copilot para diagnosticos', async () => {
    auto(); vi.stubEnv('AI_PROVIDER_MODE','github-copilot'); resetEnvCache();
    expect(await selectAiProvider()).toBe('github-copilot'); expect(fetch).not.toHaveBeenCalled();
  });
});
