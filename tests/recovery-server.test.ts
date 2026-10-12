import { describe, expect, it } from 'vitest';
import { createCase, claimEvidencePreparationRetry } from '../src/server/cases';
import { sendBinary, idempotencyKey, type ApiRequest, type ApiResponse } from '../src/server/http';
import { safeRoute } from '../src/server/incidents';
import { createFakeDatabase } from './helpers/fake-database';
import { computeEvidenceFingerprint } from '../src/server/audit-fingerprint';
const key = '00000000-0000-4000-8000-000000000111';

describe('recuperación de solicitudes persistidas', () => {
  it('repetir la creación con la misma identidad devuelve una fila', async () => {
    const db = createFakeDatabase();
    const first = await createCase(db.client, 'M-1', 'Nombre sintético', 'owner', key);
    const replay = await createCase(db.client, 'M-1', 'Nombre sintético', 'owner', key);
    expect(first.id).toBe(key);
    expect(replay.id).toBe(first.id);
    expect(db.rows('cases')).toHaveLength(1);
  });
  it('una identidad ajena da 404 y un payload distinto da 409', async () => {
    const db = createFakeDatabase();
    await createCase(db.client, 'M-1', 'Nombre sintético', 'owner', key);
    await expect(createCase(db.client, 'M-1', 'Nombre sintético', 'other', key)).rejects.toMatchObject({ status: 404 });
    await expect(createCase(db.client, 'M-2', 'Nombre sintético', 'owner', key)).rejects.toMatchObject({ status: 409 });
    expect(db.rows('cases')).toHaveLength(1);
  });
  it('rechaza identidades no UUID antes del efecto', () => {
    expect(() => idempotencyKey({ headers: { 'x-idempotency-key': 'bad' } } as ApiRequest)).toThrow();
  });
});

describe('lectura parcial para navegación del audio', () => {
  it.each([['bytes=2-4', 206, '234'], ['bytes=7-', 206, '789'], ['bytes=-3', 206, '789'], ['bytes=20-', 416, ''], ['bytes=0-1,3-4', 416, '']])('%s', (range, status, expected) => {
    const headers: Record<string, unknown> = {};
    let body: unknown;
    const res = { statusCode: 0, setHeader: (key: string, value: unknown) => { headers[key] = value; }, end: (value?: unknown) => { body = value; } } as ApiResponse;
    sendBinary(res, Buffer.from('0123456789'), 'audio/mpeg', { inline: true, filename: 'llamada.mp3', range });
    expect(res.statusCode).toBe(status);
    expect(Buffer.isBuffer(body) ? body.toString() : '').toBe(expected);
    expect(headers['Accept-Ranges']).toBe('bytes');
    expect(headers['Content-Range']).toBeTruthy();
  });
});

describe('contexto vigente y diagnóstico saneado', () => {
  it('solo los comentarios inyectados cambian la huella', () => {
    const base = computeEvidenceFingerprint([]);
    expect(computeEvidenceFingerprint([], null, [{ area: 'FINANCE', comment: 'bitácora' }])).toBe(base);
    const before = computeEvidenceFingerprint([], null, [{ area: 'BACK_OFFICE', comment: 'antes' }]);
    expect(before).not.toBe(base);
    expect(computeEvidenceFingerprint([], null, [{ area: 'BACK_OFFICE', comment: 'después' }])).not.toBe(before);
  });
  it('conserva el módulo y oculta identificadores y query', () => {
    expect(safeRoute(`#/casos/${key}?token=secreto`)).toBe('#/casos/:id');
    expect(safeRoute('/api/cases/:id/audit')).toBe('/api/cases/:id/audit');
    expect(safeRoute('https://externo.invalid/?token=secreto')).toBe('#/');
  });
});


it('la reclamación de preparación es condicional y tiene un solo ganador', async () => {
  const db = createFakeDatabase();
  db.seed('evidence', { id: key, processing_status: 'ERROR' });
  const first = await claimEvidencePreparationRetry(db.client, key);
  const second = await claimEvidencePreparationRetry(db.client, key);
  expect(first?.processing_status).toBe('UPLOADED');
  expect(second).toBeNull();
  expect(db.rows('evidence')).toHaveLength(1);
});
