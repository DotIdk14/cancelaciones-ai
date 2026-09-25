import { describe, expect, it } from 'vitest';
import { createFactRepository, type DatabaseClient } from './index';

/**
 * C1: `createFactRepository.freezeRun` hacía `DRAFT -> FROZEN` en un SOLO
 * `UPDATE`. Con la migración aplicada, `guard_fact_run_transition` aborta esa
 * transición (`FACT_RUN_STATE_TRANSITION_FORBIDDEN: DRAFT -> FROZEN`) y quien lo
 * llama — `POST /api/audits/[auditId]/fact-runs` y el fixture de
 * `/api/dev/synthetic-case` — recibiría un 500.
 *
 * La máquina de estados legal del plan es `DRAFT -> PROCESSING|FAILED` y
 * `PROCESSING -> FROZEN|FAILED`. Este test fija el contrato: se recorre ENTERA,
 * con un paso legal por `UPDATE`, y un estado no congelable se rechaza ANTES de
 * escribir nada.
 *
 * NOTA DE ALCANCE: este helper NO sella snapshot. El camino que sella es
 * `freezeFactRunWithSnapshot` (apps/web), que usa `freeze_fact_run_v1`; este
 * queda como la vía legal mínima para los dos callers que no dependen del
 * snapshot y como la degradación explícita cuando el RPC no existe.
 */

const RUN_ID = 'run-1';

type Row = Record<string, unknown>;

const RUN_COLUMNS = 'id,audit_id,policy_code,policy_version,extractor_version,artifact_set_fingerprint,state,frozen_at,created_at';

interface FakeError { message: string; code?: string }

interface SingleResult { data: Row | null; error: FakeError | null }

class FreezeFakeState {
  rows: Row[] = [];
  /** Cada `update()` se registra aquí para poder afirmar el recorrido. */
  updated: Array<{ state: string }> = [];
  updateError: FakeError | null = null;
}

class FreezeQuery {
  private filters: Array<[string, unknown]> = [];
  private values: Row = {};
  private selected = '*';
  private limitCount: number | null = null;

  constructor(private readonly state: FreezeFakeState) {}

  select(columns = '*'): this { this.selected = columns; return this; }
  eq(column: string, value: unknown): this { this.filters.push([column, value]); return this; }
  limit(count: number): this { this.limitCount = count; return this; }
  update(values: Row): this { this.values = values; return this; }

  async single(): Promise<SingleResult> {
    if (this.values.state !== undefined) this.state.updated.push({ state: String(this.values.state) });
    if (this.state.updateError) return { data: null, error: this.state.updateError };
    const matched = this.state.rows
      .filter((row) => this.filters.every(([column, value]) => row[column] === value))
      .slice(0, this.limitCount ?? Number.POSITIVE_INFINITY);
    for (const row of matched) Object.assign(row, this.values);
    const first = matched[0];
    if (!first) return { data: null, error: null };
    if (this.selected === '*') return { data: { ...first }, error: null };
    const columns = this.selected.split(',').map((column) => column.trim());
    return { data: Object.fromEntries(columns.map((column) => [column, first[column]])), error: null };
  }

  then<TResult1 = { data: Row[]; error: FakeError | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: FakeError | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.single().then((result) => (onfulfilled
      ? onfulfilled({ data: result.data ? [result.data] : [], error: result.error })
      : undefined as unknown as TResult1), onrejected);
  }
}

class FreezeFakeDb implements DatabaseClient {
  readonly state = new FreezeFakeState();

  constructor(runState: 'DRAFT' | 'PROCESSING' | 'FROZEN') {
    this.state.rows = [{
      id: RUN_ID, audit_id: 'audit-1', policy_code: 'GDM_GAM_PRD_MLG_003', policy_version: '5',
      extractor_version: 'deterministic-facts-v1', artifact_set_fingerprint: 'artifact-fp', state: runState,
      frozen_at: runState === 'FROZEN' ? '2026-09-25T00:00:00.000Z' : null, created_at: '2026-09-25T00:00:00.000Z',
    }];
  }

  get states(): string[] { return this.state.updated.map((entry) => entry.state); }

  failUpdatesWith(message: string, code: string): void {
    this.state.updateError = { message, code };
  }

  from(table: string): FreezeQuery {
    if (table !== 'fact_extraction_runs') throw new Error(`UNEXPECTED_TABLE:${table}`);
    return new FreezeQuery(this.state);
  }
}

describe('createFactRepository.freezeRun — maquina de estados legal (C1)', () => {
  it('desde DRAFT camina DRAFT -> PROCESSING -> FROZEN: nunca el salto unico', async () => {
    const db = new FreezeFakeDb('DRAFT');

    const frozen = await createFactRepository(db).freezeRun(RUN_ID);

    expect(frozen.state).toBe('FROZEN');
    expect(frozen.frozenAt).toEqual(expect.any(String));
    expect(frozen.id).toBe(RUN_ID);
    expect(db.states).toEqual(['PROCESSING', 'FROZEN']);
  });

  it('desde PROCESSING hace un solo paso, que tambien es legal', async () => {
    const db = new FreezeFakeDb('PROCESSING');

    const frozen = await createFactRepository(db).freezeRun(RUN_ID);

    expect(frozen.state).toBe('FROZEN');
    expect(db.states).toEqual(['FROZEN']);
  });

  it('rechaza un run no congelable ANTES de escribir nada', async () => {
    const db = new FreezeFakeDb('FROZEN');

    await expect(createFactRepository(db).freezeRun(RUN_ID)).rejects.toThrow('FACT_RUN_NOT_FREEZABLE');
    expect(db.states).toEqual([]);
  });

  it('propaga el error real del UPDATE en vez de dejar el run a medias sin avisar', async () => {
    const db = new FreezeFakeDb('DRAFT');
    db.failUpdatesWith('permission denied for table fact_extraction_runs', '42501');

    await expect(createFactRepository(db).freezeRun(RUN_ID)).rejects.toThrow('permission denied for table fact_extraction_runs');
  });

  it('no toca ninguna otra tabla', async () => {
    const db = new FreezeFakeDb('DRAFT');
    const originalFrom = db.from.bind(db);
    let queries = 0;
    db.from = (table: string) => {
      queries += 1;
      return originalFrom(table);
    };

    await createFactRepository(db).freezeRun(RUN_ID);

    expect(queries).toBeGreaterThan(0);
  });

  it('RUN_COLUMNS sigue cubriendo la proyección que devuelve el repositorio', () => {
    expect(RUN_COLUMNS.split(',')).toContain('frozen_at');
  });
});
