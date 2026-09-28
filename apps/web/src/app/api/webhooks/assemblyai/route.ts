import { NextRequest, NextResponse } from 'next/server';
import { AssemblyAIProvider } from '@cancelaciones/ai';
import { createEvidenceRepository, createJobRepository } from '@cancelaciones/db';
import { sha256Hex } from '@cancelaciones/shared';
import { getAiEnv } from '@/server/config/env';
import { createInsForgeAdminClient } from '@/server/insforge/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function webhookSecret(request: NextRequest): string | null {
  return request.headers.get('x-assemblyai-webhook-secret')
    ?? request.headers.get('x-webhook-secret')
    ?? request.nextUrl.searchParams.get('secret');
}

export async function POST(request: NextRequest) {
  const env = getAiEnv();
  if (env.ASSEMBLYAI_WEBHOOK_SECRET && webhookSecret(request) !== env.ASSEMBLYAI_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const client = createInsForgeAdminClient();
  if (!client) return NextResponse.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503 });

  const body = asRecord(await request.json().catch(() => ({})));
  const assemblyId = String(body.transcript_id ?? body.id ?? body.assemblyId ?? '');
  if (!assemblyId) return NextResponse.json({ error: 'ASSEMBLY_ID_MISSING' }, { status: 400 });

  const jobs = createJobRepository(client.database);
  const artifacts = await jobs.listArtifacts();
  const existingTranscript = artifacts.find((artifact) => artifact.artifactType === 'audio-transcript' && asRecord(artifact.result).assemblyId === assemblyId);
  if (existingTranscript) return NextResponse.json({ ok: true, duplicate: true });

  const requestArtifact = artifacts.find((artifact) => {
    const result = asRecord(artifact.result);
    const audio = asRecord(result.audio);
    return audio.assemblyId === assemblyId || result.assemblyId === assemblyId;
  });
  const evidenceId = requestArtifact?.evidenceId ?? String(body.evidenceId ?? '');
  if (!requestArtifact || !evidenceId) return NextResponse.json({ error: 'TRANSCRIPTION_NOT_TRACKED' }, { status: 404 });

  let text = typeof body.text === 'string' ? body.text : '';
  let transcript: Record<string, unknown> = { text, utterances: body.utterances, words: body.words };
  if (!text) {
    if (!env.ASSEMBLYAI_API_KEY) return NextResponse.json({ error: 'ASSEMBLYAI_API_KEY_MISSING' }, { status: 503 });
    const provider = new AssemblyAIProvider({ apiKey: env.ASSEMBLYAI_API_KEY ?? '' });
    transcript = await provider.fetchAudioTranscript(assemblyId);
    text = String(transcript.text ?? '');
  }

  await jobs.recordArtifact(requestArtifact.jobId, 'audio-transcript', { status: 'READY', assemblyId, ...transcript }, { evidenceId, contentSha256: sha256Hex(text), extractorVersion: 'assemblyai-v1', provider: 'assemblyai' });
  await createEvidenceRepository(client.database).markContentStatus(evidenceId, 'READY', null);
  return NextResponse.json({ ok: true });
}
