/**
 * Frontera neutral del motor de auditoría.
 *
 ## Estado
 *
 * El motor normativo de auditoría **NO ESTÁ CONECTADO**. La V2 del árbol de
 * decisión existe y está verificada (`packages/rule-engine-v2`, 65 reglas), y ya
 * existe una capa pura para construir hechos canónicos. La ruta real sigue
 * cerrada porque todavía no carga un `canonical_fact_run` congelado de la
 * auditoría subida ni conserva todo el contexto temporal capturado.
 *
 * La distinción importa porque son dos ausencias distintas. Antes de la V2, el
 * motor no existía. Ahora existe y aun así no debe ejecutarse sobre datos que no
 * sabe leer, porque produciría un `INSUFFICIENT_EVIDENCE` que parecería una
 * conclusión sobre el caso cuando en realidad es una conclusión sobre la
 * tubería.
 *
 * Las reglas de la V2 **no se derivan de aquí**. Deben nacer directamente del
 * procedimiento ownersupplied:
 *
 *     normative/GDM_GAM_PRD_MLG_003  PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES.docx.pdf
 *
 * Este módulo existe para que todo intento de ejecución normativa falle de
 * forma **explícita, ruidosa y accionable**, nunca mediante un fallback al
 * motor retirado.
 *
 * Una ausencia silenciosa (endpoint 404, no-op, resultado vacío) sería
 * indistinguible de "el auditor funciona y no encontró nada", y eso es
 * exactamente el modo de fallo que `UNKNOWN_IS_NOT_FALSE` prohíbe. Por eso el
 * error declara *qué* precondición falta y no sólo que falta algo.
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

/**
 * Precondición que impide ejecutar una capacidad.
 *
 * Existe para que el 501 sea una lista de trabajo y no un misterio. Un
 * `AUDIT_ENGINE_NOT_IMPLEMENTED` sin más información obliga a quien lo recibe a
 * investigar el motivo; con `unmetPreconditions` el mismo error dice qué falta
 * construir.
 */
export interface AuditEnginePrecondition {
  /** Identificador estable, apto para referenciarlo en issues y reportes. */
  readonly code: string;
  /** Qué falta, en una frase. Sin jerga de implementación. */
  readonly detail: string;
  /** Qué se desbloquea al cumplirla. */
  readonly unblocks: AuditEngineCapability;
}

/**
 * Precondiciones de la evaluación normativa.
 *
 * No dicen que el motor no exista. Dicen qué falta para que la ruta real use una
 * corrida canónica verificable en lugar de datos legacy o hechos vacíos.
 */
export const NORMATIVE_EVALUATION_PRECONDITIONS: readonly AuditEnginePrecondition[] = [
  {
    code: 'CANONICAL_FACT_PIPELINE_NOT_WIRED_TO_ROUTE',
    detail:
      'Ya existe adquisición canónica pura y un adaptador para mappings EXACT, ' +
      'pero el job real de evidencia aún no escribe una corrida canónica completa ' +
      'para la auditoría subida.',
    unblocks: 'normative-evaluation',
  },
  {
    code: 'CANONICAL_FACT_RUN_NOT_LOADED_BY_ROUTE',
    detail:
      'La ruta `/audit` todavía no selecciona un `canonical_fact_run` congelado, ' +
      'no reconstruye `EvaluateAuditInput` desde `canonical_facts` y no prueba ' +
      'la equivalencia con el fixture E2E.',
    unblocks: 'normative-evaluation',
  },
  {
    code: 'TEMPORAL_CONTEXT_NOT_CAPTURED_FOR_REAL_AUDIT',
    detail:
      'El formulario captura fechas operativas, pero la ruta real aún no garantiza ' +
      'un `TemporalContext` completo y con provenance para inicio de ciclo, fecha ' +
      'de solicitud, fecha de ingreso, inicio del primer ciclo y avance curricular.',
    unblocks: 'normative-evaluation',
  },
];

/** Precondición de una capacidad que sencillamente no se ha construido. */
function notBuilt(capability: AuditEngineCapability): AuditEnginePrecondition {
  return {
    code: 'CAPABILITY_NOT_IMPLEMENTED',
    detail: `La capacidad «${capability}» no está construida.`,
    unblocks: capability,
  };
}

/** Precondiciones que hoy bloquean cada capacidad. */
const PRECONDITIONS: Record<AuditEngineCapability, readonly AuditEnginePrecondition[]> = {
  'normative-evaluation': NORMATIVE_EVALUATION_PRECONDITIONS,
  'decision-trace': NORMATIVE_EVALUATION_PRECONDITIONS,
  'fact-run-freeze': [notBuilt('fact-run-freeze')],
  'evidence-assessment': [notBuilt('evidence-assessment')],
  'human-comparison': [notBuilt('human-comparison')],
  adjudication: [notBuilt('adjudication')],
  'report-snapshot': [notBuilt('report-snapshot')],
  'dictamen-generation': [notBuilt('dictamen-generation')],
};

/** Precondiciones que hoy impiden ejecutar una capacidad. */
export function unmetPreconditions(capability: AuditEngineCapability): readonly AuditEnginePrecondition[] {
  return PRECONDITIONS[capability];
}

/** Indica si la capacidad puede ejecutarse ahora mismo. */
export function isCapabilityAvailable(capability: AuditEngineCapability): boolean {
  return PRECONDITIONS[capability].length === 0;
}

export interface AuditEngineNotImplementedDetails {
  readonly code: typeof AUDIT_ENGINE_NOT_IMPLEMENTED;
  readonly capability: AuditEngineCapability;
  readonly normativeSource: typeof NORMATIVE_SOURCE_CODE;
  readonly reason: string;
  /** Qué falta construir para desbloquear la capacidad. */
  readonly unmetPreconditions: readonly AuditEnginePrecondition[];
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
  /** Qué falta construir para desbloquear la capacidad. */
  readonly unmetPreconditions: readonly AuditEnginePrecondition[];

  constructor(
    capability: AuditEngineCapability,
    reason = 'El motor de auditoría no puede ejecutar esta capacidad todavía.',
  ) {
    const unmet = PRECONDITIONS[capability];
    super(
      unmet.length > 0
        ? `${AUDIT_ENGINE_NOT_IMPLEMENTED}: ${capability}. ${reason} Precondiciones pendientes: ${unmet
            .map((item) => item.code)
            .join(', ')}.`
        : `${AUDIT_ENGINE_NOT_IMPLEMENTED}: ${capability}. ${reason}`,
    );
    this.name = 'AuditEngineNotImplementedError';
    this.capability = capability;
    this.reason = reason;
    this.unmetPreconditions = unmet;
  }

  toDetails(): AuditEngineNotImplementedDetails {
    return {
      code: this.code,
      capability: this.capability,
      normativeSource: this.normativeSource,
      reason: this.reason,
      unmetPreconditions: this.unmetPreconditions,
    };
  }
}

/**
 * Punto de falla único. Toda ejecución normativa debe pasar por aquí.
 *
 * Hoy **siempre lanza**, porque ninguna capacidad tiene sus precondiciones
 * cumplidas. La firma no devuelve `void` por descuido: cuando la migración de
 * hechos canónicos aterrice, este mismo punto delegará en el árbol de decisión
 * sin que cambien los doce llamadores.
 */
export function assertAuditEngineOperational(capability: AuditEngineCapability): never {
  throw new AuditEngineNotImplementedError(capability);
}

/** Indica si un error es la frontera de motor no implementado. */
export function isAuditEngineNotImplemented(error: unknown): error is AuditEngineNotImplementedError {
  return error instanceof AuditEngineNotImplementedError;
}
