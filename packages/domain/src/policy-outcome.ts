/**
 * Vocabulario normativo compartido.
 *
 * Estos tipos viven en `domain` porque describen el vocabulario del
 * procedimiento, no la mecánica del motor. `policy-engine` los re-exporta
 * para no romper a sus consumidores.
 *
 * POLICY_IS_IMMUTABLE: los valores de estas uniones son los que el
 * procedimiento reconoce. No agregar, renombrar ni eliminar miembros.
 */

/** Estado de cierre normativo de la evaluación. */
export type OutcomeStatus = 'DETERMINED' | 'DETERMINED_WITH_WARNINGS' | 'CONFLICTED' | 'INDETERMINATE' | 'SUPPORTED' | 'PROBABLE' | 'UNCERTAIN' | 'INSUFFICIENT_EVIDENCE' | 'POLICY_VALIDATION_FAILED';

/** Resoluciones normativas reales del procedimiento. */
export type Outcome = 'CANCELACION_VENTA' | 'BAJA' | 'CANCELACION_VENTA_OPERATIVA' | 'CANCELACION_MATRICULA' | 'RETENCION' | 'NO_APLICA_CANCELACION_VENTA';
