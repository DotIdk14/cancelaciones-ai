/**
 * Coerciones de fila compartidas por todos los repositorios.
 *
 * Los registros que devuelven los repositorios declaran `string | null` y
 * `number`, no `string | undefined`. La diferencia parece menor y no lo es: un
 * `undefined` que se escapa a un `=== null`, a un `?? 'sin dato'` o a un `JSON`
 * que se guarda produce una columna nula en un sitio y un `null` en otro para la
 * misma ausencia. Convertir en la frontera (al leer la fila) deja un solo
 * criterio de "no hay dato" en todo el paquete.
 *
 * No se convierte en la frontera de escritura a propósito: `undefined` en un
 * patch de actualización significa "no toques esta columna", que es información
 * que la fila de destino no debe perder.
 */
export function asText(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

export function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function asTextList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}
