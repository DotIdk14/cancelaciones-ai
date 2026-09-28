import { describe, expect, it } from 'vitest';
import { fetchAudioTranscript } from './audio';
import type { AudioProvider, AudioUtterance, AudioWord } from './ports';

const UTTERANCE: AudioUtterance = { startMs: 0, endMs: 1200, speaker: 'A', text: 'Buenos dias' };
const WORD: AudioWord = { startMs: 0, endMs: 500, text: 'Buenos', confidence: 0.98, speaker: 'A' };

type StatusResult = Awaited<ReturnType<AudioProvider['status']>>;

/** Reloj falso: avanza solo lo que el test decide, así que ningún test duerme. */
function fakeClock(steps: number[]): { now: () => number; sleeps: number[]; sleep: (ms: number) => Promise<void> } {
  let current = 1_000;
  let cursor = 0;
  const sleeps: number[] = [];
  return {
    now: () => {
      if (cursor < steps.length) current = steps[cursor] ?? current;
      cursor += 1;
      return current;
    },
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      current += ms;
    },
  };
}

/** Proveedor que devuelve una secuencia de estados y cuenta cuántas veces se le llamó. */
function scriptedProvider(sequence: StatusResult[]): { provider: AudioProvider; calls: () => number } {
  let calls = 0;
  return {
    provider: {
      async submit() {
        return { assemblyId: 'unused' };
      },
      async status() {
        const result = sequence[Math.min(calls, sequence.length - 1)];
        calls += 1;
        return result as StatusResult;
      },
    },
    calls: () => calls,
  };
}

const COMPLETED: StatusResult = { status: 'completed', text: 'Buenos dias', utterances: [UTTERANCE], words: [WORD] };

describe('fetchAudioTranscript', () => {
  it('devuelve la transcripción en el primer intento sin esperar nada', async () => {
    const scripted = scriptedProvider([COMPLETED]);
    const clock = fakeClock([1_000]);

    const transcript = await fetchAudioTranscript({
      assemblyId: 'asm_1',
      provider: scripted.provider,
      maxAttempts: 5,
      intervalMs: 1_000,
      timeoutMs: 60_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(transcript).toEqual({
      text: 'Buenos dias',
      utterances: [UTTERANCE],
      words: [WORD],
      assemblyId: 'asm_1',
    });
    expect(scripted.calls()).toBe(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('insiste mientras el trabajo está en cola y devuelve la transcripción en el cuarto intento', async () => {
    const scripted = scriptedProvider([
      { status: 'queued' },
      { status: 'processing' },
      { status: 'queued' },
      COMPLETED,
    ]);
    const clock = fakeClock([1_000]);

    const transcript = await fetchAudioTranscript({
      assemblyId: 'asm_2',
      provider: scripted.provider,
      maxAttempts: 5,
      intervalMs: 2_000,
      timeoutMs: 60_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(transcript.text).toBe('Buenos dias');
    expect(scripted.calls()).toBe(4);
    expect(clock.sleeps).toEqual([2_000, 2_000, 2_000]);
  });

  it('abandona tras exactamente maxAttempts consultas si el trabajo nunca avanza', async () => {
    const scripted = scriptedProvider([{ status: 'queued' }]);
    const clock = fakeClock([1_000]);

    await expect(
      fetchAudioTranscript({
        assemblyId: 'asm_3',
        provider: scripted.provider,
        maxAttempts: 4,
        intervalMs: 1_000,
        timeoutMs: 600_000,
        now: clock.now,
        sleep: clock.sleep,
      }),
    ).rejects.toThrow('ASSEMBLY_POLL_EXHAUSTED');

    expect(scripted.calls()).toBe(4);
  });

  it('corta por deadline antes de agotar los intentos cuando el reloj se pasa', async () => {
    const scripted = scriptedProvider([{ status: 'processing' }]);
    // El primer now() arranca en 1_000; al pedir la espera del intento 2 el reloj
    // ya está fuera de deadline, así que ni siquiera consulta la segunda vez.
    let calls = 0;
    const provider: AudioProvider = {
      async submit() {
        return { assemblyId: 'asm_4' };
      },
      async status() {
        calls += 1;
        return { status: 'processing' };
      },
    };
    const clock = fakeClock([1_000, 400_000]);

    await expect(
      fetchAudioTranscript({
        assemblyId: 'asm_4',
        provider,
        maxAttempts: 10,
        intervalMs: 1_000,
        timeoutMs: 90_000,
        now: clock.now,
        sleep: clock.sleep,
      }),
    ).rejects.toThrow('ASSEMBLY_POLL_TIMEOUT');

    expect(calls).toBe(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('propaga el motivo del proveedor cuando la transcripción falla', async () => {
    const scripted = scriptedProvider([{ status: 'error', error: 'audio corrupto en el segmento 2' }]);
    const clock = fakeClock([1_000]);

    await expect(
      fetchAudioTranscript({
        assemblyId: 'asm_5',
        provider: scripted.provider,
        maxAttempts: 3,
        intervalMs: 1_000,
        timeoutMs: 60_000,
        now: clock.now,
        sleep: clock.sleep,
      }),
    ).rejects.toThrow('ASSEMBLY_TRANSCRIPTION_FAILED: audio corrupto en el segmento 2');

    expect(scripted.calls()).toBe(1);
  });

  it('respeta la señal de aborto y deja de llamar al proveedor', async () => {
    const scripted = scriptedProvider([{ status: 'queued' }]);
    const clock = fakeClock([1_000]);
    const controller = new AbortController();

    const polling = fetchAudioTranscript({
      assemblyId: 'asm_6',
      provider: scripted.provider,
      maxAttempts: 8,
      intervalMs: 1_000,
      timeoutMs: 600_000,
      now: clock.now,
      sleep: async () => {
        // El aborto ocurre durante la espera, que es cuando un job se cancela de verdad.
        controller.abort();
      },
      signal: controller.signal,
    });

    await expect(polling).rejects.toThrow('AUDIO_ABORTED');
    expect(scripted.calls()).toBe(1);
  });

  it('con maxAttempts 1 hace una sola consulta y se rinde', async () => {
    const scripted = scriptedProvider([{ status: 'processing' }]);
    const clock = fakeClock([1_000]);

    await expect(
      fetchAudioTranscript({
        assemblyId: 'asm_7',
        provider: scripted.provider,
        maxAttempts: 1,
        intervalMs: 1_000,
        timeoutMs: 60_000,
        now: clock.now,
        sleep: clock.sleep,
      }),
    ).rejects.toThrow('ASSEMBLY_POLL_EXHAUSTED');

    expect(scripted.calls()).toBe(1);
    expect(clock.sleeps).toEqual([]);
  });

  it('acorta la espera al resto del deadline en vez de pasarse', async () => {
    const scripted = scriptedProvider([{ status: 'queued' }, COMPLETED]);
    let current = 1_000;
    const sleeps: number[] = [];

    const transcript = await fetchAudioTranscript({
      assemblyId: 'asm_8',
      provider: scripted.provider,
      maxAttempts: 3,
      intervalMs: 30_000,
      timeoutMs: 5_000,
      now: () => current,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        current += ms;
      },
    });

    expect(transcript.text).toBe('Buenos dias');
    // Quedan 5_000 ms de deadline y el intervalo pedido eran 30_000: se espera el resto.
    expect(sleeps).toEqual([5_000]);
  });
});
