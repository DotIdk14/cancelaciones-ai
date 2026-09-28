import {
  canTransitionAuditRunStatus,
  isTerminalAuditRunStatus,
  type AuditRunStatus,
} from '@cancelaciones/shared';
import type { DatabaseClient } from './client';
import { NotFoundError, TerminalStateError } from './errors';
import { asCount, asText, asTextList } from './rows';

/** Fila de `audit_runs` con las columnas de la base en camelCase. */
export interface AuditRunRecord {
  id: string;
  auditId: string;
  runNumber: number;
  status: AuditRunStatus;
  evidenceFingerprint: string;
  policyCode: string | null;
  policyVersion: string | null;
  policySourceSha256: string | null;
  analystModel: string | null;
  analystPromptVersion: string | null;
  reviewerModel: string | null;
  reviewerPromptVersion: string | null;
  policySectionsConsulted: string[];
  toolCallCount: number;
  agentStepCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface CreateAuditRunInput {
  auditId: string;
  createdBy?: string | null;
  evidenceFingerprint: string;
  policyCode?: string | null;
  policyVersion?: string | null;
  policySourceSha256?: string | null;
  analystModel?: string | null;
  analystPromptVersion?: string | null;
  reviewerModel?: string | null;
  reviewerPromptVersion?: string | null;
}

export type AdvanceRunPatch = Partial<
  Pick<AuditRunRecord, 'policyCode' | 'policyVersion' | 'policySourceSha256' | 'errorCode' | 'errorMessage'>
>;

const TABLE = 'audit_runs';

const COLUMNS = [
  'id',
  'audit_id',
  'run_number',
  'status',
  'evidence_fingerprint',
  'policy_code',
  'policy_version',
  'policy_source_sha256',
  'analyst_model',
  'analyst_prompt_version',
  'reviewer_model',
  'reviewer_prompt_version',
  'policy_sections_consulted',
  'tool_call_count',
  'agent_step_count',
  'error_code',
  'error_message',
  'created_by',
  'created_at',
  'started_at',
  'finished_at',
].join(',');

interface Row {
  id: string;
  audit_id: string;
  run_number: number;
  status: AuditRunStatus;
  evidence_fingerprint: string | null;
  policy_code: string | null;
  policy_version: string | null;
  policy_source_sha256: string | null;
  analyst_model: string | null;
  analyst_prompt_version: string | null;
  reviewer_model: string | null;
  reviewer_prompt_version: string | null;
  policy_sections_consulted: string[] | null;
  tool_call_count: number | null;
  agent_step_count: number | null;
  error_code: string | null;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toRecord(row: Row): AuditRunRecord {
  return {
    id: row.id,
    auditId: row.audit_id,
    runNumber: asCount(row.run_number),
    status: row.status,
    evidenceFingerprint: asText(row.evidence_fingerprint) ?? '',
    policyCode: asText(row.policy_code),
    policyVersion: asText(row.policy_version),
    policySourceSha256: asText(row.policy_source_sha256),
    analystModel: asText(row.analyst_model),
    analystPromptVersion: asText(row.analyst_prompt_version),
    reviewerModel: asText(row.reviewer_model),
    reviewerPromptVersion: asText(row.reviewer_prompt_version),
    policySectionsConsulted: asTextList(row.policy_sections_consulted),
    toolCallCount: asCount(row.tool_call_count),
    agentStepCount: asCount(row.agent_step_count),
    errorCode: asText(row.error_code),
    errorMessage: asText(row.error_message),
    createdBy: asText(row.created_by),
    createdAt: row.created_at,
    startedAt: asText(row.started_at),
    finishedAt: asText(row.finished_at),
  };
}

function patchToColumns(patch: AdvanceRunPatch): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  if (patch.policyCode !== undefined) columns.policy_code = patch.policyCode;
  if (patch.policyVersion !== undefined) columns.policy_version = patch.policyVersion;
  if (patch.policySourceSha256 !== undefined) columns.policy_source_sha256 = patch.policySourceSha256;
  if (patch.errorCode !== undefined) columns.error_code = patch.errorCode;
  if (patch.errorMessage !== undefined) columns.error_message = patch.errorMessage;
  return columns;
}

/**
 * Repositorio de `audit_runs`: la unidad de trabajo durable de un dictamen.
 *
 * El grafo de transiciones NO se reimplementa aquí. Viene de
 * `@cancelaciones/shared` porque es la misma tabla de verdad que usa el motor y
 * que va a leer el reportador: duplicarlo haría que dos piezas dieran por bueno
 * lo que la otra no, y la que escribiese sobre un run terminal es exactamente
 * el daño que `guard_audit_run_immutability()` evita.
 */
export function createAuditRunRepository(database: DatabaseClient) {
  async function findRow(id: string): Promise<Row | null> {
    const { data, error } = await database.from(TABLE).select(COLUMNS).eq('id', id).limit(1);
    if (error) throw new Error(error.message ?? `No se pudo leer el run ${id}.`);
    const rows = (data ?? []) as Row[];
    return rows.length > 0 ? rows[0] : null;
  }

  async function requireRow(id: string): Promise<Row> {
    const row = await findRow(id);
    if (!row) throw new NotFoundError('audit_run', id);
    return row;
  }

  async function write(id: string, columns: Record<string, unknown>): Promise<AuditRunRecord> {
    const { data, error } = await database.from(TABLE).update(columns).eq('id', id).select(COLUMNS).single();
    if (error) throw new Error(error.message ?? `No se pudo actualizar el run ${id}.`);
    if (!data) throw new NotFoundError('audit_run', id);
    return toRecord(data as Row);
  }

  async function listByAudit(auditId: string): Promise<AuditRunRecord[]> {
    const { data, error } = await database
      .from(TABLE)
      .select(COLUMNS)
      .eq('audit_id', auditId)
      .order('run_number', { ascending: false });

    if (error) throw new Error(error.message ?? `No se pudieron listar los runs de ${auditId}.`);
    return ((data ?? []) as Row[]).map(toRecord);
  }

  /**
   * Avance de estado. Las dos guardas son deliberadamente distintas y en este
   * orden: primero el estado terminal, después la validez de la transición.
   *
   * Un run terminal lanza TerminalStateError aunque la transición pedida sea
   * legal en el grafo (COMPLETED -> COMPLETED es "válida" y está prohibida):
   * lo que se protege es la fila ya sellada, no la arista. Un error de
   * transición, en cambio, sí es culpa del llamador y por eso es un Error normal
   * con el prefijo que el barrido y los tests reconocen.
   */
  async function advance(id: string, status: AuditRunStatus, patch: AdvanceRunPatch = {}): Promise<AuditRunRecord> {
    const current = await requireRow(id);

    if (isTerminalAuditRunStatus(current.status)) {
      throw new TerminalStateError(
        `El run ${id} esta en estado terminal ${current.status} y no se reescribe: no puede pasar a ${status}.`,
      );
    }

    if (!canTransitionAuditRunStatus(current.status, status)) {
      throw new Error(`ILLEGAL_AUDIT_RUN_TRANSITION: ${current.status} -> ${status}`);
    }

    const columns: Record<string, unknown> = { ...patchToColumns(patch), status };

    // `finished_at` se sella al entrar en terminal, no al salir: un run que
    // termina y vuelve a fallar no puede tener dos finales.
    if (isTerminalAuditRunStatus(status)) {
      columns.finished_at = nowIso();
    } else if (asText(current.started_at) === null) {
      // `started_at` se marca la primera vez, no en cada avance: es cuándo
      // empezó el run, y cada transición es un instante distinto. La comparación
      // va sobre el valor coercionado porque la fila cruda trae `undefined` en
      // una columna que nunca se ha escrito, y `undefined === null` es false.
      columns.started_at = nowIso();
    }

    return write(id, columns);
  }

  return {
    /**
     * Alta de un run. `run_number` es correlativo dentro de la auditoría y lo
     * fija el servidor con su UNIQUE (audit_id, run_number); aquí sólo se
     * reserva el número siguiente leyendo el mayor existente.
     */
    async create(input: CreateAuditRunInput): Promise<AuditRunRecord> {
      const { data: lastRows, error: lastError } = await database
        .from(TABLE)
        .select('run_number')
        .eq('audit_id', input.auditId)
        .order('run_number', { ascending: false })
        .limit(1);

      if (lastError) throw new Error(lastError.message ?? 'No se pudo calcular el numero de run.');

      const existentes = (lastRows ?? []) as { run_number: number }[];
      const runNumber = (existentes.length > 0 ? existentes[0].run_number : 0) + 1;

      const { data, error } = await database
        .from(TABLE)
        .insert([
          {
            audit_id: input.auditId,
            run_number: runNumber,
            status: 'CREATED',
            evidence_fingerprint: input.evidenceFingerprint,
            policy_code: input.policyCode ?? null,
            policy_version: input.policyVersion ?? null,
            policy_source_sha256: input.policySourceSha256 ?? null,
            analyst_model: input.analystModel ?? null,
            analyst_prompt_version: input.analystPromptVersion ?? null,
            reviewer_model: input.reviewerModel ?? null,
            reviewer_prompt_version: input.reviewerPromptVersion ?? null,
            created_by: input.createdBy ?? null,
          },
        ])
        .select(COLUMNS)
        .single();

      if (error) throw new Error(error.message ?? 'No se pudo crear el run de auditoria.');
      if (!data) throw new Error('La base no devolvio el run recien creado.');
      return toRecord(data as Row);
    },

    async findById(id: string): Promise<AuditRunRecord | null> {
      const row = await findRow(id);
      return row ? toRecord(row) : null;
    },

    listByAudit,

    async latest(auditId: string): Promise<AuditRunRecord | null> {
      const [row] = await listByAudit(auditId);
      return row ?? null;
    },

    advance,

    async recordPolicySections(id: string, sections: string[]): Promise<AuditRunRecord> {
      const current = await requireRow(id);
      const acumuladas = [...asTextList(current.policy_sections_consulted)];
      for (const section of sections) {
        if (!acumuladas.includes(section)) acumuladas.push(section);
      }
      return write(id, { policy_sections_consulted: acumuladas });
    },

    /**
     * Suma contadores. Se suman y no se asignan porque quien los incrementa es
     * un agente que va llamando tool por tool: si se asignara el valor recibido,
     * dos llamadas concurrentes perderían el recuento de la primera.
     */
    async incrementCounters(id: string, patch: { toolCallCount?: number; agentStepCount?: number }): Promise<AuditRunRecord> {
      const current = await requireRow(id);
      const columns: Record<string, unknown> = {};
      if (patch.toolCallCount !== undefined) columns.tool_call_count = asCount(current.tool_call_count) + patch.toolCallCount;
      if (patch.agentStepCount !== undefined) columns.agent_step_count = asCount(current.agent_step_count) + patch.agentStepCount;
      if (Object.keys(columns).length === 0) return toRecord(current);
      return write(id, columns);
    },

    async fail(id: string, errorCode: string, errorMessage: string): Promise<AuditRunRecord> {
      return advance(id, 'FAILED', { errorCode, errorMessage });
    },
  };
}

export type AuditRunRepository = ReturnType<typeof createAuditRunRepository>;
