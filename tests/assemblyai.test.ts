import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitTranscription } from '../src/server/assemblyai';
import { resetEnvCache } from '../src/server/env';
import { setTestEnv } from './helpers/env';

describe('AssemblyAI upload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetEnvCache();
  });

  it('propaga el error JSON del upload para diagnosticar credenciales inválidas', async () => {
    setTestEnv();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Authentication error, API token missing/invalid' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(submitTranscription(Buffer.from('audio'))).rejects.toMatchObject({
      status: 502,
      category: 'TRANSCRIPTION_ERROR',
      message: 'AssemblyAI upload falló (HTTP 401): Authentication error, API token missing/invalid',
    });
  });

  it('propaga el error de texto plano del upload', async () => {
    setTestEnv();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Upload failed, please try again', {
        status: 422,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    await expect(submitTranscription(Buffer.from('audio'))).rejects.toMatchObject({
      message: 'AssemblyAI upload falló (HTTP 422): Upload failed, please try again',
    });
  });

  it('crea el transcript con el schema vigente de AssemblyAI', async () => {
    setTestEnv();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ upload_url: 'https://cdn.assemblyai.com/upload/audio-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'transcript-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    await expect(submitTranscription(Buffer.from('audio'))).resolves.toBe('transcript-1');

    const transcriptInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const body = JSON.parse(String(transcriptInit.body)) as Record<string, unknown>;
    expect(body).toEqual({
      audio_url: 'https://cdn.assemblyai.com/upload/audio-1',
      speaker_labels: true,
      language_detection: true,
    });
    expect(body).not.toHaveProperty('utterances');
  });
});
