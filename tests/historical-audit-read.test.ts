import { beforeEach, expect, it, vi } from 'vitest';
import caseHandler from '../api/cases/[caseId]/index';
import type { ApiRequest, ApiResponse } from '../src/server/http';
import { createServerClient } from '../src/server/insforge';
import { createFakeDatabase } from './helpers/fake-database';
import { fakeAuthContext, FAKE_USER_SUB } from './helpers/auth';
import { setTestEnv } from './helpers/env';
import { validAuditResult } from './fixtures/audit-result';
vi.mock('../src/server/insforge', async (original) => ({ ...await original<typeof import('../src/server/insforge')>(), createServerClient: vi.fn() }));
const db = createFakeDatabase();
const caseId = '11111111-1111-4111-8111-111111111111';
const auditId = '22222222-2222-4222-8222-222222222222';
beforeEach(() => { setTestEnv(); db.reset(); vi.mocked(createServerClient).mockReturnValue(db.client); db.seed('cases', { id: caseId, status: 'COMPLETED', created_by: FAKE_USER_SUB, created_at: '2026-10-13T10:00:00Z', updated_at: '2026-10-13T10:00:00Z' }); });
async function read(id: string, authenticated = true) {
  const output = { statusCode: 200, body: '', setHeader: vi.fn(), end(value: string) { this.body = value; } };
  await caseHandler({ method: 'GET', headers: {}, query: { caseId, auditId: id }, ...(authenticated ? { auth: fakeAuthContext() } : {}) } as unknown as ApiRequest, output as unknown as ApiResponse);
  return { status: output.statusCode, payload: JSON.parse(output.body) };
}
function seed(ownerId = caseId) { db.seed('audits', { id: auditId, case_id: ownerId, status: 'COMPLETED', result_json: validAuditResult, provider: 'openrouter', model: 'test', created_at: '2026-10-12T10:00:00Z' }); }
it('devuelve el assessment original por ID y conserva su identidad de caso', async () => { seed(); const result = await read(auditId); expect(result.status).toBe(200); expect(result.payload.audit.id).toBe(auditId); expect(result.payload.audit.caseId).toBe(caseId); expect(result.payload.audit.resultJson.audit.reasoning).toBe(validAuditResult.audit.reasoning); });
it('oculta con 404 una auditoría que pertenece a otro ticket', async () => { seed('33333333-3333-4333-8333-333333333333'); expect((await read(auditId)).status).toBe(404); });
it('oculta con 404 un identificador inexistente', async () => { expect((await read(auditId)).status).toBe(404); });
it('rechaza un identificador inválido antes de consultar la auditoría', async () => { seed(); expect((await read('../invalido')).status).toBe(400); });
it('requiere sesión para leer un dictamen histórico', async () => { seed(); expect((await read(auditId, false)).status).toBe(401); });

it.each(['ERROR', 'RUNNING', 'COMPLETED', null] as const)('deriva el permiso de reintento ajeno del Coordinador para estado %s', async status => {
  if (status) db.seed('audits', { id: auditId, case_id: caseId, status, result_json: status === 'COMPLETED' ? validAuditResult : null, provider: 'openrouter', model: 'test', created_at: new Date().toISOString(), deadline_at: new Date(Date.now() + 300_000).toISOString() });
  const output = { statusCode: 200, body: '', setHeader: vi.fn(), end(value: string) { this.body = value; } };
  await caseHandler({ method: 'GET', headers: {}, query: { caseId }, auth: fakeAuthContext('coordinator', { sub: 'coordinator-other' }) } as unknown as ApiRequest, output as unknown as ApiResponse);
  expect(output.statusCode, output.body).toBe(200);
  const data = JSON.parse(output.body);
  expect(data.case.canWrite).toBe(false);
  expect(data.canRunAudit).toBe(status === 'ERROR');
});
