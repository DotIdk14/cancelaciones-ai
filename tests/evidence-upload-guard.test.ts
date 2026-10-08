// =============================================================================
// REGRESIONES del endpoint de carga de evidencia (orden de las validaciones).
//
// Lo que se fija aquí NO es "qué se valida" (eso está en
// `integrity-untrusted.test.ts`) sino CUÁNDO: ninguna petición inválida puede
// llegar a tocar Storage, la base de datos ni el proveedor de transcripción.
//
//   - tipo no permitido / buffer vacío / tamaño excedido → nada sube.
//   - firma que no corresponde al tipo declarado → 415 y NADIE sube.
//   - audio con cuota denegada → 429 y NADIE sube ni se inserta fila.
// =============================================================================

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ApiRequest, ApiResponse } from '../src/server/http';
import { ApiError } from '../src/server/http';
import { setTestEnv } from './helpers/env';
import { fakeAuthContext, FAKE_USER_SUB } from './helpers/auth';
import uploadHandler from '../api/cases/[caseId]/evidence/index';

const CASE_ID = '11111111-1111-4111-8111-111111111111';

const uploadSpy = vi.fn(async () => ({ data: { key: `${CASE_ID}/objeto` }, error: null }));
const removeSpy = vi.fn(async () => ({ data: null, error: null }));
const insertEvidence = vi.fn(async (_client: unknown, row: Record<string, unknown>) => ({
  id: 'ev-1',
  ...row,
}));
const updateEvidenceStatus = vi.fn(async (_client: unknown, id: string, patch: Record<string, unknown>) => ({
  id,
  processing_status: patch.processing_status,
  transcript_json: patch.transcript_json ?? null,
}));
const updateCaseStatus = vi.fn(async () => undefined);
const checkPaidQuota = vi.fn(async () => undefined);
const submitTranscription = vi.fn(async () => 'assembly-1');

vi.mock('../src/server/insforge', () => ({
  createServerClient: () => ({
    database: { from: () => ({ select: () => ({}), eq: () => ({}) }) },
    storage: { from: () => ({ upload: uploadSpy, remove: removeSpy }) },
  }),
}));

vi.mock('../src/server/cases', async () => {
  const actual = await vi.importActual<typeof import('../src/server/cases')>('../src/server/cases');
  return {
    ...actual,
    getScopedCaseOr404: vi.fn(async () => ({ id: CASE_ID, created_by: FAKE_USER_SUB })),
    assertCaseOwner: vi.fn(() => undefined),
    insertEvidence: (...args: [unknown, Record<string, unknown>]) => insertEvidence(...args),
    updateEvidenceStatus: (...args: [unknown, string, Record<string, unknown>]) =>
      updateEvidenceStatus(...(args as [])),
    updateCaseStatus: (...args: unknown[]) => updateCaseStatus(...(args as [])),
  };
});

vi.mock('../src/server/quotas', () => ({
  checkPaidQuota: (...args: [string, string]) => checkPaidQuota(...args),
  checkLoginEmailQuota: vi.fn(async () => undefined),
  checkLoginIpQuota: vi.fn(async () => undefined),
  hashQuotaSubject: (value: string) => `hash:${value}`,
}));

vi.mock('../src/server/assemblyai', () => ({
  submitTranscription: (...args: [Buffer]) => submitTranscription(...args),
  getTranscription: vi.fn(async () => null),
}));

function makeApiResponse(): ApiResponse & { statusCode: number; headers: Record<string, string>; body: string } {
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
        typeof chunk === 'string' ? chunk : chunk instanceof Buffer ? chunk.toString('utf-8') : '';
    },
  };
  return fake as unknown as ApiResponse & { statusCode: number; headers: Record<string, string>; body: string };
}

const PDF = Buffer.from('%PDF-1.7\ncontenido\n%%EOF');
const EXE = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.from('MZ payload')]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.from('\u0003\u0000'), Buffer.from('audio')]);
const ISO_BMFF = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x00]), Buffer.from('ftypM4A '), Buffer.from('resto')]);

async function upload(buffer: Buffer, contentType: string, fileName = 'evidencia.pdf') {
  const res = makeApiResponse();
  const req = {
    method: 'POST',
    url: '/api/cases/x/evidence',
    headers: {
      'content-type': contentType,
      'x-file-name': encodeURIComponent(fileName),
      origin: 'http://localhost:5173',
      'x-app-request': '1',
    },
    query: { caseId: CASE_ID },
    body: buffer,
    auth: fakeAuthContext('user'),
  } as unknown as ApiRequest;
  await uploadHandler(req, res);
  return res;
}

beforeEach(() => {
  setTestEnv();
  uploadSpy.mockClear();
  removeSpy.mockClear();
  insertEvidence.mockClear();
  updateEvidenceStatus.mockClear();
  checkPaidQuota.mockClear();
  submitTranscription.mockClear();
});

describe('carga · validaciones que impiden tocar Storage', () => {
  it('415 y nada subido cuando la firma no corresponde al tipo declarado', async () => {
    const res = await upload(EXE, 'image/png', 'captura.png');

    expect(res.statusCode).toBe(415);
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(insertEvidence).not.toHaveBeenCalled();
    expect(submitTranscription).not.toHaveBeenCalled();
  });

  it('ISO-BMFF declarado image/png se rechaza con 415 y no se cobra cuota de transcripcion', async () => {
    const res = await upload(ISO_BMFF, 'image/png', 'video-renombrado.png');

    expect(res.statusCode).toBe(415);
    expect(checkPaidQuota).not.toHaveBeenCalled();
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(insertEvidence).not.toHaveBeenCalled();
    expect(submitTranscription).not.toHaveBeenCalled();
  });

  it('415 incluye mensaje accionable sobre contenido/extensión inconsistente', async () => {
    const res = await upload(EXE, 'image/png', 'captura.png');

    expect(res.statusCode).toBe(415);
    const body = JSON.parse(res.body);
    expect(body.error.category).toBe('UPLOAD_ERROR');
    expect(body.error.message).toMatch(/contenido|extensión|tipo declarado/i);
    expect(body.error.message).toMatch(/coincida|dañado|corrupto/i);
  });

  it('400 y nada subido con un tipo no permitido', async () => {
    const res = await upload(Buffer.from('#!/bin/sh\nrm -rf /'), 'application/x-sh', 'guion.sh');

    expect(res.statusCode).toBe(400);
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(insertEvidence).not.toHaveBeenCalled();
  });

  it('400 y nada subido con un cuerpo vacío', async () => {
    const res = await upload(Buffer.alloc(0), 'application/pdf');

    expect(res.statusCode).toBe(400);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it('413 y nada subido cuando excede el límite por evidencia', async () => {
    // El límite por defecto es 4 MiB (MAX_EVIDENCE_BYTES); el control de tamaño
    // corre ANTES de la firma, así que un payload enorme ni siquiera se inspecciona.
    const oversized = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(5 * 1024 * 1024, 0x41)]);
    const res = await upload(oversized, 'application/pdf');

    expect(res.statusCode).toBe(413);
    expect(uploadSpy).not.toHaveBeenCalled();
  });
});

describe('carga · audio: la cuota se cobra antes de subir y de insertar', () => {
  it('un PDF válido sube, se inserta y nace READY', async () => {
    const res = await upload(PDF, 'application/pdf', 'solicitud.pdf');

    expect(res.statusCode).toBe(201);
    expect(checkPaidQuota).not.toHaveBeenCalled();
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(insertEvidence).toHaveBeenCalledTimes(1);
    expect(insertEvidence.mock.calls[0]?.[1]?.processing_status).toBe('READY');
    expect(updateCaseStatus).toHaveBeenCalledWith(expect.anything(), CASE_ID, 'READY');
  });

  it('un audio válido cobra cuota con el hash del contenido y luego transcribe', async () => {
    const res = await upload(MP3, 'audio/mpeg', 'llamada.mp3');

    expect(res.statusCode).toBe(201);
    expect(checkPaidQuota).toHaveBeenCalledTimes(1);
    expect(checkPaidQuota.mock.calls[0]?.[0]).toBe(FAKE_USER_SUB);
    expect(String(checkPaidQuota.mock.calls[0]?.[1])).toContain(`transcription:${CASE_ID}:`);
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(submitTranscription).toHaveBeenCalledTimes(1);
    // Nace UPLOADED y pasa a TRANSCRIBING al confirmarse el envío.
    expect(insertEvidence.mock.calls[0]?.[1]?.processing_status).toBe('UPLOADED');
    expect(updateEvidenceStatus).toHaveBeenCalledWith(
      expect.anything(),
      'ev-1',
      expect.objectContaining({ processing_status: 'TRANSCRIBING' }),
    );
  });

  it('cuota denegada en audio → 429 sin subir bytes ni dejar evidencia a medias', async () => {
    checkPaidQuota.mockRejectedValueOnce(
      new ApiError(429, 'RATE_LIMIT', 'Se alcanzó el límite de auditorías pagadas; espera antes de reintentar.'),
    );
    const res = await upload(MP3, 'audio/mpeg', 'llamada.mp3');

    expect(res.statusCode).toBe(429);
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(insertEvidence).not.toHaveBeenCalled();
    expect(submitTranscription).not.toHaveBeenCalled();
  });

  it('si la transcripción falla, la evidencia queda en ERROR (no UPLOADED eterno)', async () => {
    submitTranscription.mockRejectedValueOnce(new Error('AssemblyAI caido'));

    const res = await upload(MP3, 'audio/mpeg', 'llamada.mp3');

    // La evidencia se registra igual y el usuario ve el estado real.
    expect(res.statusCode).toBe(201);
    expect(updateEvidenceStatus).toHaveBeenCalledWith(
      expect.anything(),
      'ev-1',
      expect.objectContaining({
        processing_status: 'ERROR',
        transcript_json: expect.objectContaining({ status: 'ERROR' }),
      }),
    );
    // Con el caso en DRAFT porque no hay evidencia lista todavía.
    expect(updateCaseStatus).toHaveBeenCalledWith(expect.anything(), CASE_ID, 'DRAFT');
  });
});