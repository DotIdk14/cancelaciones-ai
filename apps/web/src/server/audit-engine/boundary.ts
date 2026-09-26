/**
 * Frontera neutral del motor de auditoría.
 *
 ## Estado
 *
 * El motor de auditoría **NO EXISTE**. Fue retirado deliberadamente durante la
 * fase *clean slate* porque su implementación violaba `POLICY_IS_IMMUTABLE`:
 * cubría aproximadamente el 7% de los incisos normativos de
 * `GDM_GAM_PRD_MLG_003` y podía emitir un resultado contrario al procedimiento.
 *
 * Las reglas de la V2 **no se derivan de aquí**. Deben nacer directamente del
 * procedimiento ownersupplied:
 *
 *     normative/GDM_GAM_PRD_MLG_003  PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES.docx.pdf
 *
 * Este módulo existe para que toda intento de ejecución normativa falle de
 * forma **explícita y ruidosa**, nunca mediante un fallback al motor retirado.
 *
 * Una ausencia silenciosa (endpoint 404, no-op, resultado vacío) sería
 * indistinguible de "el auditor funciona y no encontró nada", y eso es
 * exactamente el modo de fallo que `UNKNOWN_IS_NOT_FALSE` prohíbe.
 */

/** Código de error estable para toda ejecución normativa no disponible. */
export const AUDIT_ENGINE_NOT_IMPLEMENTED = 'AUDIT_ENGINE_NOT_IMPLEMENTED' as const;

/** Documento normativo que gobierna la V2. */
export const NORMATIVE_SOURCE_CODE = 'GDM_GAM_PRD_MLG_003' as const;

/**
 * Capacidades que requieren un resultado normativo y por tanto no pueden
 * ejecutarse. Se enumeran para que la UI pueda desactivar acciones en vez de
 * ofrecer un botón que promete un dictamen.
 */
export const AUDIT_ENGINE_CAPABILITIES = [
  'fact-run-freeze',
  'normative-evaluation',
  'decision-trace',
  'evidence-assessment',
  'human-comparison',
  'adjudication',
  'report-snapshot',
  'dictamen-generation',
] as const;

export type AuditEngineCapability = (typeof AUDIT_ENGINE_CAPABILITIES)[number];

export interface AuditEngineNotImplementedDetails {
  readonly code: typeof AUDIT_ENGINE_NOT_IMPLEMENTED;
  readonly capability: AuditEngineCapability;
  readonly normativeSource: typeof NORMATIVE_SOURCE_CODE;
  readonly reason: string;
}

/**
 * Error de frontera. Se lanza, no se captura para degradar: cualquier ruta que
 * dependa de un resultado normativo debe propagarlo.
 */
export class AuditEngineNotImplementedError extends Error {
  readonly code = AUDIT_ENGINE_NOT_IMPLEMENTED;
  readonly status = 501;
  readonly capability: AuditEngineCapability;
  readonly normativeSource = NORMATIVE_SOURCE_CODE;
  /** Motivo legible del bloqueo. Sin efecto normativo. */
  readonly reason: string;

  constructor(capability: AuditEngineCapability, reason = 'El motor de auditoría aún no ha sido implementado.') {
    super(`${AUDIT_ENGINE_NOT_IMPLEMENTED}: ${capability}`);
    this.name = 'AuditEngineNotImplementedError';
    this.capability = capability;
    this.reason = reason;
  }

  toDetails(): AuditEngineNotImplementedDetails {
    return {
      code: this.code,
      capability: this.capability,
      normativeSource: this.normativeSource,
      reason: this.message,
    };
  }
}

/**
 * Punto de falla único. Toda ejecución normativa debe pasar por aquí.
 *
 * Esta función **siempre lanza**. Cuando exista la V2, el cuerpo delegará en
 * el árbol de decisión; hasta entonces no hay ruta alternativa.
 */
export function assertAuditEngineOperational(capability: AuditEngineCapability): never {
  throw new AuditEngineNotImplementedError(capability);
}

/** Indica si un error es la frontera de motor no implementado. */
export function isAuditEngineNotImplemented(error: unknown): error is AuditEngineNotImplementedError {
  return error instanceof AuditEngineNotImplementedError;
}
