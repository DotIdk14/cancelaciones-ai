import { describe, expect, it } from 'vitest';
import {
  ApiError,
  mapProviderError,
  readJsonBody,
  requiredString,
  sendBinary,
  type ApiRequest,
} from '../src/server/http';

describe('validación de inputs (rutas críticas)', () => {
  it('requiredString rechaza parámetros ausentes o no string', () => {
    expect(() => requiredString({}, 'caseId')).toThrow(ApiError);
    expect(() => requiredString({ caseId: undefined }, 'caseId')).toThrow(/caseId/);
    expect(() => requiredString({ caseId: [] }, 'caseId')).toThrow(ApiError);
    expect(requiredString({ caseId: 'a-1' }, 'caseId')).toBe('a-1');
    const caught = catches(() => requiredString({}, 'caseId'));
    expect(caught).toBeInstanceOf(ApiError);
    if (caught instanceof ApiError) {
      expect(caught.status).toBe(400);
      expect(caught.category).toBe('VALIDATION_ERROR');
    }
  });

  it('readJsonBody rechaza JSON inválido', async () => {
    const req = rawRequest('{no soy json');
    await expect(readJsonBody(req)).rejects.toMatchObject({ status: 400 });
  });

  it('readJsonBody devuelve cuerpo pre-parsado (Vercel) sin re-leer', async () => {
    const req = { body: { email: 'a@b.co' } } as ApiRequest;
    await expect(readJsonBody(req)).resolves.toEqual({ email: 'a@b.co' });
  });

  it('mapProviderError traduce PGRST116 a 404 NOT_FOUND', () => {
    const error = mapProviderError({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
    expect(error.status).toBe(404);
    expect(error.category).toBe('NOT_FOUND');
  });

  it('mapProviderError no filtra api keys en mensajes', () => {
    const error = mapProviderError({ statusCode: 400, code: 'INVALID', message: 'bad token Authorization=Bearer xyz123' });
    expect(error.message).not.toContain('xyz123');
  });
});

describe('sendBinary', () => {
  it('emite headers defensivos y Content-Disposition con fallback ASCII', () => {
    const res = makeApiResponse();
    sendBinary(res, Buffer.from('binario'), 'application/pdf', { inline: false, filename: 'dictamen final ñ.pdf' });

    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['X-Frame-Options']).toBe('DENY');
    expect(res.headers['Referrer-Policy']).toBe('no-referrer');
    expect(res.headers['Content-Security-Policy']).toContain("default-src 'none'");
    expect(res.headers['Content-Disposition']).toContain('attachment; filename="dictamen final _.pdf"');
    expect(res.headers['Content-Disposition']).toContain("filename*=UTF-8''dictamen%20final%20%C3%B1.pdf");
  });
});

function catches(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

function rawRequest(body: string): ApiRequest {
  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: undefined,
    [Symbol.asyncIterator]() {
      const chunks = [Buffer.from(body, 'utf-8')];
      let index = 0;
      return {
        next: async () => (index < chunks.length ? { value: chunks[index++], done: false } : { value: undefined, done: true }),
      };
    },
  } as unknown as ApiRequest;
  return req;
}

function makeApiResponse() {
  const fake = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: Buffer.alloc(0),
    setHeader: (name: string, value: unknown) => {
      fake.headers[name] = String(value);
    },
    appendHeader: (name: string, value: unknown) => {
      fake.headers[name] = String(value);
    },
    end: (chunk?: unknown) => {
      fake.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ''));
    },
  };
  return fake as any;
}
