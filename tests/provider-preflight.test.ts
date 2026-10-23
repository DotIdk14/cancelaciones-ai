import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from '@github/copilot-sdk';
import type { EvidenceInputItem } from '../src/skills/audit/types';
import { preflightAiProvider, selectAiProvider, visualEvidenceParts, withAiProvider } from '../src/server/ai/provider';
import { readCopilotModels } from '../src/server/ai/copilot-capabilities';
import { resetEnvCache } from '../src/server/env';
import { setTestEnv } from './helpers/env';

vi.mock('../src/server/ai/copilot-capabilities', async original => ({
  ...await original<typeof import('../src/server/ai/copilot-capabilities')>(), readCopilotModels: vi.fn(),
}));
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8qkAAAAASUVORK5CYII=';
function evidences(count: number): EvidenceInputItem[] {
  return Array.from({ length: count }, (_, index) => ({ evidenceId: `ev-${index}`, filename: 'sintetica.png',
    mimeType: 'image/png', kind: 'IMAGE', imageBase64: image, sizeBytes: 9, sha256: 'synthetic', createdAt: '2026-10-23T00:00:00Z' }));
}
function model(id: string, limit: number): ModelInfo {
  return { id, capabilities: { supports: { vision: true }, limits: { vision: {
    max_prompt_images: limit, max_prompt_image_size: 1000000, supported_media_types: ['image/png', 'application/pdf'],
  } } } } as ModelInfo;
}
beforeEach(() => {
  setTestEnv(); vi.stubEnv('AI_PROVIDER_MODE', 'github-copilot'); vi.stubEnv('COPILOT_GITHUB_TOKEN', 'synthetic-token');
  vi.stubEnv('COPILOT_MODEL', 'proposal'); vi.stubEnv('COPILOT_REVIEW_MODEL', 'review'); resetEnvCache();
  vi.mocked(readCopilotModels).mockReset().mockResolvedValue([model('proposal', 5), model('review', 5)]);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); resetEnvCache(); });

describe('preflight técnico del expediente completo', () => {
  it('prepara las doce imagenes completas en un solo PDF antes de inferir', async () => {
    const source = evidences(12);
    const prepared = await preflightAiProvider(source, Date.now() + 5000);
    expect(prepared.provider).toBe('github-copilot');
    expect(prepared.bundle?.manifest.pages.map(page => page.evidenceId)).toEqual(source.map(e => e.evidenceId));
    expect(prepared.bundle?.sources).toHaveLength(12);
    expect(source).toHaveLength(12); expect(fetch).not.toHaveBeenCalled();
  });
  it('ajusta el contenedor tambien al limite inferior del revisor', async () => {
    vi.mocked(readCopilotModels).mockResolvedValue([model('proposal', 5), model('review', 1)]);
    const prepared = await preflightAiProvider(evidences(2), Date.now() + 5000);
    expect(prepared.bundle?.manifest.pages).toHaveLength(2);
  });
  it('rechaza un revisor deshabilitado sin intentar sustituir el modelo', async () => {
    vi.mocked(readCopilotModels).mockResolvedValue([model('proposal', 5)]);
    await expect(preflightAiProvider(evidences(1), Date.now() + 1000)).rejects.toMatchObject({ category: 'UNSUPPORTED_MODEL_CAPABILITY' });
  });
  it('admite ambas etapas compatibles y consulta el catálogo una vez', async () => {
    expect(await preflightAiProvider(evidences(5), Date.now() + 1000)).toEqual({ provider: 'github-copilot' });
    expect(readCopilotModels).toHaveBeenCalledOnce();
  });
  it('en auto no envía a OpenRouter el expediente cuando el respaldo admite el contenedor', async () => {
    vi.stubEnv('AI_PROVIDER_MODE', 'auto'); resetEnvCache();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { limit_remaining: 0, total_credits: 0, total_usage: 0 } })));
    const prepared = await preflightAiProvider(evidences(12), Date.now() + 5000);
    expect(prepared.bundle?.manifest.pages).toHaveLength(12);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes('chat/completions'))).toBe(true);
  });
  it('conserva imágenes, páginas y PDF como adjuntos separados', () => {
    const source = evidences(1);
    source[0]!.pagesBase64 = [image];
    source.push({ ...source[0]!, kind: 'PDF', imageBase64: undefined, pagesBase64: undefined,
      mimeType: 'application/pdf', filename: 'sintetico.pdf', pdfBase64: 'cGRm' });
    expect(visualEvidenceParts(source).map(part => part.type)).toEqual(['image_url', 'image_url', 'file']);
  });
  it('fija el proveedor por ejecución sin contaminar solicitudes concurrentes ni consultar saldo otra vez', async () => {
    const values = await Promise.all([
      withAiProvider('openrouter', async () => { await Promise.resolve(); return await selectAiProvider(); }),
      withAiProvider('github-copilot', async () => { await Promise.resolve(); return await selectAiProvider(); }),
    ]);
    expect(values).toEqual(['openrouter', 'github-copilot']); expect(fetch).not.toHaveBeenCalled();
  });
});
