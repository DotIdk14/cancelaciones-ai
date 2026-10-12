import { submitTranscription } from './assemblyai.js';
import { ApiError } from './errors.js';
import { updateEvidenceStatus, type EvidenceRow } from './cases.js';
import type { InsForgeClient } from './insforge.js';
import { randomUUID } from 'node:crypto';

/** El fallo técnico queda asociado al mismo original y es recuperable. */
export async function prepareAudio(client: InsForgeClient, evidence: EvidenceRow, buffer: Buffer, reference?: string): Promise<EvidenceRow> {
  try {
    const assemblyId = await submitTranscription(buffer);
    return await updateEvidenceStatus(client, evidence.id, {
      processing_status: 'TRANSCRIBING', transcript_json: { assemblyId, status: 'TRANSCRIBING' },
    });
  } catch (error) {
    const correlationId = reference ?? randomUUID();
    await import('./incidents.js').then(({ recordSanitizedError }) => recordSanitizedError(client, {
      correlation_id: correlationId, source: 'ASYNC', category: 'TRANSCRIPTION_ERROR',
      module: 'Expedientes', route: '/api/cases/:id/evidence',
    })).catch(() => undefined);
    const message = error instanceof ApiError ? error.message : 'No se pudo iniciar la transcripción';
    return updateEvidenceStatus(client, evidence.id, {
      processing_status: 'ERROR', transcript_json: { status: 'ERROR', error: message, correlationId },
    });
  }
}
