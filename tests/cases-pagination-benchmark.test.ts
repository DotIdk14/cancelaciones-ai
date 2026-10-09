import { describe, it } from 'vitest';
import type { AuthContext } from '../src/server/auth';
import type { InsForgeClient } from '../src/server/insforge';
import { listCaseSummaryPage } from '../src/server/cases';
import { caseToSummary } from '../src/server/dto';
import { FAKE_USER_SUB } from './helpers/auth';

type Row = Record<string, unknown>;

function syntheticClient(rows: Row[]): InsForgeClient {
  return {
    database: {
      from(table: string) {
        const filters: Array<(row: Row) => boolean> = [];
        let range: [number, number] = [0, 49];
        const query = {
          select() { return query; },
          eq(column: string, value: unknown) { filters.push((row) => row[column] === value); return query; },
          lte(column: string, value: unknown) { filters.push((row) => String(row[column] ?? '') <= String(value)); return query; },
          in(column: string, values: unknown[]) { filters.push((row) => values.includes(row[column])); return query; },
          order() { return query; },
          range(from: number, to: number) { range = [from, to]; return query; },
          then(resolve: (value: unknown) => unknown) {
            const source = table === 'cases' ? rows : [];
            const data = source.filter((row) => filters.every((filter) => filter(row)))
              .slice(range[0], range[1] + 1)
              .map((row) => ({ ...row, evidence: [] }));
            return Promise.resolve({ data, error: null }).then(resolve);
          },
        };
        return query;
      },
    },
  } as unknown as InsForgeClient;
}

describe('benchmark sintético del listado incremental', () => {
  it('mide tiempo, heap y bytes entregados al cliente con bases de distinto tamaño', async () => {
    const auth = { sub: FAKE_USER_SUB, role: 'user' } as AuthContext;
    const snapshot = '2026-10-09T23:59:59.999Z';
    const report: Array<Record<string, number>> = [];
    for (const size of [100, 1_000, 10_000]) {
      const rows = Array.from({ length: size }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        status: 'READY',
        student_identifier: `SYNTHETIC-${index}`,
        created_by: FAKE_USER_SUB,
        created_at: new Date(Date.UTC(2026, 0, 1) + index).toISOString(),
        updated_at: new Date(Date.UTC(2026, 0, 1) + index).toISOString(),
      }));
      const client = syntheticClient(rows);
      const heapStart = process.memoryUsage().heapUsed;
      const started = performance.now();
      let bytes = 0;
      let count = 0;
      for (let offset = 0; offset < size; offset += 50) {
        const page = await listCaseSummaryPage(client, auth, { offset, limit: Math.min(50, size - offset), snapshot });
        count += page.length;
        bytes += Buffer.byteLength(JSON.stringify(page.map(caseToSummary)));
      }
      report.push({ rows: count, elapsedMs: Math.round(performance.now() - started), heapDeltaBytes: process.memoryUsage().heapUsed - heapStart, responseBytes: bytes });
    }
    console.info('[synthetic-pagination-benchmark]', JSON.stringify(report));
  });
});
