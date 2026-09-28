// =============================================================================
// Formateadores de presentación. Solo presentación: ninguna regla de negocio.
// =============================================================================

/** Placeholder único para valores ausentes. */
export const DASH = '—';

const DATE_FMT = new Intl.DateTimeFormat('es-EC', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const DATETIME_FMT = new Intl.DateTimeFormat('es-EC', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function toDate(value: string | null | undefined): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `2024-03-01T12:00:00Z` -> `01 mar 2024`. */
export function formatDate(value: string | null | undefined): string {
  const date = toDate(value);
  return date ? DATE_FMT.format(date) : DASH;
}

/** `2024-03-01T12:00:00Z` -> `01 mar 2024, 12:00`. */
export function formatDateTime(value: string | null | undefined): string {
  const date = toDate(value);
  return date ? DATETIME_FMT.format(date) : DASH;
}

/** Tamaño legible para bytes. */
export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return DASH;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex] ?? 'KB'}`;
}

/** Prefijo corto de un identificador para mostrarlo en la UI. */
export function shortId(id: string | null | undefined, length = 8): string {
  if (typeof id !== 'string' || id.length === 0) return DASH;
  return id.length <= length ? id : id.slice(0, length);
}

/** Confianza 0..1 -> `87%`. Acepta también valores ya expresados en 0..100. */
export function formatPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DASH;
  const ratio = value > 1 ? value / 100 : value;
  return `${Math.round(ratio * 100)}%`;
}

/** Coste estimado en USD. */
export function formatCost(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DASH;
  return `$${value.toFixed(4)}`;
}

/** Segundos -> `mm:ss` (o `h:mm:ss`). */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return DASH;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

/** Latencia de la auditoría en ms -> texto corto. */
export function formatLatency(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return DASH;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Valor de un hecho del assessment (string | number | boolean | null). */
export function formatFactValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return DASH;
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'string') return value.trim() === '' ? DASH : value;
  if (!Number.isFinite(value)) return DASH;
  return new Intl.NumberFormat('es-EC').format(value);
}

/** Normaliza texto libre del modelo a un string presentable. */
export function textOrDash(value: string | null | undefined): string {
  return typeof value === 'string' && value.trim() !== '' ? value : DASH;
}
