import { randomUUID } from 'node:crypto';
import type { DatabaseClient } from '@cancelaciones/db';

/**
 * Base de datos falsa SOLO para los tests de la fundación de política.
 *
 * POR QUÉ EXISTE: la migración `20260925120000_policy-foundation-immutability.sql`
 * está escrita y revisada pero NO APLICADA (Task 9 §1). No hay ninguna base de
 * datos real contra la que probar, así que estos tests modelan las DOS formas
 * del mundo:
 *
 *   1. Mundo SIN migrar (por defecto): `fact_run_frozen_snapshots` no existe y
 *      `freeze_fact_run_v1` / `create_derived_fact_run_v1` /
 *      `persist_policy_evaluation_v1` no existen. Es el estado real de hoy.
 *   2. Mundo CON migración: la tabla existe y los RPC responden.
 *
 * IMITA AL FAKE `DurableDb` DE `audit-queue.e2e.test.ts`: mismo `from()` /
 * `insert()` / `update()` con `rows()`, `project()`, filtros `eq` y `limit`, y
 * el MISMO mensaje `Unsupported rpc <fn>` para una función que no reconoce. La
 * detección de disponibilidad tiene que funcionar con ese fake, así que el fake
 * de esta tarea reproduce su texto literalmente en vez de inventar otro.
 *
 * NO es código productivo: nada en `apps/web/src/app` lo importa.
 */

export type FakeRow = Record<string, unknown>;

export interface FakeError {
  message: string;
  code?: string;
}

export interface FakeResult<T> {
  data: T | null;
  error: FakeError | null;
}

export type FakeRpcHandler = (args: Record<string, unknown>) => { data: unknown; error: FakeError | null };

export const FOUNDATION_RPCS = ['freeze_fact_run_v1', 'create_derived_fact_run_v1', 'persist_policy_evaluation_v1'] as const;

/** Error que PostgREST devuelve cuando la tabla no está en el schema cache. */
export function missingTableError(table: string): FakeError {
  return { message: `Could not find the table 'public.${table}' in the schema cache`, code: 'PGRST205' };
}

/** Error que PostgREST devuelve cuando la función no está en el schema cache. */
export function missingFunctionError(fn: string): FakeError {
  return { message: `Could not find the function public.${fn} in the schema cache`, code: 'PGRST202' };
}

/** Error que PostgREST devuelve cuando la columna no está en el schema cache. */
export function missingColumnError(table: string, column: string): FakeError {
  return { message: `Could not find the column '${column}' of table '${table}' in the schema cache`, code: 'PGRST204' };
}

class FoundationFakeQuery {
  private filters: Array<[string, unknown]> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;
  private selected = '*';
  private mutation: { kind: 'insert'; values: FakeRow[] } | { kind: 'update'; values: FakeRow } | null = null;

  constructor(private readonly db: FoundationFakeDb, private readonly table: string) {}

  select(columns = '*'): this {
    this.selected = columns;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  insert(values: FakeRow[]): this {
    this.mutation = { kind: 'insert', values };
    return this;
  }

  update(values: FakeRow): this {
    this.mutation = { kind: 'update', values };
    return this;
  }

  async single(): Promise<FakeResult<FakeRow | null>> {
    const result = await this.execute();
    return { data: result.data?.[0] ?? null, error: result.error };
  }

  then<TResult1 = FakeResult<FakeRow[]>, TResult2 = never>(
    onfulfilled?: ((value: FakeResult<FakeRow[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  /** Una columna que la base todavía no tiene aborta la sentencia. */
  private missingColumn(): FakeError | null {
    const columns = this.mutation
      ? (this.mutation.kind === 'insert' ? this.mutation.values : [this.mutation.values]).flatMap((value) => Object.keys(value))
      : (this.selected === '*' ? [] : this.selected.split(',').map((column) => column.trim()));
    const missing = columns.find((column) => this.db.absentColumns.has(column));
    return missing ? missingColumnError(this.table, missing) : null;
  }

  private async execute(): Promise<FakeResult<FakeRow[]>> {
    if (this.db.isTableAbsent(this.table)) {
      return { data: null, error: missingTableError(this.table) };
    }
    const missing = this.missingColumn();
    if (missing) return { data: null, error: missing };
    if (this.mutation?.kind === 'insert') {
      if (this.db.insertDeniedOn.has(this.table)) {
        return { data: null, error: { message: `permission denied for table ${this.table}`, code: '42501' } };
      }
      const rows = this.mutation.values.map((value) => this.db.insert(this.table, value));
      this.db.writes.push({ table: this.table, kind: 'insert', values: this.mutation.values });
      return { data: this.project(rows), error: null };
    }
    if (this.mutation?.kind === 'update') {
      const rows = this.rows();
      for (const row of rows) Object.assign(row, this.mutation.values);
      this.db.writes.push({ table: this.table, kind: 'update', values: [this.mutation.values] });
      return { data: this.project(rows), error: null };
    }
    this.db.countRead(this.table);
    return { data: this.project(this.rows()), error: null };
  }

  private rows(): FakeRow[] {
    let rows = [...this.db.table(this.table)];
    for (const [column, value] of this.filters) {
      rows = rows.filter((row) => (value instanceof Set ? value.has(row[column]) : row[column] === value));
    }
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows.sort((left, right) => ascending
        ? String(left[column] ?? '').localeCompare(String(right[column] ?? ''))
        : String(right[column] ?? '').localeCompare(String(left[column] ?? '')));
    }
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
    return rows;
  }

  private project(rows: FakeRow[]): FakeRow[] {
    if (this.selected === '*') return rows.map((row) => ({ ...row }));
    const columns = this.selected.split(',').map((column) => column.trim());
    return rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]])));
  }
}

export class FoundationFakeDb implements DatabaseClient {
  data: Record<string, FakeRow[]> = {
    audits: [],
    fact_extraction_runs: [],
    facts: [],
    fact_reviews: [],
    fact_run_frozen_snapshots: [],
    engine_runs: [],
    engine_rule_results: [],
    audit_runs: [],
    audit_log: [],
  };

  /** Tablas que el mundo "sin migrar" no tiene. */
  readonly absentTables = new Set<string>(['fact_run_frozen_snapshots']);
  /** RPCs que el mundo "sin migrar" no tiene. */
  readonly absentRpcs = new Set<string>([...FOUNDATION_RPCS]);
  /** Tablas cuyo INSERT está revocado (42501). El mundo "con migración" revoca
   * `fact_run_frozen_snapshots` para el rol de cliente; el único camino es el RPC. */
  readonly insertDeniedOn = new Set<string>();
  /**
   * Columnas que el mundo "sin migrar" no tiene. Escribe/lee una columna de
   * esta lista devuelve el error de PostgREST de columna ausente (PGRST204 /
   * 42703), que es lo que hace un cliente real contra una base sin la
   * migración. Sin esto, un fake permisivo escondería exactamente el fallo de
   * "la columna todavía no existe".
   */
  readonly absentColumns = new Set<string>(['effective_facts_fingerprint']);
  readonly rpcHandlers = new Map<string, FakeRpcHandler>();
  readonly rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  readonly writes: Array<{ table: string; kind: 'insert' | 'update'; values: FakeRow[] }> = [];
  private readonly reads = new Map<string, number>();

  /** Pasa al mundo "con migración": la tabla y los tres RPC existen. */
  withFoundationApplied(): this {
    this.absentTables.delete('fact_run_frozen_snapshots');
    this.absentRpcs.clear();
    this.absentColumns.clear();
    return this;
  }

  /** El mundo "con migración" revoca el INSERT directo del snapshot: sólo RPC. */
  withSnapshotInsertRevoked(): this {
    this.insertDeniedOn.add('fact_run_frozen_snapshots');
    return this;
  }

  onRpc(fn: string, handler: FakeRpcHandler): this {
    this.rpcHandlers.set(fn, handler);
    return this;
  }

  readCount(table: string): number {
    return this.reads.get(table) ?? 0;
  }

  writesOn(table: string): Array<{ kind: 'insert' | 'update'; values: FakeRow[] }> {
    return this.writes.filter((write) => write.table === table);
  }

  from(table: string): FoundationFakeQuery {
    return new FoundationFakeQuery(this, table);
  }

  table(table: string): FakeRow[] {
    return this.data[table] ?? (this.data[table] = []);
  }

  isTableAbsent(table: string): boolean {
    return this.absentTables.has(table);
  }

  countRead(table: string): void {
    this.reads.set(table, (this.reads.get(table) ?? 0) + 1);
  }

  insert(table: string, value: FakeRow): FakeRow {
    const row = { id: value.id ?? randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...value };
    this.table(table).push(row);
    return row;
  }

  rows(table: string): FakeRow[] {
    return this.table(table).map((row) => ({ ...row }));
  }

  /**
   * Mismo contrato que el `rpc()` de `DurableDb` en `audit-queue.e2e.test.ts`:
   * si la función no está registrada devuelve `{ data: null, error: { message:
   * 'Unsupported rpc <fn>' } }`. Esa es exactamente la señal que la detección de
   * disponibilidad tiene que reconocer como AUSENCIA, no como fallo.
   */
  async rpc(fn: string, args: Record<string, unknown> = {}): Promise<{ data: unknown; error: FakeError | null }> {
    this.rpcCalls.push({ fn, args });
    const handler = this.rpcHandlers.get(fn);
    if (handler) return handler(args);
    if (this.absentRpcs.has(fn)) return { data: null, error: { message: `Unsupported rpc ${fn}` } };
    return { data: null, error: { message: `Unsupported rpc ${fn}` } };
  }
}
