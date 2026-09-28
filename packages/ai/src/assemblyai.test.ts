import { describe, expect, test } from 'vitest';
import { AssemblyAIProvider } from './assemblyai';

describe('AssemblyAIProvider', () => {
  test('submit usa upload y transcript create', async () => {
    const urls: string[] = [];
    const provider = new AssemblyAIProvider({ apiKey: 'key', fetchImpl: async (url) => {
      urls.push(String(url));
      if (String(url).endsWith('/upload')) return new Response(JSON.stringify({ upload_url: 'https://audio.local/file' }));
      return new Response(JSON.stringify({ id: 'asm-1' }));
    }});
    await expect(provider.submit(new Uint8Array([1]), { speakerLabels: true, languageCode: 'es' })).resolves.toEqual({ assemblyId: 'asm-1' });
    expect(urls).toEqual(['https://api.assemblyai.com/v2/upload', 'https://api.assemblyai.com/v2/transcript']);
  });

  test('status mapea error', async () => {
    const provider = new AssemblyAIProvider({ apiKey: 'key', fetchImpl: async () => new Response(JSON.stringify({ status: 'error', error: 'bad audio' })) });
    await expect(provider.status('asm-1')).resolves.toEqual({ status: 'error', error: 'bad audio' });
  });
});
