import { describe, expect, it } from 'vitest';
import type { ApiRequest, ApiResponse } from '../src/server/http';
import auditHandler from '../api/cases/[caseId]/audit/index';
import evidenceDeleteHandler from '../api/cases/[caseId]/evidence/[evidenceId]/index';
import dashboardSummaryHandler from '../api/dashboard/summary';
import dashboardAiCostsHandler from '../api/dashboard/ai-costs';
import dashboardQualityHandler from '../api/dashboard/quality';

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

  it('PATCH /dashboard/summary → 405 sin parsear filtros ni tocar la base', async () => {
    const res = makeApiResponse();
    // Query deliberadamente inválida: el 405 debe resolverse ANTES de parsear
    // los filtros, para que un método incorrecto nunca llegue a la base.
    const req = makeApiRequest({ method: 'PATCH', query: { from: 'basura' } });

    await dashboardSummaryHandler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
  });

  it('PATCH /dashboard/ai-costs → 405 sin parsear filtros ni tocar la base', async () => {
    const res = makeApiResponse();
    const req = makeApiRequest({ method: 'PATCH', query: { from: 'basura', granularity: 'trimestre' } });

    await dashboardAiCostsHandler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
  });

  it('GET /dashboard/ai-costs?granularity=trimestre → 400 en español, sin tocar la base', async () => {
    const res = makeApiResponse();
    // Fechas válidas: el 400 tiene que venir de `granularity`, no del rango.
    const req = makeApiRequest({ method: 'GET', query: { from: '2026-09-01', to: '2026-09-30', granularity: 'trimestre' } });

    await dashboardAiCostsHandler(req, res);

    expect(res.statusCode).toBe(400);
    const payload = JSON.parse(res.body) as { error: { category: string; message: string } };
    expect(payload.error.category).toBe('VALIDATION_ERROR');
    expect(payload.error.message).toContain('granularity');
    expect(payload.error.message).toContain('day, week, month');
  });

  it('GET /dashboard/ai-costs?granularity=trimestre&granularity=day → 400 (valor repetido)', async () => {
    const res = makeApiResponse();
    const req = makeApiRequest({ method: 'GET', query: { granularity: ['trimestre', 'day'] } });

    await dashboardAiCostsHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as { error: { category: string } }).error.category).toBe('VALIDATION_ERROR');
  });

  it('PATCH /dashboard/quality → 405 sin parsear filtros ni tocar la base', async () => {
    const res = makeApiResponse();
    // Query deliberadamente inválida: el 405 tiene que resolverse ANTES de
    // parsear los filtros, igual que en las otras dos rutas de dashboard.
    const req = makeApiRequest({ method: 'PATCH', query: { from: 'basura' } });

    await dashboardQualityHandler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET');
  });

  it('GET /dashboard/quality?from=basura → 400 en español, sin tocar la base', async () => {
    const res = makeApiResponse();
    const req = makeApiRequest({ method: 'GET', query: { from: 'basura' } });

    await dashboardQualityHandler(req, res);

    expect(res.statusCode).toBe(400);
    const payload = JSON.parse(res.body) as { error: { category: string; message: string } };
    expect(payload.error.category).toBe('VALIDATION_ERROR');
    expect(payload.error.message).toContain('from');
  });
});
