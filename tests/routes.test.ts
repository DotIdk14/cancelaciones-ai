import { describe, expect, it } from 'vitest';
import type { ApiRequest, ApiResponse } from '../src/server/http';
import auditHandler from '../api/cases/[caseId]/audit/index';
import evidenceDeleteHandler from '../api/cases/[caseId]/evidence/[evidenceId]/index';

/** Fake de ServerResponse: res ES el objeto observable (statusCode compartido). */
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

function makeApiRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    url: '/',
    headers: {},
    query: {},
    ...overrides,
  } as unknown as ApiRequest;
}

describe('rutas críticas (validación de método)', () => {
  it('PATCH /audit → 405 (sin crear cliente ni ejecutar la auditoría)', async () => {
    const res = makeApiResponse();
    const req = makeApiRequest({ method: 'PATCH' });

    await auditHandler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET, POST');
  });

  it('GET /evidence → 405', async () => {
    const res = makeApiResponse();
    const req = makeApiRequest({ method: 'GET', query: { caseId: 'c', evidenceId: 'e' } });

    await evidenceDeleteHandler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('DELETE');
  });
});
