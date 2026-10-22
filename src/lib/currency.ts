/** Conversión de presentación. Los importes del proveedor se conservan en USD. */
export const MXN_REFERENCE_RATE = Object.freeze({
  pesosPerUsd: 18.42,
  publishedOn: '2026-10-21',
  sourceUrl: 'https://www.diariooficial.gob.mx/indicadores.php',
});

export const MXN_CONVERSION_NOTE = 'Conversión de referencia: 1 USD = 18.4200 MXN · DOF, 21/10/2026. Tasa fija; no se actualiza automáticamente ni representa el cargo bancario.';

const mexicanPesos = new Intl.NumberFormat('es-MX', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

export function usdToMxn(value: number): number {
  return value * MXN_REFERENCE_RATE.pesosPerUsd;
}

/** Recibe USD y convierte una sola vez; nunca convierte costos desconocidos a cero. */
export function formatCostMxn(value: number | null | undefined, unavailable = 'No disponible'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return unavailable;
  return `$${mexicanPesos.format(usdToMxn(value))} MXN`;
}
