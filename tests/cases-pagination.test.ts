import { describe, expect, it } from 'vitest';
import type { InsForgeClient } from '../src/server/insforge';
import { listCaseSummaries, listCaseSummaryPage, countCaseSummaryStatuses } from '../src/server/cases';
import { caseToSummary } from '../src/server/dto';
import { fakeAuthContext, FAKE_USER_SUB } from './helpers/auth';

type Row = Record<string, unknown>;

function database(rows: Row[], related: Record<string, Row[]> = {}) {
  const ranges: Array<[string, number, number]> = [];
  const filters: Array<[string, string, unknown]> = [];
  const client = {
    auth: { async getProfile(id: string) { return { data: { name: id === 'advisor-a' ? 'Ana Pérez' : id === 'advisor-b' ? 'Luis Gómez' : 'Coordinador importador' }, error: null }; } },
    database: {
      from(table: string) {
        let page: [number, number] = [0, 9999];
        let predicates: Array<[string, string, unknown]> = [];
        let disjunction: Array<[string, unknown]> = [];
        const orders: Array<[string, boolean]> = [];
        const query = {
          select() { return query; },
          eq(column: string, value: unknown) { predicates.push([column, 'eq', value]); return query; },
          is(column: string, value: unknown) { predicates.push([column, 'is', value]); return query; },
          lte(column: string, value: unknown) { predicates.push([column, 'lte', value]); return query; },
          in(column: string, value: unknown[]) { predicates.push([column, 'in', value]); return query; },
          or(expression: string) { filters.push(['created_by|assigned_to', 'or', expression]); disjunction = expression.split(',').map((part) => { const [column, , value] = part.split('.'); return [column!, value]; }); return query; },
          order(column: string, options?: { ascending?: boolean }) { orders.push([column, options?.ascending ?? true]); return query; },
          range(from: number, to: number) { page = [from, to]; return query; },
          then(resolve: (value: unknown) => unknown) {
            filters.push(...predicates);
            ranges.push([table, page[0], page[1]]);
            const matches = (rowsForTable: Row[]) => rowsForTable.filter((row) => predicates.every(([column, op, value]) => {
              if (op === 'is') return (row[column] ?? null) === value;
              if (op === 'eq') return (column === 'flokzu_audit_eligible' ? row[column] ?? true : row[column]) === value;
              if (op === 'in') return (value as unknown[]).includes(row[column]);
              return String(row[column] ?? '') <= String(value);
            }));
            let found = matches(table === 'cases' ? rows : related[table] ?? []).filter((row) => disjunction.length === 0 || disjunction.some(([column, value]) => row[column] === value));
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
            disjunction = [];
            return Promise.resolve({ data, error: null, count: found.length }).then(resolve);
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
  it('conserva una página de 100 expedientes con filtros de relaciones de máximo 40 IDs', async () => {
    const { client, filters } = database(caseRows(100));
    const rows = await listCaseSummaryPage(client, fakeAuthContext('coordinator'), { offset: 0, limit: 100, snapshot: '2027-01-01T00:00:00Z' });
    expect(rows).toHaveLength(100);
    const batches = filters.filter(([column, operation]) => column === 'case_id' && operation === 'in');
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every(([, , ids]) => (ids as unknown[]).length <= 40)).toBe(true);
  });
  it('muestra al responsable persistido actual sin confundirlo con el importador y conserva auditoría y conteo', async () => {
    const rows = [{ ...caseRows(1)[0], created_by: 'importer', assigned_to: 'advisor-a', external_source: 'FLOKZU', flokzu_data: { evidenceReferences: [{ label: 'Documento', value: 'archivo', url: 'https://example.org/prueba' }] } }];
    const { client } = database(rows);
    const first = (await listCaseSummaries(client, fakeAuthContext('coordinator')))[0]!;
    expect(caseToSummary(first)).toMatchObject({ assignedTo: 'advisor-a', assignedName: 'Ana Pérez', creatorId: 'importer', evidenceCount: 0, effectiveResolution: null });
    rows[0]!.assigned_to = 'advisor-b';
    expect(caseToSummary((await listCaseSummaries(client, fakeAuthContext('coordinator')))[0]!)).toMatchObject({ assignedTo: 'advisor-b', assignedName: 'Luis Gómez', creatorId: 'importer', evidenceCount: 0 });
  });

  it.each(['advisor-a', 'UNASSIGNED'])('filtra por responsable antes de paginar y cuenta el mismo conjunto: %s', async (assignedTo) => {
    const rows = [
      { ...caseRows(1)[0], id: 'assigned', assigned_to: 'advisor-a' },
      { ...caseRows(1)[0], id: 'other', assigned_to: 'advisor-b' },
      { ...caseRows(1)[0], id: 'unassigned', assigned_to: null },
    ];
    const { client } = database(rows);
    const page = await listCaseSummaryPage(client, fakeAuthContext('coordinator'), { offset: 0, limit: 1, snapshot: '2026-01-02T00:00:00.000Z', assignedTo });
    expect(page.map(row => row.id)).toEqual([assignedTo === 'UNASSIGNED' ? 'unassigned' : 'assigned']);
    const counts = await countCaseSummaryStatuses(client, fakeAuthContext('coordinator'), undefined, undefined, assignedTo);
    expect(counts.ALL).toBe(1);
    expect(counts.READY).toBe(1);
  });
  it.each([0, 1, 100, 101, 2_050])('devuelve los %i casos accesibles', async (count) => {
    const { client, ranges } = database(caseRows(count));
    const cases = await listCaseSummaries(client, fakeAuthContext('user'));
    expect(cases).toHaveLength(count);
    expect(cases.at(0)?.id).toBe(count === 0 ? undefined : `case-${String(count - 1).padStart(5, '0')}`);
    expect(ranges.some(([table, from]) => table === 'cases' && from > 0)).toBe(count >= 100);
  });

  it('incluye los casos de otros propietarios para el Asesor', async () => {
    const rows = [
      ...caseRows(250),
      { ...caseRows(1)[0], id: 'foreign-case', created_by: 'another-user' },
    ];
    const { client, filters } = database(rows);
    const cases = await listCaseSummaries(client, fakeAuthContext('user'));

    expect(cases).toHaveLength(251);
    expect(filters.some(([column, op]) => column === 'created_by|assigned_to' && op === 'or')).toBe(false);
    expect(cases.some((row) => row.id === 'foreign-case')).toBe(true);
  });

  it('sirve páginas globales acotadas y aplica estado y snapshot en la consulta', async () => {
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
    expect(filters.some(([column, op]) => column === 'created_by|assigned_to' && op === 'or')).toBe(false);
    expect(filters).toContainEqual(['status', 'eq', 'READY']);
    expect(filters).toContainEqual(['created_at', 'lte', '2026-01-01T00:00:10.000Z']);
    expect(page.every((row) => row.status === 'READY')).toBe(true);
  });

  it('filtra por el rol creador antes de paginar para no ocultar casos de otras páginas', async () => {
    const rows = [
      { ...caseRows(1)[0], id: 'asesor-case', created_by: 'advisor-id' },
      { ...caseRows(1)[0], id: 'coordinator-case', created_by: 'coordinator-id' },
    ];
    const { client, filters } = database(rows, {
      app_memberships: [
        { user_id: 'advisor-id', role: 'user' },
        { user_id: 'coordinator-id', role: 'coordinator' },
      ],
    });

    const page = await listCaseSummaryPage(client, fakeAuthContext('manager'), {
      offset: 0,
      limit: 1,
      snapshot: '2026-01-01T00:00:10.000Z',
      creatorRole: 'coordinator',
    });

    expect(page.map((row) => row.id)).toEqual(['coordinator-case']);
    expect(page[0]?.creator_role).toBe('coordinator');
    expect(filters).toContainEqual(['role', 'eq', 'coordinator']);
    expect(filters).toContainEqual(['created_by', 'in', ['coordinator-id']]);
  });

  it('filtra por el identificador individual del creador antes de paginar', async () => {
    const creatorId = 'advisor-id';
    const rows = [
      { ...caseRows(1)[0], id: 'selected-creator-case', created_by: creatorId },
      { ...caseRows(1)[0], id: 'other-creator-case', created_by: 'another-advisor-id' },
    ];
    const { client, filters } = database(rows, {
      app_memberships: [
        { user_id: creatorId, role: 'user' },
        { user_id: 'another-advisor-id', role: 'user' },
      ],
    });

    const page = await listCaseSummaryPage(client, fakeAuthContext('manager'), {
      offset: 0,
      limit: 1,
      snapshot: '2026-01-01T00:00:10.000Z',
      creatorRole: 'user',
      creatorId,
    });

    expect(page.map((row) => row.id)).toEqual(['selected-creator-case']);
    expect(filters).toContainEqual(['created_by', 'eq', creatorId]);
    expect(filters).toContainEqual(['created_by', 'in', [creatorId, 'another-advisor-id']]);
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
