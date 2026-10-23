import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCopilotModels } from '../src/server/ai/copilot-capabilities';
import { setTestEnv } from './helpers/env';
const fake = vi.hoisted(() => ({ start: vi.fn(), auth: vi.fn(), models: vi.fn(), forceStop: vi.fn() }));
vi.mock('@github/copilot-sdk', () => ({ CopilotClient: class {
  start = fake.start; getAuthStatus = fake.auth; listModels = fake.models; forceStop = fake.forceStop;
} }));
beforeEach(() => {
  setTestEnv(); vi.clearAllMocks(); fake.start.mockResolvedValue(undefined); fake.auth.mockResolvedValue({ isAuthenticated: true });
  fake.models.mockResolvedValue([]); fake.forceStop.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());
describe('catálogo Copilot acotado, sin inferencia', () => {
  it('lee el catálogo y cierra el runtime temporal', async () => {
    expect(await readCopilotModels(Date.now() + 2000)).toEqual([]); expect(fake.forceStop).toHaveBeenCalledOnce();
  });
  it('falla cerrado si no puede autenticarse, sin leer modelos', async () => {
    fake.auth.mockResolvedValue({ isAuthenticated: false });
    await expect(readCopilotModels(Date.now() + 2000)).rejects.toMatchObject({ category: 'PROVIDER_UNAVAILABLE' });
    expect(fake.models).not.toHaveBeenCalled(); expect(fake.forceStop).toHaveBeenCalledOnce();
  });
  it('corta un catálogo que no responde y cierra el runtime', async () => {
    fake.models.mockImplementation(() => new Promise(() => {}));
    await expect(readCopilotModels(Date.now() + 200)).rejects.toMatchObject({ category: 'PROVIDER_UNAVAILABLE' });
    expect(fake.forceStop).toHaveBeenCalledOnce();
  });
});
