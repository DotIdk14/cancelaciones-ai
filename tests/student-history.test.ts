import { describe, it, expect, vi } from 'vitest';
import { historyOffset, studentHistory, studentHistoryEntry } from '../src/server/student-history';
import type { InsForgeClient } from '../src/server/insforge';
import type { CaseRow } from '../src/server/cases';
import { fakeAuthContext } from './helpers/auth';
vi.mock('../src/server/cases', () => ({ getScopedCaseOr404: vi.fn(async (_client, id) => ({ id, student_identifier: id === 'foreign' ? '999' : '00123', assigned_to: null })) }));
vi.mock('../src/server/reviews', () => ({ getCaseReview: vi.fn(async () => null) }));
const row = { id: 'current', student_identifier: '00123', student_name: 'Estudiante sintético', created_at: '2026-10-12' } as CaseRow;
function database() {
  const calls: Array<{ table: string; filters: Array<[string, unknown]>; range?: number[]; columns?: string }> = [];
  const cases = [
    { id: 'current', student_identifier: '00123', external_case_id: 'CaVe-2', created_at: '2026-10-12', status: 'DRAFT', evidence: [{ count: 2 }], audits: [{ count: 2 }] },
    { id: 'previous', student_identifier: '00123', external_case_id: 'CaVe-1', created_at: '2026-10-11', status: 'DRAFT', evidence: [{ count: 1 }], audits: [{ count: 1 }] },
    { id: 'manual', student_identifier: '00123', created_at: '2026-10-10', status: 'DRAFT', evidence: [{ count: 0 }], audits: [{ count: 0 }] },
  ];
  const client = { database: { from(table: string) {
    const call = { table, filters: [] as Array<[string, unknown]>, range: undefined as number[] | undefined, columns: '' }; calls.push(call);
    const query = { select(columns: string) { call.columns = columns; return query; }, eq(k: string, v: unknown) { call.filters.push([k,v]); return query; }, order() { return query; }, limit() { return query; }, range(a: number,b: number) { call.range=[a,b]; return query; }, then(resolve: (v: unknown) => unknown) { return Promise.resolve(resolve({ data: table === 'cases' ? cases.slice(call.range?.[0] ?? 0, (call.range?.[1] ?? 99)+1) : [], count: 0, error: null })); } }; return query;
  } } } as unknown as InsForgeClient;
  return { client, calls };
}
describe('Historial exacto de matrícula', () => {
  it('separa tickets, casos manuales, auditorías y evidencias sin perder ceros', async () => {
    const { client, calls } = database();
    const history = await studentHistory(client, row, fakeAuthContext(), 0);
    expect(history.studentIdentifier).toBe('00123');
    expect(history.summary).toMatchObject({ cases: 3, audits: 3, evidences: 3, previousCases: 2 });
    expect(history.cases.map(c => c.externalCaseId)).toEqual(['CaVe-2', 'CaVe-1', null]);
    expect(calls.filter(c => c.table === 'cases').every(c => c.filters.some(([k,v]) => k === 'student_identifier' && v === '00123'))).toBe(true);
    expect(calls.every(c => c.columns)).toBe(true);
  });
  it('pagina en el servidor y no vuelve a procesar ni escribir datos', async () => {
    const { client, calls } = database();
    const history = await studentHistory(client, row, fakeAuthContext(), 25);
    expect(history.cases).toEqual([]);
    expect(calls.some(c => c.range?.[0] === 25 && c.range[1] === 49)).toBe(true);
  });
  it('rechaza otra matrícula y roles desconocidos', async () => {
    const { client } = database();
    await expect(studentHistoryEntry(client, row, fakeAuthContext(), 'foreign', 0)).rejects.toMatchObject({ status: 404 });
    await expect(studentHistory(client, row, { ...fakeAuthContext(), role: 'unknown' } as never, 0)).rejects.toMatchObject({ status: 404 });
  });
  it('valida paginación sin coerciones ambiguas', () => {
    expect(historyOffset(undefined)).toBe(0); expect(historyOffset('25')).toBe(25);
    for (const v of ['-1','1.2','', ['0'], '100001']) expect(() => historyOffset(v)).toThrow();
  });
});
