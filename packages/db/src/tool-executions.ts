import { OPEN_TOOL_EXECUTION_STATUSES, type ToolExecutionStatus } from '@cancelaciones/shared';
import type { DatabaseClient } from './client';
import { asCount, asText } from './rows';

const TABLE = 'tool_executions';

const TOOL_EXECUTION_KINDS = ['EVIDENCE', 'POLICY', 'CASE', 'AUDIO', 'VISION', 'DATABASE'] as const;
export type ToolExecutionKind = (typeof TOOL_EXECUTION_KINDS)[number];

export interface ToolExecutionRecord {
  id: string;
  auditId: string;
  runId: string | null;
  name: string;
  kind: ToolExecutionKind;
  status: ToolExecutionStatus;
  input: unknown;
  output: unknown;
  idempotencyKey: string;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  timeoutAt: string | null;
}

export interface StartToolExecutionInput {
  auditId: string;
  runId?: string | null;
  name: string;
  kind: ToolExecutionKind;
  input: unknown;
  idempotencyKey: string;
  timeoutAt?: string | null;
}

const COLUMNS = [
  'id',
  'audit_id',
  'run_id',
  'name',
  'kind',
  'status',
  'input',
  'output',
  'idempotency_key',
  'attempts',
  'error_code',
  'error_message',
  'created_at',
  'started_at',
  'finished_at',
  'timeout_at',
].join(',');

interface Row {
  id: string;
  audit_id: string;
  run_id: string | null;
  name: string;
  kind: ToolExecutionKind;
  status: ToolExecutionStatus;
  input: unknown;
  output: unknown;
  idempotency_key: string;
  attempts: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  timeout_at: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toRecord(row: Row): ToolExecutionRecord {
  return {
    id: row.id,
    auditId: row.audit_id,
    runId: asText(row.run_id),
    name: row.name,
    kind: row.kind,
    status: row.status,
    input: row.input,
    output: row.output,
    idempotencyKey: row.idempotency_key,
    attempts: asCount(row.attempts),
    errorCode: asText(row.error_code),
    errorMessage: asText(row.error_message),
    createdAt: row.created_at,
    startedAt: asText(row.started_at),
    finishedAt: asText(row.finished_at),
    timeoutAt: asText(row.timeout_at),
  };
}

/**
 * Repositorio de `tool_executions`: la traza durable de cada llamada del agente.
 *
 * La idempotencia la aplica el servidor con su UNIQUE (audit_id,
 * idempotency_key), pero el repositorio la resuelve ANTES de insertar, porque la
 * reejecución no es un caso excepcional sino el normal: un agente que reintenta
 * tras un corte de red vuelve a llamar la misma operación, y sin esta lectura
 * previa cada reintento sería un 23505 que el llamador tendría que interpretar.
 */
export function createToolExecutionRepository(database: DatabaseClient) {
  async function findRowByKey(auditId: string, idempotencyKey: string): Promise<Row | null> {
    const { data, error } = await database
      .from(TABLE)
      .select(COLUMNS)
      .eq('audit_id', auditId)
      .eq('idempotency_key', idempotencyKey)
      .limit(1);

    if (error) throw new Error(error.message ?? 'No se pudo leer la ejecucion de la tool.');
    const rows = (data ?? []) as Row[];
    return rows.length > 0 ? rows[0] : null;
  }

  async function findRowById(id: string): Promise<Row | null> {
    const { data, error } = await database.from(TABLE).select(COLUMNS).eq('id', id).limit(1);
    if (error) throw new Error(error.message ?? `No se pudo leer la tool ${id}.`);
    const rows = (data ?? []) as Row[];
    return rows.length > 0 ? rows[0] : null;
  }

  async function write(id: string, columns: Record<string, unknown>): Promise<ToolExecutionRecord> {
    const { data, error } = await database.from(TABLE).update(columns).eq('id', id).select(COLUMNS).single();
    if (error) throw new Error(error.message ?? `No se pudo actualizar la tool ${id}.`);
    if (!data) throw new Error(`La tool ${id} desaparecio mientras se actualizaba.`);
    return toRecord(data as Row);
  }

  return {
    /**
     * Arranque idempotente de una tool.
     *
     * - No existe      -> se inserta en RUNNING con el primer intento contado.
     * - SUCCEEDED      -> se devuelve intacta. Repetir una operación que ya
     *   devolvió su resultado cobraría dos veces por lo mismo y devolvería dos
     *   transcripciones distintas si el proveedor no es determinista.
     * - FAILED         -> se reactiva a PENDING con los intentos a cero. Es un
     *   reintento manual explícito: quien lo pide sabe que la anterior falló y
     *   decide volver a pagar por esa llamada.
     * - PENDING/RUNNING/WAITING_EXTERNAL -> se devuelve intacta. Una tool viva
     *   tiene un reloj corriendo contra su timeout_at y quien la viva es el
     *   barrido, no un segundo arranque.
     */
    async start(input: StartToolExecutionInput): Promise<ToolExecutionRecord> {
      const existing = await findRowByKey(input.auditId, input.idempotencyKey);

      if (existing) {
        if (existing.status === 'FAILED') {
          return write(existing.id, {
            status: 'PENDING',
            attempts: 0,
            error_code: null,
            error_message: null,
            output: null,
            finished_at: null,
            started_at: null,
          });
        }
        return toRecord(existing);
      }

      const { data, error } = await database
        .from(TABLE)
        .insert([
          {
            audit_id: input.auditId,
            run_id: input.runId ?? null,
            name: input.name,
            kind: input.kind,
            status: 'RUNNING',
            input: input.input,
            idempotency_key: input.idempotencyKey,
            attempts: 1,
            timeout_at: input.timeoutAt ?? null,
            started_at: nowIso(),
          },
        ])
        .select(COLUMNS)
        .single();

      if (error) throw new Error(error.message ?? `No se pudo arrancar la tool ${input.name}.`);
      if (!data) throw new Error('La base no devolvio la tool recien arrancada.');
      return toRecord(data as Row);
    },

    async markWaitingExternal(id: string, output?: unknown): Promise<ToolExecutionRecord> {
      const columns: Record<string, unknown> = { status: 'WAITING_EXTERNAL' };
      if (output !== undefined) columns.output = output;
      return write(id, columns);
    },

    async succeed(id: string, output: unknown): Promise<ToolExecutionRecord> {
      return write(id, { status: 'SUCCEEDED', output, finished_at: nowIso(), error_code: null, error_message: null });
    },

    async fail(id: string, errorCode: string, errorMessage: string): Promise<ToolExecutionRecord> {
      return write(id, { status: 'FAILED', error_code: errorCode, error_message: errorMessage, finished_at: nowIso() });
    },

    async findById(id: string): Promise<ToolExecutionRecord | null> {
      const row = await findRowById(id);
      return row ? toRecord(row) : null;
    },

    async listByRun(runId: string): Promise<ToolExecutionRecord[]> {
      const { data, error } = await database
        .from(TABLE)
        .select(COLUMNS)
        .eq('run_id', runId)
        .order('created_at', { ascending: true });

      if (error) throw new Error(error.message ?? `No se pudieron listar las tools del run ${runId}.`);
      return ((data ?? []) as Row[]).map(toRecord);
    },

    async listByAudit(auditId: string): Promise<ToolExecutionRecord[]> {
      const { data, error } = await database
        .from(TABLE)
        .select(COLUMNS)
        .eq('audit_id', auditId)
        .order('created_at', { ascending: true });

      if (error) throw new Error(error.message ?? `No se pudieron listar las tools de ${auditId}.`);
      return ((data ?? []) as Row[]).map(toRecord);
    },

    /**
     * Tools abiertas cuyo `timeout_at` ya venció: exactamente el conjunto que
     * `sweep_stale_operations()` cierra con TOOL_TIMEOUT. Se lee antes de barrer
     * para poder avisar de lo que se va a cerrar en lugar de descubrirlo en el
     * log del sweep. Una tool sin `timeout_at` nunca caduca: no tiene reloj.
     */
    async listStale(now: Date): Promise<ToolExecutionRecord[]> {
      const { data, error } = await database
        .from(TABLE)
        .select(COLUMNS)
        .in('status', [...OPEN_TOOL_EXECUTION_STATUSES])
        .lt('timeout_at', now.toISOString())
        .order('timeout_at', { ascending: true });

      if (error) throw new Error(error.message ?? 'No se pudieron listar las tools caducadas.');
      return ((data ?? []) as Row[]).map(toRecord);
    },
  };
}

export type ToolExecutionRepository = ReturnType<typeof createToolExecutionRepository>;
