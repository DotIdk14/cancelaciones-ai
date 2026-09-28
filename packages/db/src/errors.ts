/**
 * Error de escritura sobre un estado que ya no admite cambios.
 *
 * Es distinto de un error de validación de la transición: una transición ilegal
 * es un error de quien la pidió (se corrigió el código que la pidió), mientras
 * que un estado terminal es una propiedad de la fila que no depende de quién
 * escriba. Por eso tiene tipo propio: el que llama necesita poder distinguir
 * "reintenta con otra transición" de "esto ya está sellado, no lo intentes".
 */
export class TerminalStateError extends Error {
  readonly code = 'TERMINAL_STATE';

  constructor(message: string) {
    super(message);
    this.name = 'TerminalStateError';
  }
}

/** La fila que se pidió no existe. `entity` es la tabla, `id` la clave buscada. */
export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND';

  constructor(entity: string, id: string) {
    super(`No existe ${entity} con id "${id}".`);
    this.name = 'NotFoundError';
  }
}
