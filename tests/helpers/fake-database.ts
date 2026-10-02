// =============================================================================
// Cliente InsForge mínimo (PostgREST en memoria) para probar la CAPA DE DATOS
// real (`src/server/reviews.ts`) sin red y sin base de datos.
//
// Reproduce SÓLO las operaciones que usa la capa de datos (`select`/`insert`/
// `update` encadenados con `eq`/`order`/`limit`/`single`). No implementa RLS,
// políticas ni ninguna regla de negocio: el objetivo es que el código de
// producción se ejecute de verdad y el test observe las filas que escribe.
// =============================================================================

import type { InsForgeClient } from '../../src/server/insforge';

type Row = Record<string, unknown>;
type Op = 'select' | 'insert' | 'update';
type QueryResult = { data: Row[] | Row | null; error: null };

class FakeQuery implements PromiseLike<QueryResult> {
  private readonly filters: Array<[string, unknown]> = [];
  private readonly orders: Array<[string, boolean]> = [];
  private limitCount: number | null = null;

  constructor(
    private readonly db: FakeDatabaseImpl,
    private readonly table: string,
    private readonly op: Op,
    private readonly payload: Row[] | null = null,
    private readonly patch: Row | null = null,
  ) {}

  select(): this {
    return this;
  }

  insert(rows: Row[]): FakeQuery {
    return new FakeQuery(this.db, this.table, 'insert', rows);
  }

  update(patch: Row): FakeQuery {
    return new FakeQuery(this.db, this.table, 'update', null, patch);
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push([column, options?.ascending ?? true]);
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  single(): Promise<QueryResult> {
    return Promise.resolve(this.run(true));
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run(false)).then(onfulfilled, onrejected);
  }

  private run(single: boolean): QueryResult {
    if (this.op === 'insert') {
      const inserted = (this.payload ?? []).map((row) => ({
        ...row,
        id: typeof row.id === 'string' ? row.id : `${this.table}-${this.db.nextSequence()}`,
      }));
      this.db.rows(this.table).push(...inserted);
      return { data: single ? inserted[0] ?? null : inserted, error: null };
    }

    let rows = this.db
      .rows(this.table)
      .filter((row) => this.filters.every(([column, value]) => row[column] === value));

    if (this.op === 'update') {
      for (const row of rows) Object.assign(row, this.patch ?? {});
    }

    for (const [column, ascending] of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const left = a[column];
        const right = b[column];
        if (left === right) return 0;
        const cmp = String(left).localeCompare(String(right));
        return ascending ? cmp : -cmp;
      });
    }
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);

    return { data: single ? rows[0] ?? null : rows, error: null };
  }
}

class FakeDatabaseImpl {
  private readonly tables = new Map<string, Row[]>();
  private sequence = 0;

  rows(table: string): Row[] {
    let found = this.tables.get(table);
    if (!found) {
      found = [];
      this.tables.set(table, found);
    }
    return found;
  }

  nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  reset(): void {
    this.tables.clear();
    this.sequence = 0;
  }

  client(): InsForgeClient {
    return {
      database: {
        from: (table: string) => new FakeQuery(this, table, 'select'),
      },
    } as unknown as InsForgeClient;
  }
}

export interface FakeDatabase {
  /** Cliente InsForge fake, listo para `createCaseReview(fake, ...)`. */
  client: InsForgeClient;
  /** Copia de las filas de una tabla (para observar qué se escribió). */
  rows(table: string): Row[];
  reset(): void;
}

export function createFakeDatabase(): FakeDatabase {
  const db = new FakeDatabaseImpl();
  return {
    client: db.client(),
    rows: (table) => db.rows(table).map((row) => ({ ...row })),
    reset: () => db.reset(),
  };
}
