import type { AudioProvider } from '@cancelaciones/evidence';

type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class AssemblyAIProvider implements AudioProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: FetchImpl;
  private readonly webhookUrl?: string;
  private readonly webhookSecret?: string;

  constructor(config: { apiKey: string; fetchImpl?: FetchImpl; webhookUrl?: string; webhookSecret?: string }) {
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.webhookUrl = config.webhookUrl;
    this.webhookSecret = config.webhookSecret;
  }

  async submit(audio: Uint8Array, options: { speakerLabels: boolean; languageCode: string }): Promise<{ assemblyId: string }> {
    const audioBody = new ArrayBuffer(audio.byteLength);
    new Uint8Array(audioBody).set(audio);
    const upload = await this.fetchImpl('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { authorization: this.apiKey },
      body: audioBody,
    });
    if (!upload.ok) throw new Error(`ASSEMBLYAI_UPLOAD_${upload.status}`);
    const uploadBody = await upload.json() as { upload_url?: string };
    const transcript = await this.fetchImpl('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: { authorization: this.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        audio_url: uploadBody.upload_url,
        speaker_labels: options.speakerLabels,
        language_code: options.languageCode,
        ...(this.webhookUrl ? { webhook_url: this.webhookUrl } : {}),
        ...(this.webhookSecret ? { webhook_auth_header_name: 'x-assemblyai-signature', webhook_auth_header_value: this.webhookSecret } : {}),
      }),
    });
    if (!transcript.ok) throw new Error(`ASSEMBLYAI_TRANSCRIPT_${transcript.status}`);
    const body = await transcript.json() as { id?: string };
    if (!body.id) throw new Error('ASSEMBLYAI_MISSING_ID');
    return { assemblyId: body.id };
  }

  async status(assemblyId: string): Promise<Awaited<ReturnType<AudioProvider['status']>>> {
    const response = await this.fetchImpl(`https://api.assemblyai.com/v2/transcript/${encodeURIComponent(assemblyId)}`, {
      headers: { authorization: this.apiKey },
    });
    if (!response.ok) throw new Error(`ASSEMBLYAI_STATUS_${response.status}`);
    const body = await response.json() as { status?: string; text?: string; utterances?: unknown[]; words?: unknown[]; error?: string };
    if (body.status === 'completed') return { status: 'completed', text: body.text, utterances: body.utterances as never, words: body.words as never };
    if (body.status === 'error') return { status: 'error', error: body.error ?? 'AssemblyAI error' };
    if (body.status === 'processing') return { status: 'processing' };
    return { status: 'queued' };
  }

  async fetchAudioTranscript(assemblyId: string): Promise<{ text: string; utterances?: unknown[]; words?: unknown[] }> {
    const current = await this.status(assemblyId);
    if (current.status === 'completed') return { text: current.text ?? '', utterances: current.utterances, words: current.words };
    if (current.status === 'error') throw new Error(`ASSEMBLY_TRANSCRIPTION_FAILED:${current.error ?? 'AssemblyAI error'}`);
    throw new Error(`ASSEMBLY_TRANSCRIPTION_NOT_READY:${current.status}`);
  }
}
