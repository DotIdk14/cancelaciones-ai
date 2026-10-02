// =============================================================================
// Filtros del dashboard — validación de los query params de /api/dashboard/*.
// =============================================================================
// Aquí no hay lógica de negocio ni acceso a datos: solo se traduce el query
// string a un objeto `DashboardFilters` ya validado, o se responde 400 con un
// mensaje legible en español. El error crudo de Zod nunca sale de este archivo.
//
// Los `from`/`to` son DÍAS (`YYYY-MM-DD`), tal y como los define
// `src/lib/dashboard.ts` (única definición del tipo, también consumida por la
// UI). El paso a instantes UTC ocurre al construir los límites de la consulta
// (`startOfDayUtc` / `endOfDayUtc`), que es donde de verdad importa.
// =============================================================================

import { z } from 'zod';
import { AUDIT_RESULTS, CASE_STATUSES, type AuditResultType, type CaseStatus } from '../skills/audit/types.js';
import { defaultDateRange, type DashboardFilters, type DashboardDimension } from '../lib/dashboard.js';
import { ApiError, type QueryValue } from './http.js';

// Reexportado para que quien use el filtro no tenga que saber de dónde sale.
export type { DashboardFilters };

/** Rango por defecto cuando falta `from` o `to` (el de `defaultDateRange()`). */
export const DEFAULT_RANGE_DAYS = 30;

/** Tope duro del rango: más de esto se rechaza con 400. */
export const MAX_RANGE_DAYS = 365;

/** Por encima de este rango la agregación ya no es trivial: se avisa en logs. */
export const WARN_RANGE_DAYS = 90;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

// -----------------------------------------------------------------------------
// Días en UTC
// -----------------------------------------------------------------------------

/** Instante del primer milisegundo del día, en UTC. Límite INCLUSIVO de la consulta. */
export function startOfDayUtc(day: string): string {
  return `${day}T00:00:00.000Z`;
}

/** Instante del último milisegundo del día, en UTC. Límite INCLUSIVO de la consulta. */
export function endOfDayUtc(day: string): string {
  return `${day}T23:59:59.999Z`;
}

/** Días transcurridos entre dos días `YYYY-MM-DD` (sin horas: diferencia exacta). */
export function rangeDays(from: string, to: string): number {
  const fromMs = Date.parse(startOfDayUtc(from));
  const toMs = Date.parse(startOfDayUtc(to));
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return 0;
  return Math.round((toMs - fromMs) / MS_PER_DAY);
}

/** `true` solo si `YYYY-MM-DD` es una fecha real: `2026-02-31` no lo es. */
function isRealUtcDay(value: string): boolean {
  const ms = Date.parse(startOfDayUtc(value));
  if (Number.isNaN(ms)) return false;
  return new Date(ms).toISOString().slice(0, 10) === value;
}

// -----------------------------------------------------------------------------
// Esquema
// -----------------------------------------------------------------------------

const DaySchema = z
  .string({ invalid_type_error: 'Se esperaba una fecha.' })
  .trim()
  .regex(DATE_PATTERN, 'Usa el formato YYYY-MM-DD (por ejemplo, 2026-09-29).')
  .refine(isRealUtcDay, 'Esa fecha no existe en el calendario.');

/**
 * `result` y `status` son vocabularios CERRADOS: solo se aceptan los valores
 * de `AUDIT_RESULTS` y `CASE_STATUSES`. El mensaje de enum se sustituye para
 * que el 400 vaya en español y sin el texto por defecto de Zod.
 */
const ResultSchema = z.enum(AUDIT_RESULTS, {
  errorMap: () => ({ message: `Resultado no válido. Opciones: ${AUDIT_RESULTS.join(', ')}.` }),
});

const StatusSchema = z.enum(CASE_STATUSES, {
  errorMap: () => ({ message: `Estado no válido. Opciones: ${CASE_STATUSES.join(', ')}.` }),
});
const DimensionSchema = z
  .string()
  .trim()
  .min(1, 'El filtro no puede estar vacío.')
  .max(200, 'El filtro supera la longitud permitida.');

/** Forma de los query params ya normalizados (sin valores por defecto aún). */
export const DashboardFiltersQuerySchema = z
  .object({
    from: DaySchema,
    to: DaySchema,
    result: ResultSchema.optional(),
    status: StatusSchema.optional(),
    country: DimensionSchema.optional(),
    campus: DimensionSchema.optional(),
    modality: DimensionSchema.optional(),
    project: DimensionSchema.optional(),
    responsible: DimensionSchema.optional(),
    guideline: DimensionSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.to < value.from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'La fecha final no puede ser anterior a la inicial.',
      });
    }
    if (rangeDays(value.from, value.to) > MAX_RANGE_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: `El rango no puede superar ${MAX_RANGE_DAYS} días.`,
      });
    }
  });

/**
 * Lee un parámetro de la query. Rechaza arrays (`?result=A&result=B`): un valor
 * repetido es ambiguo y adivinar cuál vale sería inventar criterio.
 */
function readSingle(query: Record<string, QueryValue>, key: string): string | undefined {
  const value = query[key];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `El parámetro "${key}" se recibió varias veces: envía un solo valor.`);
  }
  return value;
}

/** Dimensiones que el cliente puede enviar pero que aún no existen en la vista. */
const ALL_DIMENSIONS: readonly DashboardDimension[] = [
  'country',
  'campus',
  'modality',
  'project',
  'responsible',
  'guideline',
];

/**
 * Allowlist de dimensiones que SÍ se pueden aplicar en PostgREST.
 * Actualmente ninguna está proyectada en la vista, así que cualquier filtro por
 * dimensión se rechaza ANTES de tocar la base.
 */
const SUPPORTED_DIMENSIONS: readonly DashboardDimension[] = [];

/** Rechaza filtros por dimensiones no disponibles con un 400 claro en español. */
function rejectUnsupportedDimensions(query: Record<string, QueryValue>): void {
  const unsupported = ALL_DIMENSIONS.filter((dim) => query[dim] !== undefined);
  if (unsupported.length === 0) return;
  const supported =
    SUPPORTED_DIMENSIONS.length > 0 ? SUPPORTED_DIMENSIONS.join(', ') : 'ninguna por el momento';
  throw new ApiError(
    400,
    'VALIDATION_ERROR',
    `Los filtros por dimensión (${unsupported.join(', ')}) no están disponibles. ` +
      `Dimensiones soportadas: ${supported}. Puedes filtrar por from, to, result y status.`,
  );
}

/** Primer mensaje de validación (ya redactado en español en este archivo). */
function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined || issue.message.length === 0) {
    return 'Los filtros del dashboard no son válidos.';
  }
  const field = issue.path[0];
  const prefix = typeof field === 'string' ? `Parámetro "${field}": ` : '';
  return `${prefix}${issue.message}`;
}

/**
 * Parsea y valida los query params del dashboard.
 * - `from`/`to` opcionales: si faltan se usa el rango de `defaultDateRange()`.
 * - `result`/`status` opcionales: `''` o ausentes significan "sin filtro".
 * - Lanza `ApiError(400, 'VALIDATION_ERROR', ...)` con mensaje en español.
 */
export function parseDashboardFilters(query: Record<string, QueryValue>): DashboardFilters {
  rejectUnsupportedDimensions(query);

  const defaults = defaultDateRange();
  const candidate = {
    from: readSingle(query, 'from') ?? defaults.from,
    to: readSingle(query, 'to') ?? defaults.to,
    result: readSingle(query, 'result') ?? undefined,
    status: readSingle(query, 'status') ?? undefined,
    country: readSingle(query, 'country') ?? undefined,
    campus: readSingle(query, 'campus') ?? undefined,
    modality: readSingle(query, 'modality') ?? undefined,
    project: readSingle(query, 'project') ?? undefined,
    responsible: readSingle(query, 'responsible') ?? undefined,
    guideline: readSingle(query, 'guideline') ?? undefined,
  };

  const parsed = DashboardFiltersQuerySchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', firstIssueMessage(parsed.error));
  }

  const from: string = parsed.data.from;
  const to: string = parsed.data.to;
  const result: AuditResultType | null = parsed.data.result ?? null;
  const status: CaseStatus | null = parsed.data.status ?? null;

  const days = rangeDays(from, to);
  if (days > WARN_RANGE_DAYS) {
    // Solo longitudes: ni identificadores, ni identificadores de estudiante, ni
    // las fechas concretas que pidió quien llama (eso puede ser un PII en un
    // nombre de caso y no hace falta para diagnosticar).
    console.warn(`[dashboard] rango amplio solicitado: ${days} días (aviso desde ${WARN_RANGE_DAYS} días)`);
  }

  // Construir el objeto de retorno incluyendo SOLO las dimensiones que el
  // cliente realmente envió. Esto evita que las pruebas (y consumidores) vean
  // claves con `null` cuando el usuario no solicitó el filtro.
  const out: Record<string, unknown> = { from, to, result, status };
  if (parsed.data.country !== undefined) out.country = parsed.data.country ?? null;
  if (parsed.data.campus !== undefined) out.campus = parsed.data.campus ?? null;
  if (parsed.data.modality !== undefined) out.modality = parsed.data.modality ?? null;
  if (parsed.data.project !== undefined) out.project = parsed.data.project ?? null;
  if (parsed.data.responsible !== undefined) out.responsible = parsed.data.responsible ?? null;
  if (parsed.data.guideline !== undefined) out.guideline = parsed.data.guideline ?? null;

  return out as unknown as DashboardFilters;
}
