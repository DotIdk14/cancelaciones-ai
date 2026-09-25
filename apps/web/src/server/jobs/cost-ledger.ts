import { createHash } from 'node:crypto';
import type { DatabaseClient } from '@cancelaciones/db';

/**
 * ============================================================================
 * LEDGER DE COSTE DE PROVEEDORES
 * ============================================================================
 *
 * PROBLEMA QUE RESUELVE
 * En producción, `public.ai_usage` tenía 0 filas mientras los handlers llamaban
 * a AssemblyAI y OpenRouter de verdad. Es decir: el gasto era invisible. Una
 * fuga de coste por un bug de reintentos habría sido INDETECTABLE, y no por
 * falta de datos sino por falta de registro.
 *
 * LA REGLA DE ORO
 *
 *     NULL != 0
 *
 * `estimated_cost_usd = NULL` significa DESCONOCIDO. `0` significa GRATIS.
 * Poner 0 cuando no se sabe el precio es afirmar algo falso, y unledger lleno
 * de ceros falsos es PEOR que un ledger vacío: parece que se controló el gasto
 * cuando en realidad no se midió. Por eso `cost_source` es obligatorio y
 * `UNKNOWN` es un valor de primera clase.
 *
 * EL COSTO NUNCA INFLUYE EN LA DECISIÓN
 * Este módulo no importa `evaluatePolicy` ni escribe en nada que el motor lea.
 * El costo es telemetría. Si algún día el outcome dependiera del costo, el
 * mismo hecho se usaría para dos fines incompatibles y dejaría de ser
 * explicable.
 *
 * POLL NO ES UNA OPERACIÓN PAGADA
 * Consultar el estado de una transcripción no cuesta dinero. Se registra con
 * `billable: false` y no genera fila de coste. Si no se distinguiera, un poll
 * cada 3 segundos inflaría el gasto registrado y haría inútil el control.
 */

/** De dónde sale el número. Obligatorio: sin él, el número no significa nada. */
export type CostSource = 'PROVIDER_REPORTED' | 'CALCULATED' | 'ESTIMATED' | 'UNKNOWN';

export interface ProviderUsage {
  provider: string;
  operation: string;
  model: string | null;
  inputUnits: number | null;
  outputUnits: number | null;
  unitType: string | null;
  /** NULL = desconocido. Nunca 0 por defecto. */
  costUsd: number | null;
  costSource: CostSource;
  /** Id de la operación en el proveedor, si lo devuelve. */
  externalOperationId: string | null;
}

/**
 * Huella estable de una operación LÓGICA pagada.
 *
 * Incluye el input porque dos llamadas con el mismo (audit, job, stage) pero
 * contenido distinto son dos operaciones distintas y deben cobrarse como
 * tales. No incluye `attempt` a propósito: el reintento del MISMO trabajo tiene
 * que producir la MISMA huella, que es lo que hace que se reutilice en vez de
 * volver a pagarse.
 */
export function requestFingerprint(parts: {
  auditId: string;
  jobId: string | null;
  stage: string;
  input: string;
}): string {
  return createHash('sha256')
    .update([parts.auditId, parts.jobId ?? '-', parts.stage, parts.input].join('|'))
    .digest('hex');
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Lee el uso de una respuesta de OpenRouter.
 *
 * Los campos se leen de forma DEFENSIVA a propósito. Esta función se escribe
 * sin poder hacer una llamada real, y la API puede añadir o cambiar campos. Un
 * `as` que presupone la forma convierte un campo que falte en un `undefined`
 * silencioso que acaba guardándose como si fuera un dato. Aquí, lo que no está
 * se devuelve como NULL y por tanto como desconocido, que es la verdad.
 */
export function readOpenRouterUsage(body: unknown): ProviderUsage {
  const record = (body ?? {}) as Record<string, unknown>;
  const usage = (record.usage ?? {}) as Record<string, unknown>;
  // OpenRouter puede reportar el coste dentro de usage; si no, no lo hay.
  const reportedCost = num(usage.cost) ?? num((usage.cost_details as Record<string, unknown> | undefined)?.upstream_inference_cost);

  return {
    provider: 'OPENROUTER',
    operation: 'CHAT_COMPLETIONS',
    model: typeof record.model === 'string' ? record.model : null,
    inputUnits: num(usage.prompt_tokens) ?? num(usage.input_tokens),
    outputUnits: num(usage.completion_tokens) ?? num(usage.output_tokens),
    unitType: 'TOKENS',
    costUsd: reportedCost,
    costSource: reportedCost === null ? 'UNKNOWN' : 'PROVIDER_REPORTED',
    externalOperationId: typeof record.id === 'string' ? record.id : null,
  };
}

/**
 * Lee el resultado de una transcripción de AssemblyAI.
 *
 * `audio_duration` es la unidad facturable real de AssemblyAI (segundos de
 * audio), no los tokens. Se registra como tal. El polling nunca llama a esto.
 */
export function readAssemblyAiUsage(body: unknown, externalOperationId: string | null): ProviderUsage {
  const record = (body ?? {}) as Record<string, unknown>;
  const duration = num(record.audio_duration);
  return {
    provider: 'ASSEMBLYAI',
    operation: 'TRANSCRIPT',
    model: typeof record.model === 'string' ? record.model : 'best',
    inputUnits: duration,
    outputUnits: null,
    unitType: 'AUDIO_SECONDS',
    // AssemblyAI no devuelve coste por operación. Sin pricing configurado y
    // versionado, el coste es desconocido. No se inventa.
    costUsd: null,
    costSource: 'UNKNOWN',
    externalOperationId: externalOperationId ?? (typeof record.id === 'string' ? record.id : null),
  };
}

/** Consulta el ledger antes de pagar. Devuelve la operación si ya existe. */
export async function beginProviderOperation(input: {
  database: DatabaseClient;
  jobId: string | null;
  attemptId: string | null;
  evidenceId: string | null;
  provider: string;
  operationType: string;
  fingerprint: string;
  billable: boolean;
}): Promise<{ providerOperationId: string | null; status: string; shouldExecute: boolean; externalOperationId: string | null }> {
  const fallback = { providerOperationId: null, status: 'UNAVAILABLE', shouldExecute: true, externalOperationId: null };
  if (typeof input.database.rpc !== 'function') return fallback;
  try {
    const { data, error } = await input.database.rpc('begin_provider_operation_v1', {
      p_job_id: input.jobId,
      p_attempt_id: input.attemptId,
      p_evidence_id: input.evidenceId,
      p_provider: input.provider,
      p_operation_type: input.operationType,
      p_request_fingerprint: input.fingerprint,
      p_billable: input.billable,
    });
    if (error) return fallback;
    const row = ((data ?? []) as Array<Record<string, unknown>>)[0];
    if (!row) return fallback;
    return {
      providerOperationId: row.out_provider_operation_id ? String(row.out_provider_operation_id) : null,
      status: String(row.out_status ?? 'UNKNOWN'),
      shouldExecute: row.out_should_execute === true,
      externalOperationId: row.out_external_operation_id ? String(row.out_external_operation_id) : null,
    };
  } catch {
    // Si el ledger no está disponible, se ejecuta igual y se registra el hueco.
    // La alternativa sería bloquear el pipeline por un problema de telemetría, y
    // no procesar una auditoría es un daño mayor que no medir su coste.
    return fallback;
  }
}

export async function completeProviderOperation(input: {
  database: DatabaseClient;
  providerOperationId: string | null;
  status: 'SUCCEEDED' | 'FAILED' | 'RESULT_UNKNOWN';
  externalOperationId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  if (!input.providerOperationId || typeof input.database.rpc !== 'function') return;
  try {
    await input.database.rpc('complete_provider_operation_v1', {
      p_provider_operation_id: input.providerOperationId,
      p_status: input.status,
      p_external_operation_id: input.externalOperationId ?? null,
      p_error_code: input.errorCode ?? null,
      p_error_message: input.errorMessage ?? null,
    });
  } catch {
    /* Un ledger que no se cierra es un hueco de telemetría, no un fallo de negocio. */
  }
}

/**
 * Escribe el uso. Exactly-once: el índice único
 * (provider, operation, request_fingerprint) convierte un reintento en un
 * no-op, no en una segunda fila de coste.
 */
export async function recordAiUsage(input: {
  database: DatabaseClient;
  auditId: string;
  jobId: string | null;
  attemptId: string | null;
  evidenceId: string | null;
  fingerprint: string;
  providerOperationId: string | null;
  usage: ProviderUsage;
}): Promise<boolean> {
  if (typeof input.database.rpc !== 'function') return false;
  try {
    const { data, error } = await input.database.rpc('record_ai_usage_v1', {
      p_audit_id: input.auditId,
      p_job_id: input.jobId,
      p_attempt_id: input.attemptId,
      p_evidence_id: input.evidenceId,
      p_provider: input.usage.provider,
      p_operation: input.usage.operation,
      p_request_fingerprint: input.fingerprint,
      p_provider_operation_id: input.providerOperationId,
      p_model: input.usage.model,
      p_unit_type: input.usage.unitType,
      p_input_units: input.usage.inputUnits,
      p_output_units: input.usage.outputUnits,
      p_unit_price_usd: null,
      p_estimated_cost_usd: input.usage.costUsd,
      p_currency: 'USD',
      p_cost_source: input.usage.costSource,
      p_provider_request_id: input.usage.externalOperationId,
    });
    if (error) return false;
    return ((data ?? []) as Array<Record<string, unknown>>)[0]?.out_recorded === true;
  } catch {
    return false;
  }
}

export interface AuditCostSummary {
  auditId: string;
  /** Suma de los costes CONOCIDOS. No es el gasto total si hay desconocidos. */
  knownCostUsd: number;
  /** Operaciones cuyo coste no se conoce. Esto es lo que hace la cifra incompleta. */
  unknownCostEvents: number;
  providerCallCount: number;
  providers: string[];
  models: string[];
  events: Array<{
    id: string;
    provider: string;
    operation: string;
    model: string | null;
    inputUnits: number | null;
    outputUnits: number | null;
    unitType: string | null;
    costUsd: number | null;
    costKnown: boolean;
    recordedAt: string | null;
  }>;
}

/**
 * Resume el coste de UNA auditoría.
 *
 * Se separa `knownCostUsd` de `unknownCostEvents` a propósito. Un único total
 * sería mentira en cuanto hay una operación sin precio conocido, y una mentira
 * que se ve en la UI es peor que un dato partido.
 *
 * LECTURA, no cálculo de política: nada aquí alimenta una decisión.
 */
export async function buildAuditCostSummary(input: { database: DatabaseClient; auditId: string }): Promise<AuditCostSummary> {
  const empty: AuditCostSummary = {
    auditId: input.auditId, knownCostUsd: 0, unknownCostEvents: 0, providerCallCount: 0,
    providers: [], models: [], events: [],
  };
  try {
    const { data, error } = await input.database
      .from('ai_usage')
      .select('id,provider,operation,model,input_units,output_units,unit_type,estimated_cost_usd,recorded_at')
      .eq('audit_id', input.auditId)
      .order('recorded_at', { ascending: true })
      .limit(500);
    if (error) return empty;

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    let known = 0;
    let unknown = 0;
    const providers = new Set<string>();
    const models = new Set<string>();

    const events = rows.map((row) => {
      const record = row as Record<string, unknown>;
      const cost = num(record.estimated_cost_usd);
      const provider = String(record.provider ?? 'UNKNOWN');
      providers.add(provider);
      if (typeof record.model === 'string' && record.model) models.add(record.model);
      if (cost === null) unknown += 1; else known += cost;
      return {
        id: String(record.id),
        provider,
        operation: String(record.operation ?? 'UNKNOWN'),
        model: typeof record.model === 'string' ? record.model : null,
        inputUnits: num(record.input_units),
        outputUnits: num(record.output_units),
        unitType: typeof record.unit_type === 'string' ? record.unit_type : null,
        costUsd: cost,
        costKnown: cost !== null,
        recordedAt: typeof record.recorded_at === 'string' ? record.recorded_at : null,
      };
    });

    return {
      auditId: input.auditId,
      knownCostUsd: Number(known.toFixed(6)),
      unknownCostEvents: unknown,
      providerCallCount: rows.length,
      providers: [...providers].sort(),
      models: [...models].sort(),
      events,
    };
  } catch {
    return empty;
  }
}
