/**
 * Logs operativos estructurados.
 *
 * QUÉ ES
 * Un log de una línea por evento técnico del pipeline, con los identificadores
 * necesarios para correlacionar y NADA del contenido de la evidencia.
 *
 * QUÉ NO ES — y por qué está aislado en un módulo
 * Este módulo es la fronteira de PII del logging. Es el único sitio autorizado
 * a escribir eventos del pipeline, y acepta un conjunto cerrado de campos. No
 * exporta una función `log(cualquierCosa)`: si pudiera, el primer uso sería
 * `log({ event: 'EVAL', payload: evaluation })` y habríamos convertido los logs
 *     de Vercel en una segunda copia de la base de datos, con los nombres, correos y
 *     teléfonos de los estudiantes dentro, en un sistema que se indexa, se conserva
 *     y al que acceden más personas que a la propia base.
 *
 * Por eso:
 *   - Los campos permitidos son identificadores, estados, reason codes,
 *     fingerprints y duraciones. Ninguno contiene un valor de hecho.
 *   - `auditId`, `factRunId`, `engineRunId` son UUID: localizan el registro sin
 *     revelar su contenido.
 *   - `ruleId` es un identificador de regla del GDM, no dato personal.
 *   - NO se acepta `details`, `payload`, `evaluation`, `facts` ni texto libre.
 *     El tipo lo impide, no la disciplina de quien lo use.
 *
 * `fingerprint` sí se permite: es un hash, no un dato, y es imprescindible para
 * responder "este resultado salió con estos hechos" (§29 del encargo).
 *
 * El trace auditable NO sale de aquí. Sale de la base de datos. Estos logs son
 * para fallos técnicos; la explicación de una auditoría se obtiene de
 * `decision-trace`, que es durable y reproducible.
 */

export type PolicyLogEvent =
  | 'FACT_RUN_SELECTED'
  | 'FACT_RUN_PROCESSING_STARTED'
  | 'FACT_RUN_PROCESSING_RESUMED'
  | 'FACT_RUN_ALREADY_FROZEN'
  | 'FACT_RUN_FROZEN'
  | 'JOB_CLAIMED'
  | 'JOB_COMPLETED'
  | 'JOB_RETRY_SCHEDULED'
  | 'JOB_TERMINAL_FAILURE'
  | 'PROVIDER_OPERATION_STARTED'
  | 'PROVIDER_OPERATION_SUCCEEDED'
  | 'PROVIDER_OPERATION_FAILED'
  | 'FROZEN_FACTS_LOADED'
  | 'POLICY_EVALUATION_STARTED'
  | 'POLICY_EVALUATION_COMPLETED'
  | 'POLICY_EVALUATION_FAILED'
  | 'POLICY_PERSISTENCE_COMPLETED'
  | 'POLICY_PERSISTENCE_FAILED'
  | 'HUMAN_CORRECTION_STARTED'
  | 'HUMAN_CORRECTION_COMPLETED'
  | 'HUMAN_CORRECTION_FAILED'
  | 'DECISION_TRACE_BUILT'
  | 'DECISION_TRACE_READ_FAILED';

/**
 * Conjunto CERRADO y explícito. Añadir un campo aquí es una decisión, no una
 * comodidad: obliga a decidir si ese dato puede estar en un log.
 */
export interface PolicyLogFields {
  // `null` se acepta a propósito: los ids vienen de datos opcionales y escribir
  // `x ?? undefined` en cada llamada sólo mueve el problema. El filtro de
  // ejecución los descarta igual que los `undefined`.
  auditId?: string | null;
  jobId?: string | null;
  attemptId?: string | null;
  factRunId?: string | null;
  engineRunId?: string | null;
  ruleId?: string | null;
  reasonCode?: string;
  code?: string;
  stage?: string;
  policyCode?: string;
  policyVersion?: string;
  decisionStatus?: string;
  outcomeStatus?: string;
  suggestedOutcome?: string | null;
  extractorVersion?: string;
  factsFingerprint?: string | null;
  rulesFingerprint?: string | null;
  transport?: string;
  degradation?: string | null;
  factCount?: number;
  durationMs?: number;
}

const ALLOWED = new Set<keyof PolicyLogFields>([
  'auditId', 'jobId', 'attemptId', 'factRunId', 'engineRunId', 'ruleId', 'reasonCode', 'code', 'stage',
  'policyCode', 'policyVersion', 'decisionStatus', 'outcomeStatus', 'suggestedOutcome',
  'extractorVersion', 'factsFingerprint', 'rulesFingerprint', 'transport', 'degradation',
  'factCount', 'durationMs',
]);

/** Emite una sola línea JSON. Nunca lanza: un log roto no puede tumbar el pipeline. */
export function logPolicyEvent(event: PolicyLogEvent, fields: PolicyLogFields = {}): void {
  try {
    const safe: Record<string, unknown> = {};
    for (const key of Object.keys(fields) as Array<keyof PolicyLogFields>) {
      if (!ALLOWED.has(key)) continue;
      const value = fields[key];
      if (value === undefined || value === null) continue;
      // Los fingerprints son los únicos campos largos que se permiten.
      safe[key] = typeof value === 'string' && key.endsWith('Fingerprint') ? value.slice(0, 64) : value;
    }
    // `console.warn` y no `console.log`: en Vercel los warnings sobreviven al
    // agrupado de stdout, y un evento de pipeline completed no debe perderse.
    console.warn(JSON.stringify({ event, ...safe }));
  } catch {
    /* Un log que falla es un log que no se escribe. Nunca propagar. */
  }
}

/** `performance.now()` si existe; el reloj del proceso es secundario y no es normativo. */
export function startTimer(): () => number {
  const started = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
  return () => Math.max(0, Math.round((typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()) - started));
}
