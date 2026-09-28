import type { DatabaseClient } from '../client';

/** Fila tal y como la guarda la base: snake_case, sin transformaciones. */
export type FakeRow = Record<string, unknown>;

export type FakeRpcHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

export interface FakeDatabase extends DatabaseClient {
  /** Filas guardadas de una tabla, como copias: el test no puede mutar el store por accidente. */
  rows(table: string): FakeRow[];
  seed(table: string, rows: FakeRow[]): void;
  registerRpc(name: string, handler: FakeRpcHandler): void;
  /** Hace que toda escritura contra la tabla falle, para probar caminos best-effort. */
  failTable(table: string, message: string): void;
  /** Sustituye el valor de una columna en todas las filas de una tabla. */
  patchRows(table: string, patch: FakeRow, where?: (row: FakeRow) => boolean): void;
  reset(): void;
}

type Operator = 'eq' | 'in' | 'lt';

interface Filter {
  column: string;
  operator: Operator;
  value: string | string[];
}

let nowCounter = 0;

function nowIso(): string {
  nowCounter += 1;
  return new Date(Date.now() + nowCounter).toISOString();
}

/**
 * Cliente de base de datos en memoria para probar repositorios.
 *
 * Existe porque los repositorios se prueban contra SU contrato (qué escriben,
 * qué cadena de llamadas encadenan, qué error lanzan), no contra InsForge: un
 * test que necesita una red para afirmar que un run terminal no se reescribe no
 * está probando la regla, está probando la red.
 *
 * Reproduce lo mínimo del servidor que los repositorios sí pueden depender:
 * columnas por defecto (`created_at`), filtrado, orden, paginado, colapso a una
 * fila y despacho de RPC. Lo que NO reproduce es RLS, triggers ni restricciones
 * UNIQUE: esas reglas viven en el baseline y se verifican contra la base real,
 * no aquí. Por eso los repositorios comprueban en su código lo que el servidor
 * no les deja comprobar.
 */
export function createFakeDatabase(options: { tables?: Record<string, FakeRow[]>; rpc?: Record<string, FakeRpcHandler> } = {}): FakeDatabase {
  const tables = new Map<string, FakeRow[]>();
  const failingTables = new Map<string, string>();
  const rpcHandlers = new Map<string, FakeRpcHandler>();
  const idCounters = new Map<string, number>();

  const tableOf = (name: string): FakeRow[] => {
    let rows = tables.get(name);
    if (!rows) {
      rows = [];
      tables.set(name, rows);
    }
    return rows;
  };

  const requireWritable = (table: string): void => {
    const failure = failingTables.get(table);
    if (failure) throw new Error(failure);
  };

  for (const [name, rows] of Object.entries(options.tables ?? {})) {
    tables.set(name, rows.map((row) => ({ ...row })));
  }
  for (const [name, handler] of Object.entries(options.rpc ?? {})) {
    rpcHandlers.set(name, handler);
  }

  const matches = (row: FakeRow, filter: Filter): boolean => {
    const actual = row[filter.column];
    if (actual === undefined || actual === null) return false;
    if (filter.operator === 'eq') return String(actual) === filter.value;
    if (filter.operator === 'in') return (filter.value as string[]).map(String).includes(String(actual));
    return new Date(String(actual)).getTime() < new Date(filter.value as string).getTime();
  };

  const project = (row: FakeRow, columns?: string): FakeRow => {
    if (!columns || columns === '*') return { ...row };
    const wanted = columns
      .split(',')
      .map((column) => column.trim())
      .filter(Boolean);
    const projected: FakeRow = {};
    for (const column of wanted) {
      if (column in row) projected[column] = row[column];
    }
    return projected;
  };

  return {
    rows(table: string): FakeRow[] {
      return tableOf(table).map((row) => ({ ...row }));
    },

    seed(table: string, rows: FakeRow[]): void {
      tableOf(table).length = 0;
      tableOf(table).push(...rows.map((row) => ({ ...row })));
    },

    registerRpc(name: string, handler: FakeRpcHandler): void {
      rpcHandlers.set(name, handler);
    },

    failTable(table: string, message: string): void {
      failingTables.set(table, message);
    },

    patchRows(table: string, patch: FakeRow, where?: (row: FakeRow) => boolean): void {
      for (const row of tableOf(table)) {
        if (!where || where(row)) Object.assign(row, patch);
      }
    },

    reset(): void {
      tables.clear();
      failingTables.clear();
      rpcHandlers.clear();
      idCounters.clear();
      for (const [name, rows] of Object.entries(options.tables ?? {})) {
        tables.set(name, rows.map((row) => ({ ...row })));
      }
      for (const [name, handler] of Object.entries(options.rpc ?? {})) {
        rpcHandlers.set(name, handler);
      }
    },

    from(table: string) {
      if (!table) throw new Error('fake: el nombre de la tabla es obligatorio');

      const filters: Filter[] = [];
      let columns: string | undefined;
      let orderedBy: string | undefined;
      let ascending = false;
      let maxRows: number | undefined;
      let skipRows: number | undefined;
      let singleRow = false;
      let inserted: Record<string, unknown>[] | undefined;
      let patch: Record<string, unknown> | undefined;

      const selected = (): FakeRow[] => {
        const rows = tableOf(table).filter((row) => filters.every((filter) => matches(row, filter)));
        if (orderedBy) {
          const column = orderedBy;
          const direction = ascending ? 1 : -1;
          return [...rows].sort((left, right) => {
            const a = left[column];
            const b = right[column];
            if (a === b) return 0;
            if (a === undefined || a === null) return 1;
            if (b === undefined || b === null) return -1;
            return (String(a) < String(b) ? -1 : 1) * direction;
          });
        }
        return rows;
      };

      const windowed = (rows: FakeRow[]): FakeRow[] => {
        const start = skipRows ?? 0;
        const end = maxRows === undefined ? undefined : start + maxRows;
        return rows.slice(start, end);
      };

      const builder = {
        select(next?: string) {
          columns = next;
          return builder;
        },
        insert(rows: Record<string, unknown>[]) {
          inserted = rows;
          return builder;
        },
        update(next: Record<string, unknown>) {
          patch = next;
          return builder;
        },
        eq(column: string, value: string) {
          filters.push({ column, operator: 'eq', value });
          return builder;
        },
        in(column: string, values: string[]) {
          filters.push({ column, operator: 'in', value: values });
          return builder;
        },
        lt(column: string, value: string) {
          filters.push({ column, operator: 'lt', value });
          return builder;
        },
        order(column: string, opts?: { ascending?: boolean }) {
          orderedBy = column;
          ascending = opts?.ascending ?? false;
          return builder;
        },
        limit(count: number) {
          maxRows = count;
          return builder;
        },
        range(from: number, to: number) {
          skipRows = from;
          maxRows = to - from + 1;
          return builder;
        },
        single() {
          singleRow = true;
          return builder;
        },

        async then<R>(onFulfilled: (value: { data: unknown; error: { message: string } | null }) => R): Promise<R> {
          let data: FakeRow[];

          const rowsToInsert = inserted;
          if (rowsToInsert) {
            try {
              requireWritable(table);
            } catch (error) {
              return onFulfilled({ data: null, error: { message: (error as Error).message } });
            }
            const counter = (idCounters.get(table) ?? 0) + rowsToInsert.length;
            idCounters.set(table, counter);
            const stored = rowsToInsert.map((row, index) => ({
              id: `gen_${counter - rowsToInsert.length + index + 1}`,
              created_at: nowIso(),
              ...row,
            }));
            tableOf(table).push(...stored);
            data = stored;
          } else if (patch) {
            try {
              requireWritable(table);
            } catch (error) {
              return onFulfilled({ data: null, error: { message: (error as Error).message } });
            }
            const targets = selected();
            for (const row of targets) Object.assign(row, patch);
            data = targets;
          } else {
            data = windowed(selected());
          }

          const projected = data.map((row) => project(row, columns));
          if (singleRow) return onFulfilled({ data: projected.length > 0 ? projected[0] : null, error: null });
          return onFulfilled({ data: projected, error: null });
        },
      };

      return builder;
    },

    async rpc(fn: string, args: Record<string, unknown> = {}) {
      const handler = rpcHandlers.get(fn);
      if (!handler) {
        return { data: null, error: { message: `fake: la RPC "${fn}" no esta registrada en el test` } };
      }
      try {
        return { data: await handler(args), error: null };
      } catch (error) {
        return { data: null, error: { message: (error as Error).message } };
      }
    },
  };
}
