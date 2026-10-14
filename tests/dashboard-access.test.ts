import { describe, expect, it, vi } from 'vitest';
import { fakeAuthContext } from './helpers/auth';
import { ApiError } from '../src/server/errors';
vi.mock('../src/server/http', () => ({
  handleRoute: (handler: unknown) => handler,
  ok: (res: { body: unknown }, body: unknown) => { res.body = body; },
  ApiError,
  methodNotAllowed: vi.fn(), readJsonBody: vi.fn(), json: vi.fn(),
}));
vi.mock('../src/server/insforge', () => ({ createServerClient: () => ({}) }));
vi.mock('../src/server/dashboard-queries', () => ({
  getDashboardSummary: vi.fn(async () => ({ kpi: { auditedCases: 3 }, cost: { totalCostUsd: 7 }, activity: { tokens: 99 } })),
  getAiCosts: vi.fn(async () => ({ realReport: true })), getAiQuality: vi.fn(), getDashboardFilterOptions: vi.fn(),
}));
import handler from '../api/dashboard/[view]';
import type { ApiRequest, ApiResponse } from '../src/server/http';

describe('consumo administrativo en la frontera HTTP', () => {
  it.each(['user', 'coordinator'] as const)('el Resumen no entrega costo ni actividad a %s', async role => {
    const res = { body: null };
    await handler({ method: 'GET', query: { view: 'summary', from: '2026-10-01', to: '2026-10-31' }, auth: fakeAuthContext(role) } as ApiRequest, res as unknown as ApiResponse);
    expect(res.body).toEqual({ summary: { kpi: { auditedCases: 3 } } });
  });
  it('el Gerente conserva acceso al informe de costos', async () => {
    const res = { body: null };
    await handler({ method: 'GET', query: { view: 'ai-costs', from: '2026-10-01', to: '2026-10-31' }, auth: fakeAuthContext('manager') } as ApiRequest, res as unknown as ApiResponse);
    expect(res.body).toEqual({ costs: { realReport: true } });
  });
});
