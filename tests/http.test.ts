import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  mapProviderError,
  readJsonBody,
  requiredString,
  sendError,
  sendBinary,
  type ApiRequest,
  type ApiResponse,
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

/**
 * "Falta una migración" NO es un error del cliente.
 *
 * Sin esto, un despliegue incompleto produce un 400 VALIDATION_ERROR cuyo mensaje
 * habla de la fecha que escribió la persona. El operador corregiría algo que no
 * está mal, y el 400 invites a reintentar. Es un 503 DATABASE_ERROR porque lo que
 * falta es aplicar una migración: reintentar no lo arregla, hay que desplegar.
 *
 * Se cubren los DOS caminos porque el código es la vía fiable y el patrón de
 * mensaje el que no depende de que el SDK pueble `err.code` — y que nadie ha
 * verificado contra la base real. Si el SDK no trae `code`, sin el patrón el
 * mensaje crudo de PostgREST llegaría al operador atribuyendo el fallo a su fecha.
 */
describe('mapProviderError · columna inexistente', () => {
  it.each([
    ['SQLSTATE 42703', { statusCode: 400, code: '42703', message: 'column cases.cycle_start_date does not exist' }],
    ['PostgREST PGRST204', { statusCode: 400, code: 'PGRST204', message: 'Could not find the column' }],
    [
      'sin code, por el mensaje de PostgREST',
      { statusCode: 400, message: `Could not find the 'cycle_start_date' column of 'cases' in the schema cache` },
    ],
    [
      'sin code, comillas dobles',
      { statusCode: 400, message: `Could not find the "cases.cycle_start_date" column` },
    ],
  ])('%s → 503 DATABASE_ERROR', (_label, raw) => {
    const error = mapProviderError(raw);

    expect(error.status).toBe(503);
    expect(error.category).toBe('DATABASE_ERROR');
    // El mensaje dice qué hacer (desplegar), no qué revisar (la fecha).
    expect(error.message).toContain('migración');
  });

  it('el respaldo por patrón NO convierte en 503 los 400 que son del cliente', () => {
    // Este es el riesgo del patrón: si fuera laxo, estos errores —que SÍ son
    // culpa de quien llama— pasarían a decir "falta una migración" y a
    // desacreditar la fecha de la persona.
    for (const raw of [
      { statusCode: 400, message: 'invalid input syntax for type date: "21/08/2026"' },
      { statusCode: 400, message: 'violates check constraint "cases_canal_ck"' },
      { statusCode: 400, message: 'duplicate key value violates unique constraint "app_memberships_pkey"' },
      { statusCode: 400, message: 'Body mal formado' },
      { statusCode: 400, code: 'INVALID', message: 'bad token Authorization=Bearer xyz123' },
    ]) {
      const error = mapProviderError(raw);

      expect(error.status).toBe(400);
      expect(error.category).toBe('VALIDATION_ERROR');
    }
  });

  it('un 400 sin mensaje ni código sigue siendo VALIDATION_ERROR, no un 503', () => {
    const error = mapProviderError({ statusCode: 400 });

    expect(error.status).toBe(400);
    expect(error.category).toBe('VALIDATION_ERROR');
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

describe('sendError', () => {
  it('no registra el mensaje de una excepción no controlada y responde genérico', () => {
    const res = makeApiResponse();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      sendError(res as unknown as ApiResponse, new Error('token=secret-value datos privados'));
      expect(log).toHaveBeenCalledWith('[api] error no controlado:', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret-value');
      expect(res.statusCode).toBe(500);
      expect(res.body.toString()).not.toContain('datos privados');
    } finally {
      log.mockRestore();
    }
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
  return fake as unknown as ApiResponse;
}
