// =============================================================================
// Estados de `evidence.processing_status` durante la subida y su efecto en
// `POST /audit`.
//
// Reproduce el bug: una evidencia NO-audio (PDF/PNG/TXT) se insertaba siempre
// como `UPLOADED`, y como `UPLOADED` es un estado "en proceso" del que nadie
// sale (el único que lo promovía a `READY` era el refresco de transcripciones de
// audio), el caso quedaba eternamente en `202 pendingEvidence` y la auditoría
// nunca llegaba al modelo.
// =============================================================================

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest, ApiResponse } from '../src/server/http';
import type { Evidence } from '../src/lib/api';
import { callOpenRouterAudit } from '../src/server/openrouter';
import { resetEnvCache } from '../src/server/env';
import { refreshTranscriptions, runAudit } from '../src/server/audit-service';
import { evidenceToDto } from '../src/server/dto';
import evidenceUploadHandler from '../api/cases/[caseId]/evidence/index';
import evidenceDeleteHandler from '../api/cases/[caseId]/evidence/[evidenceId]/index';
import auditHandler from '../api/cases/[caseId]/audit/index';
import { setTestEnv } from './helpers/env';
import { validAuditResult } from './fixtures/audit-result';
import {
  fakeClient,
  storageLog,
  listEvidence,
  listAudits,
  getCase,
  minimalPdf,
  resetStore,
  seedCase,
  seedEvidence,
  setTranscription,
} from './helpers/fake-store';

// --- Persistencia: store en memoria de `cases`/`evidence`/`audits` -----------
vi.mock('../src/server/cases', async () => {
  const store = await import('./helpers/fake-store');
  return {
    getCaseOr404: store.getCaseOr404,
    getEvidenceOr404: store.getEvidenceOr404,
    listEvidenceRows: store.listEvidenceRows,
    listCaseSummaries: store.listCaseSummaries,
    createCase: store.createCase,
    insertEvidence: store.insertEvidence,
    updateEvidenceStatus: store.updateEvidenceStatus,
    deleteEvidenceRow: store.deleteEvidenceRow,
    latestAudit: store.latestAudit,
    latestCompletedAuditByFingerprint: store.latestCompletedAuditByFingerprint,
    latestRunningAuditByFingerprint: store.latestRunningAuditByFingerprint,
    countAuditsByFingerprint: store.countAuditsByFingerprint,
    insertAudit: store.insertAudit,
    updateAuditResult: store.updateAuditResult,
    updateCaseStatus: store.updateCaseStatus,
  };
});

// --- Cliente server-side de InsForge: store aislado, sin red ----------------
vi.mock('../src/server/insforge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/insforge')>();
  const store = await import('./helpers/fake-store');
  return {
    ...actual,
    createServerClient: vi.fn(() => store.fakeClient),
  };
});

// --- AssemblyAI: sin red; el estado se inyecta por assemblyId ----------------
vi.mock('../src/server/assemblyai', async () => {
  const store = await import('./helpers/fake-store');
  return {
    submitTranscription: vi.fn(async () => 'assembly-1'),
    getTranscription: vi.fn(async (assemblyId: string) => store.getTranscriptionState(assemblyId)),
  };
});

// --- OpenRouter: el modelo responde con un dictamen válido -------------------
vi.mock('../src/server/openrouter', () => ({
  callOpenRouterAudit: vi.fn(),
}));

const mockedCall = vi.mocked(callOpenRouterAudit);
const AUDIO_ASSEMBLY_ID = 'assembly-1';
const readyTranscript = {
  transcript: 'Sí, quiero cancelar mi matrícula.',
  durationSeconds: 12,
  speakers: [{ speaker: 'A', start: 0, end: 4000, text: 'Sí, quiero cancelar mi matrícula.', confidence: 0.95 }],
};

/** Ventana de espera al refrescar transcripciones (ms). */
function setPollWindow(ms: number): void {
  process.env.TRANSCRIPTION_POLL_TIMEOUT_MS = String(ms);
  resetEnvCache();
}

function makeApiResponse(): ApiResponse & { statusCode: number; body: string } {
  const fake = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader: (name: string, value: unknown) => {
      fake.headers[name] = String(value);
    },
    appendHeader: (name: string, value: unknown) => {
      fake.headers[name] = String(value);
    },
    end: (chunk?: unknown) => {
      fake.body =
        typeof chunk === 'string'
          ? chunk
          : chunk instanceof Buffer
            ? chunk.toString('utf-8')
            : '';
    },
  };
  return fake as unknown as ApiResponse & { statusCode: number; body: string };
}

/** Request de subida: cuerpo binario crudo leído con `for await`. */
function makeUploadRequest(
  mime: string,
  filename: string,
  content: string | Buffer,
  caseId = 'case-1',
): ApiRequest {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
  return {
    method: 'POST',
    url: `/api/cases/${caseId}/evidence`,
    headers: { 'content-type': mime, 'x-file-name': encodeURIComponent(filename) },
    query: { caseId },
    async *[Symbol.asyncIterator]() {
      yield buffer;
    },
  } as unknown as ApiRequest;
}

function makePlainRequest(method: string, query: Record<string, string>): ApiRequest {
  return { method, url: '/', headers: {}, query } as unknown as ApiRequest;
}

/** Sube una evidencia y devuelve la fila persistida + el DTO de la respuesta. */
async function upload(
  mime: string,
  filename: string,
  content: string | Buffer,
): Promise<{ row: ReturnType<typeof listEvidence>[number]; dto: Evidence; status: number }> {
  const res = makeApiResponse();
  await evidenceUploadHandler(makeUploadRequest(mime, filename, content), res);
  const row = listEvidence()[listEvidence().length - 1];
  expect(row).toBeDefined();
  return { row: row!, dto: JSON.parse(res.body).evidence as Evidence, status: res.statusCode };
}

beforeEach(() => {
  setTestEnv();
  // Ventana holgada por defecto: el primer poll ya devuelve READY y no hay sleep.
  setPollWindow(2_000);
  resetStore();
  seedCase();
  mockedCall.mockReset();
  mockedCall.mockResolvedValue({
    parsed: validAuditResult,
    model: 'google/gemini-2.5-flash',
    usage: validAuditResult.usage,
  });
});

afterAll(() => {
  delete process.env.TRANSCRIPTION_POLL_TIMEOUT_MS;
  resetEnvCache();
});

describe('evidencia NO-audio: nace en un estado que la auditoría acepta', () => {
  it('subir un PDF responde 201 con processingStatus READY (no queda en UPLOADED)', async () => {
    const { row, dto, status } = await upload('application/pdf', 'renuncia.pdf', minimalPdf('Cancelo mi matricula'));

    expect(status).toBe(201);
    expect(row?.processing_status).toBe('READY');
    expect(dto.processingStatus).toBe('READY');
    // READY significa "el contenido está disponible para el modelo": en un PDF
    // eso es el propio archivo, no una transcripción.
    expect(dto.transcript).toBeNull();
  });

  it('un PDF READY aporta su texto al expediente (el modelo recibe el contenido)', async () => {
    await upload('application/pdf', 'renuncia.pdf', minimalPdf('Cancelo mi matricula del periodo'));

    const outcome = await runAudit(fakeClient, 'case-1');

    expect(outcome.phase).toBe('done');
    const { parts } = mockedCall.mock.calls[0]?.[0] as unknown as {
      parts: Array<{ type: string; text?: string }>;
    };
    const dossier = parts.find((part) => part.type === 'text' && part.text?.includes('## Evidencia: renuncia.pdf'));
    expect(dossier?.text).toContain('Cancelo mi matricula del periodo');
  });

  it.each([
    ['image/png', 'captura.png'],
    ['image/jpeg', 'foto.jpg'],
    ['image/webp', 'captura.webp'],
    ['image/gif', 'animacion.gif'],
    ['text/plain', 'renuncia.txt'],
  ])('subir %s lo deja READY de inmediato', async (mime, filename) => {
    const { row } = await upload(mime, filename, 'contenido de la evidencia');

    expect(row?.processing_status).toBe('READY');
  });

  it('subida guarda la evidencia con path opaco sin filename original', async () => {
    await upload('text/plain', 'renuncia-con-pii.txt', 'contenido de la evidencia');

    expect(storageLog.uploads).toHaveLength(1);
    expect(storageLog.uploads[0]).toMatch(/^case-1\/[0-9a-f-]{36}$/);
    expect(storageLog.uploads[0]).not.toContain('renuncia-con-pii.txt');
  });

  it('delete evidence no loguea storage_path con filename', async () => {
    const row = seedEvidence({ id: 'ev-pii', filename: 'nombre-pii.pdf', storage_path: 'case-1/ev-pii-nombre-pii.pdf' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await evidenceDeleteHandler(makePlainRequest('DELETE', { caseId: row.case_id, evidenceId: row.id }), makeApiResponse());

    expect(spy.mock.calls.flat().join(' ')).not.toContain('nombre-pii.pdf');
    expect(spy.mock.calls.flat().join(' ')).not.toContain(row.storage_path);
    spy.mockRestore();
  });

  it('runAudit con evidencia no-audio lista NO devuelve pendingEvidence: ejecuta el dictamen', async () => {
    await upload('text/plain', 'renuncia.txt', 'Por medio de la presente cancelo mi matricula.');

    const outcome = await runAudit(fakeClient, 'case-1');

    expect(outcome.phase).toBe('done');
    // La evidencia llegó al modelo: el expediente se armó con su contenido.
    expect(mockedCall).toHaveBeenCalledTimes(1);
    const { parts } = mockedCall.mock.calls[0]?.[0] as unknown as {
      parts: Array<{ type: string; text?: string }>;
    };
    const dossier = parts.find((part) => part.type === 'text' && part.text?.includes('## Evidencia: renuncia.txt'));
    expect(dossier?.text).toContain('Por medio de la presente cancelo mi matricula.');
  });

  it('POST /audit responde 200 (nunca 202 pendingEvidence) con un caso de solo no-audio', async () => {
    await upload('text/plain', 'renuncia.txt', 'cancelo mi matricula');
    const res = makeApiResponse();

    await auditHandler(makePlainRequest('POST', { caseId: 'case-1' }), res);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body) as { audit: { status: string }; pendingEvidence?: string[] };
    expect(payload.audit.status).toBe('COMPLETED');
    expect(payload.pendingEvidence).toBeUndefined();
  });

  it('PDF + imagen + audio: el caso completo audita sin quedarse esperando', async () => {
    setTranscription(AUDIO_ASSEMBLY_ID, { state: 'READY', transcript: readyTranscript });
    await upload('application/pdf', 'renuncia.pdf', minimalPdf('Cancelo mi matricula'));
    await upload('image/png', 'captura.png', 'PNG-falso');
    await upload('audio/mpeg', 'llamada.mp3', 'MP3-falso');

    const outcome = await runAudit(fakeClient, 'case-1');

    expect(outcome.phase).toBe('done');
    expect(listEvidence().every((row) => row.processing_status === 'READY')).toBe(true);
  });
});

describe('fingerprint de expediente y ciclo de vida del caso', () => {
  it('reutiliza COMPLETED cuando el fingerprint no cambia', async () => {
    seedEvidence({ id: 'ev-1', processing_status: 'READY', content: 'cancelación' });

    await runAudit(fakeClient, 'case-1');
    await runAudit(fakeClient, 'case-1');

    expect(listAudits()).toHaveLength(1);
    expect(mockedCall).toHaveBeenCalledTimes(1);
  });

  it('crea nueva auditoría cuando cambia la evidencia después de COMPLETED', async () => {
    seedEvidence({ id: 'ev-1', processing_status: 'READY', content: 'cancelación' });
    await runAudit(fakeClient, 'case-1');

    seedEvidence({ id: 'ev-2', processing_status: 'READY', hash: 'b'.repeat(64), content: 'nueva evidencia' });
    await runAudit(fakeClient, 'case-1');

    expect(listAudits()).toHaveLength(2);
    expect(mockedCall).toHaveBeenCalledTimes(2);
  });

  it('upload READY después de COMPLETED reabre el caso a READY', async () => {
    resetStore();
    seedCase({ status: 'COMPLETED' });
    await upload('text/plain', 'nueva.txt', 'nueva evidencia');

    expect(getCase('case-1')?.status).toBe('READY');
  });

  it('delete después de COMPLETED reabre a DRAFT si no quedan evidencias', async () => {
    resetStore();
    seedCase({ status: 'COMPLETED' });
    const evidence = seedEvidence({ id: 'ev-1', processing_status: 'READY' });
    const res = makeApiResponse();

    await evidenceDeleteHandler(makePlainRequest('DELETE', { caseId: 'case-1', evidenceId: evidence.id }), res);

    expect(res.statusCode).toBe(200);
    expect(getCase('case-1')?.status).toBe('DRAFT');
  });
});

describe('el audio conserva su ciclo asíncrono UPLOADED -> TRANSCRIBING -> READY', () => {
  it('subir un audio responde TRANSCRIBING con su assemblyId (nunca READY al instante)', async () => {
    const { row, dto } = await upload('audio/mpeg', 'llamada.mp3', 'MP3-falso');

    expect(row?.processing_status).toBe('TRANSCRIBING');
    expect(dto.processingStatus).toBe('TRANSCRIBING');
    expect(dto.transcript).toBeNull();
    expect((row?.transcript_json as { assemblyId?: string }).assemblyId).toBe(AUDIO_ASSEMBLY_ID);
  });

  it('refreshTranscriptions promueve TRANSCRIBING -> READY con la transcripción', async () => {
    const { row } = await upload('audio/mpeg', 'llamada.mp3', 'MP3-falso');
    expect(row?.processing_status).toBe('TRANSCRIBING');
    setTranscription(AUDIO_ASSEMBLY_ID, { state: 'READY', transcript: readyTranscript });

    await refreshTranscriptions(fakeClient, 'case-1', 2_000);

    const after = listEvidence()[0];
    expect(after?.processing_status).toBe('READY');
    expect((after?.transcript_json as { transcript?: unknown }).transcript).toEqual(readyTranscript);
  });

  it('un audio todavía TRANSCRIBING sí produce 202 pendingEvidence (el pending es legítimo)', async () => {
    setPollWindow(1);
    setTranscription(AUDIO_ASSEMBLY_ID, { state: 'TRANSCRIBING', transcript: null });
    await upload('audio/mpeg', 'llamada.mp3', 'MP3-falso');
    const res = makeApiResponse();

    await auditHandler(makePlainRequest('POST', { caseId: 'case-1' }), res);

    expect(res.statusCode).toBe(202);
    const payload = JSON.parse(res.body) as { audit: null; pendingEvidence: string[] };
    expect(payload.audit).toBeNull();
    expect(payload.pendingEvidence).toHaveLength(1);
    // El 202 nunca crea una fila de auditoría: la espera es real, no un dictamen.
    expect(mockedCall).not.toHaveBeenCalled();
  });

  it('un audio en ERROR bloquea la auditoría con 400 TRANSCRIPTION_ERROR', async () => {
    setPollWindow(1);
    setTranscription(AUDIO_ASSEMBLY_ID, { state: 'ERROR', transcript: null, error: 'audio corrupto' });
    await upload('audio/mpeg', 'llamada.mp3', 'MP3-falso');
    const res = makeApiResponse();

    await auditHandler(makePlainRequest('POST', { caseId: 'case-1' }), res);

    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as { error: { category: string } }).error.category).toBe('TRANSCRIPTION_ERROR');
    const evidence = listEvidence()[0];
    expect(evidenceToDto(evidence!).processingError).toBe('audio corrupto');
  });
});

describe('invariante: ninguna evidencia nascenta deja el caso en "en proceso" eterno', () => {
  it.each([
    ['application/pdf', 'renuncia.pdf', minimalPdf('Cancelo mi matricula')],
    ['image/png', 'captura.png', 'PNG-falso'],
    ['text/plain', 'renuncia.txt', 'cancelo mi matricula'],
    ['audio/mpeg', 'llamada.mp3', 'MP3-falso'],
  ])('subir %s y auditar nunca devuelve phase pending', async (mime, filename, content) => {
    setTranscription(AUDIO_ASSEMBLY_ID, { state: 'READY', transcript: readyTranscript });
    await upload(mime, filename, content);

    const outcome = await runAudit(fakeClient, 'case-1');

    expect(outcome.phase).not.toBe('pending');
    expect(outcome.phase).toBe('done');
  });
});
