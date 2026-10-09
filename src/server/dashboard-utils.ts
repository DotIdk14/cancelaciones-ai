// =============================================================================
// Dashboard — utilidades puras
// =============================================================================


// -----------------------------------------------------------------------------
// Utilidades puras
// -----------------------------------------------------------------------------

/**
 * Bucket de día en UTC. Se usa `toISOString()` y NUNCA la zona horaria local a
 * propósito: la serie temporal es un dato compartido, y si dependiera del
 * navegador, un caso de las 23:00 se contaría en un día distinto según dónde se
 * mirara la gráfica (en UTC−5, en el día anterior). Con UTC, dos personas ven el
 * mismo periodo aunque estén en paises distintos.
 */
export function utcDayBucket(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso.slice(0, 10);
  return new Date(ms).toISOString().slice(0, 10);
}

export function millisOf(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Porcentaje redondeado a 1 decimal. Nunca `NaN`: si no hay denominador, 0. */
export function percentage(part: number, total: number): number {
  if (total <= 0) return 0;
  const value = (part / total) * 100;
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

/** Redondeo a 3 decimales: quita el ruido de coma flotante sin perder precisión útil. */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
