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
type Op = 'select' | 'insert' | 'update' | 'upsert';
type QueryResult = { data: Row[] | Row | null; error: null };

class FakeQuery implements PromiseLike<QueryResult> {
  private readonly filters: Array<[string, unknown, 'eq' | 'is']> = [];
  private readonly orders: Array<[string, boolean]> = [];
  private limitCount: number | null = null;

  constructor(
    private readonly db: FakeDatabaseImpl,
    private readonly table: string,
    private readonly op: Op,
    private readonly payload: Row[] | null = null,
    private readonly patch: Row | null = null,
    /** Columnas del `UNIQUE` que decide qué fila se sustituye. Sólo para `upsert`. */
    private readonly conflictColumns: string[] = [],
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

  /**
   * UPSERT por columnas de conflicto.
   *
   * Reproduce la semántica de Postgres en `ON CONFLICT (cols) DO UPDATE`: la
   * fila que colisiona se SUSTITUYE por la entrante, y si no colisiona se
   * inserta. Es lo que la capa de datos necesita para "guardar sustituye" en
   * lugar de acumular histórico.
   *
   * No dispara triggers, así que una columna como `updated_at` que los fije la
   * base NO se bumpea aquí. Los tests que dependan de eso deben sembrarla en el
   * payload, no esperar que el fake la mueva.
   */
  upsert(rows: Row[], options?: { onConflict?: string }): FakeQuery {
    const columns = (options?.onConflict ?? '')
      .split(',')
      .map((column) => column.trim())
      .filter((column) => column !== '');
    return new FakeQuery(this.db, this.table, 'upsert', rows, null, columns);
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value, 'eq']);
    return this;
  }

  /**
   * `col IS NULL` (o `IS value`). Reproduce el `is` de PostgREST, que la capa de
   * datos usa como guarda atómica: `undefined` cuenta como NULL porque una
   * columna ausente en el fake representa lo mismo que un NULL en Postgres.
   */
  is(column: string, value: unknown): this {
    this.filters.push([column, value, 'is']);
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

    if (this.op === 'upsert') {
      const affected: Row[] = [];
      for (const row of this.payload ?? []) {
        const existing =
          this.conflictColumns.length === 0
            ? undefined
            : this.db
                .rows(this.table)
                .find((candidate) => this.conflictColumns.every((column) => candidate[column] === row[column]));
        if (existing === undefined) {
          const inserted = {
            ...row,
            id: typeof row.id === 'string' ? row.id : `${this.table}-${this.db.nextSequence()}`,
          };
          this.db.rows(this.table).push(inserted);
          affected.push(inserted);
        } else {
          // `ON CONFLICT DO UPDATE` reemplaza los campos presentes y conserva el
          // resto, incluido el `id` ya asignado.
          Object.assign(existing, row);
          affected.push(existing);
        }
      }
      return { data: single ? affected[0] ?? null : affected, error: null };
    }

    let rows = this.db
      .rows(this.table)
      .filter((row) =>
        this.filters.every(([column, value, op]) => {
          if (op === 'is') {
            return value === null ? row[column] === null || row[column] === undefined : row[column] === value;
          }
          return row[column] === value;
        }),
      );

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
  /**
   * Siembra una fila CRUDO, sin pasar por el cliente ni por una función de
   * producción.
   *
   * Hace falta cuando la fila que hay que sembrar no se puede crear con la
   * API real (un `cases` con `id` y `created_by` concretos, por ejemplo). Ojo:
   * `rows()` devuelve COPIAS, así que hacer `db.rows('cases').push(...)` no
   * siembra nada y el fallo se manifiesta como un 404 más adelante.
   */
  seed(table: string, row: Row): void;
  reset(): void;
}

export function createFakeDatabase(): FakeDatabase {
  const db = new FakeDatabaseImpl();
  return {
    client: db.client(),
    rows: (table) => db.rows(table).map((row) => ({ ...row })),
    seed: (table, row) => {
      db.rows(table).push({ ...row });
    },
    reset: () => db.reset(),
  };
}
