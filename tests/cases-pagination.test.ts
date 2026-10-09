import { describe, expect, it } from 'vitest';
import type { InsForgeClient } from '../src/server/insforge';
import { listCaseSummaries } from '../src/server/cases';
import { fakeAuthContext, FAKE_USER_SUB } from './helpers/auth';

type Row = Record<string, unknown>;

function database(rows: Row[]) {
  const ranges: Array<[string, number, number]> = [];
  const filters: Array<[string, string, unknown]> = [];
  const client = {
    database: {
      from(table: string) {
        let page: [number, number] = [0, 9999];
        let predicates: Array<[string, string, unknown]> = [];
        const query = {
          select() { return query; },
          eq(column: string, value: unknown) { predicates.push([column, 'eq', value]); return query; },
          lte(column: string, value: unknown) { predicates.push([column, 'lte', value]); return query; },
          in(column: string, value: unknown[]) { predicates.push([column, 'in', value]); return query; },
          order() { return query; },
          range(from: number, to: number) { page = [from, to]; return query; },
          then(resolve: (value: unknown) => unknown) {
            filters.push(...predicates);
            ranges.push([table, page[0], page[1]]);
            const matches = (rowsForTable: Row[]) => rowsForTable.filter((row) => predicates.every(([column, op, value]) => {
              if (op === 'eq') return row[column] === value;
              if (op === 'in') return (value as unknown[]).includes(row[column]);
              return String(row[column] ?? '') <= String(value);
            }));
            let found = table === 'cases' ? matches(rows) : [];
            if (table === 'cases') found = found.map((row) => ({ ...row, evidence: [] }));
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
    expect(cases.at(-1)?.id).toBe(count === 0 ? undefined : `case-${String(count - 1).padStart(5, '0')}`);
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
});
