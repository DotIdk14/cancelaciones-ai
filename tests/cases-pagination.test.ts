import { describe, expect, it } from 'vitest';
import type { InsForgeClient } from '../src/server/insforge';
import { listCaseSummaries, listCaseSummaryPage } from '../src/server/cases';
import { fakeAuthContext, FAKE_USER_SUB } from './helpers/auth';

type Row = Record<string, unknown>;

function database(rows: Row[], related: Record<string, Row[]> = {}) {
  const ranges: Array<[string, number, number]> = [];
  const filters: Array<[string, string, unknown]> = [];
  const client = {
    database: {
      from(table: string) {
        let page: [number, number] = [0, 9999];
        let predicates: Array<[string, string, unknown]> = [];
        const orders: Array<[string, boolean]> = [];
        const query = {
          select() { return query; },
          eq(column: string, value: unknown) { predicates.push([column, 'eq', value]); return query; },
          lte(column: string, value: unknown) { predicates.push([column, 'lte', value]); return query; },
          in(column: string, value: unknown[]) { predicates.push([column, 'in', value]); return query; },
          order(column: string, options?: { ascending?: boolean }) { orders.push([column, options?.ascending ?? true]); return query; },
          range(from: number, to: number) { page = [from, to]; return query; },
          then(resolve: (value: unknown) => unknown) {
            filters.push(...predicates);
            ranges.push([table, page[0], page[1]]);
            const matches = (rowsForTable: Row[]) => rowsForTable.filter((row) => predicates.every(([column, op, value]) => {
              if (op === 'eq') return row[column] === value;
              if (op === 'in') return (value as unknown[]).includes(row[column]);
              return String(row[column] ?? '') <= String(value);
            }));
            let found = matches(table === 'cases' ? rows : related[table] ?? []);
            if (table === 'cases') found = found.map((row) => ({ ...row, evidence: [] }));
            for (const [column, ascending] of [...orders].reverse()) {
              found = [...found].sort((a, b) => {
                const left = String(a[column] ?? '');
                const right = String(b[column] ?? '');
                return (left.localeCompare(right)) * (ascending ? 1 : -1);
              });
            }
            const data = found.slice(page[0], page[1] + 1);
            predicates = [];
            return Promise.resolve({ data, error: null }).then(resolve);
          },
        };
        return query;
      },
    },
  };
  return { client: client as unknown as InsForgeClient, ranges, filters };
}

function caseRows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `case-${String(index).padStart(5, '0')}`,
    status: 'READY',
    student_identifier: `student-${index}`,
    created_by: FAKE_USER_SUB,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
  }));
}

describe('listCaseSummaries — paginación segura y sin límite de 100', () => {
  it.each([0, 1, 100, 101, 2_050])('devuelve los %i casos accesibles', async (count) => {
    const { client, ranges } = database(caseRows(count));
    const cases = await listCaseSummaries(client, fakeAuthContext('user'));
    expect(cases).toHaveLength(count);
    expect(cases.at(0)?.id).toBe(count === 0 ? undefined : `case-${String(count - 1).padStart(5, '0')}`);
    expect(ranges.some(([table, from]) => table === 'cases' && from > 0)).toBe(count >= 100);
  });

  it('aplica el alcance del Asesor en la consulta antes de paginar', async () => {
    const rows = [
      ...caseRows(250),
      { ...caseRows(1)[0], id: 'foreign-case', created_by: 'another-user' },
    ];
    const { client, filters } = database(rows);
    const cases = await listCaseSummaries(client, fakeAuthContext('user'));

    expect(cases).toHaveLength(250);
    expect(filters).toContainEqual(['created_by', 'eq', FAKE_USER_SUB]);
    expect(cases.some((row) => row.id === 'foreign-case')).toBe(false);
  });

  it('sirve páginas acotadas y aplica propietario, estado y snapshot en la consulta', async () => {
    const rows = [
      ...caseRows(4),
      { ...caseRows(1)[0], id: 'foreign-case', created_by: 'another-user' },
    ].map((row, index) => ({ ...row, status: index === 1 ? 'DRAFT' : 'READY' }));
    const { client, ranges, filters } = database(rows);
    const page = await listCaseSummaryPage(client, fakeAuthContext('user'), {
      offset: 1,
      limit: 2,
      snapshot: '2026-01-01T00:00:10.000Z',
      status: 'READY',
    });
    expect(page).toHaveLength(2);
    expect(ranges).toContainEqual(['cases', 1, 2]);
    expect(filters).toContainEqual(['created_by', 'eq', FAKE_USER_SUB]);
    expect(filters).toContainEqual(['status', 'eq', 'READY']);
    expect(filters).toContainEqual(['created_at', 'lte', '2026-01-01T00:00:10.000Z']);
    expect(page.every((row) => row.created_by === FAKE_USER_SUB && row.status === 'READY')).toBe(true);
  });

  it('no pierde la auditoría más reciente cuando un caso tiene más de 500 dictámenes', async () => {
    const cases = caseRows(2);
    const audits = Array.from({ length: 1_205 }, (_, index) => ({
      id: `audit-${String(index).padStart(4, '0')}`,
      case_id: cases[0]!.id,
      status: 'COMPLETED',
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      evidence_fingerprint: 'old',
    }));
    audits.push({
      id: 'audit-second-case',
      case_id: cases[1]!.id,
      status: 'COMPLETED',
      created_at: '2025-12-31T23:59:59.000Z',
      evidence_fingerprint: 'old',
    });
    const { client, ranges } = database(cases, { audits });
    const result = await listCaseSummaries(client, fakeAuthContext('user'));
    expect(result.find((row) => row.id === cases[0]!.id)?.audit?.id).toBe('audit-1204');
    expect(result.find((row) => row.id === cases[1]!.id)?.audit?.id).toBe('audit-second-case');
    expect(ranges.filter(([table]) => table === 'audits')).toEqual([
      ['audits', 0, 499],
      ['audits', 500, 999],
      ['audits', 1000, 1499],
    ]);
  });
});
