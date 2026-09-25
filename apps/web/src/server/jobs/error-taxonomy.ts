/**
 * ============================================================================
 * TAXONOMÍA DE ERRORES DEL PIPELINE
 * ============================================================================
 *
 * QUÉ SUSTITUYE
 * `executeClaimedJob` hacía `catch (error) { scheduleRetry(..., 'SYNTHETIC_TRANSIENT_ERROR', message, 30) }`.
 * Es decir: TODO error era transitorio y reintentable, y se etiquetaba con el
 * nombre de un fixture de test.
 *
 * POR QUÉ ESO ES UN DAÑO, NO UNA COSA MENOR
 * `FACT_RUN_NOT_PROCESSING: DRAFT` del incidente del 2026-09-25 es DETERMINISTA:
 * el run seguía en `DRAFT`, así que en el reintento seguía en `DRAFT`, y el
 * reintento también falló. Se gastaron 2 de 3 intentos en algo que no podía
 * funcionar. Peor: el nombre `SYNTHETIC_*` en producción hace que un fallo real
 * y uno de test sean indistinguibles en los logs, que es donde se busca la
 * causa.
 *
 * LA REGLA
 * Reintentar sólo lo que puede cambiar sin intervención. Todo lo demás es
 * terminal y requiere a una persona.
 *
 * OJO, y esto es lo contraintuitivo: un error DETERMINISTA que se reintenta no
 * es "un reintento de más". Es un job que se queda en RETRY_SCHEDULED sin poder
 * avanzar, que es exactamente el estado que mantuvo vivo el bucle del incidente.
 */

/** Reintentable: la misma entrada puede funcionar más tarde sin tocar nada. */
export type RetryableErrorCode =
  | 'TRANSIENT_PROVIDER_ERROR'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'DEPENDENCY_NOT_READY';

/** Terminal: reintentar es garantizadamente inútil. Requiere acción humana. */
export type TerminalErrorCode =
  | 'DETERMINISTIC_STATE_ERROR'
  | 'VALIDATION_ERROR'
  | 'SCHEMA_ERROR'
  | 'AUTH_ERROR'
  | 'PERMISSION_ERROR'
  | 'INVALID_INPUT'
  | 'PERSISTENCE_ERROR'
  | 'PROVIDER_PERMANENT_ERROR'
  /** Se envió al proveedor y no se sabe si aceptó. NUNCA se reintenta a ciegas. */
  | 'PROVIDER_RESULT_UNKNOWN'
  | 'UNSUPPORTED_JOB_TYPE';

export type JobErrorCode = RetryableErrorCode | TerminalErrorCode;

export interface ClassifiedError {
  code: JobErrorCode;
  retryable: boolean;
  /** Para errores de proveedor: si el coste ya pudo cobrarse. */
  costMayHaveBeenCharged: boolean;
  message: string;
}

/**
 * Códigos de error que hoy se tratan como transitorios y no lo son.
 *
 * La lista sale de leer el código, no de suponer: cada entrada corresponde a un
 * `RAISE EXCEPTION` real del SQL de migraciones o a una comprobación del
 * handler. Un error que no aparece aquí NO se clasifica como retryable por
 * defecto: se clasifica como terminal, porque lo seguro frente a un bucle es
 * detenerse.
 */
const TERMINAL_PATTERNS: ReadonlyArray<readonly [RegExp, TerminalErrorCode]> = [
  // --- Estado del Fact Run: el más importante del incidente ---
  [/FACT_RUN_NOT_PROCESSING/i, 'DETERMINISTIC_STATE_ERROR'],
  [/FACT_RUN_STATE_NOT_PROCESSABLE/i, 'DETERMINISTIC_STATE_ERROR'],
  [/FACT_RUN_NOT_FROZEN/i, 'DETERMINISTIC_STATE_ERROR'],
  [/PARENT_FACT_RUN_NOT_FROZEN/i, 'DETERMINISTIC_STATE_ERROR'],
  [/PARENT_FACT_RUN_MUTATED/i, 'DETERMINISTIC_STATE_ERROR'],

  // --- Identidad / autorización ---
  [/\bFORBIDDEN\b/, 'PERMISSION_ERROR'],
  [/AUTH_REQUIRED|UNAUTHORIZED/i, 'AUTH_ERROR'],
  [/\bPOLICY_SOURCE_NOT_REGISTERED\b/, 'VALIDATION_ERROR'],
  [/DERIVED_RUN_IDEMPOTENCY_COLLISION/i, 'DETERMINISTIC_STATE_ERROR'],

  // --- Payload y esquema: reintentar da el mismo error ---
  [/FACT_RUN_EMPTY|PROVENANCE_PAYLOAD_INVALID|FACTS_PAYLOAD_INVALID|FROZEN_SNAPSHOT_EMPTY|FROZEN_SNAPSHOT_PAYLOAD_INVALID/i, 'VALIDATION_ERROR'],
  [/FACT_COUNT_MISMATCH|PROVIDER_OPERATION_STATUS_INVALID|COST_SOURCE_INVALID/i, 'VALIDATION_ERROR'],
  [/DERIVED_FACT_TYPE_MISSING|FACT_RUN_ID_REQUIRED|REQUEST_FINGERPRINT_REQUIRED/i, 'INVALID_INPUT'],
  [/PGRST204|PGRST205|42P01|42703|undefined_column|undefined_table/i, 'SCHEMA_ERROR'],

  // --- Persistencia: un INSERT que viola una constraint no se arregla solo ---
  [/APPEND_ONLY_TABLE|APPARENTLY_IMMUTABLE|FACT_RUN_APPEND_ONLY|AUDIT_RUN_APPEND_ONLY|APPEND_ONLY/i, 'PERSISTENCE_ERROR'],
  [/duplicate key|23505|unique constraint/i, 'PERSISTENCE_ERROR'],
  [/violates not-null|violates foreign key|violates check/i, 'PERSISTENCE_ERROR'],
  [/invalid input syntax|violates exclusion/i, 'PERSISTENCE_ERROR'],

  // --- Proveedor: permanente significa permanente ---
  [/_API_KEY_NOT_CONFIGURED/i, 'PROVIDER_PERMANENT_ERROR'],
  [/PROVIDER_RESULT_UNKNOWN/i, 'PROVIDER_RESULT_UNKNOWN'],
  [/ASSEMBLYAI_TRANSCRIPTION_FAILED/i, 'PROVIDER_PERMANENT_ERROR'],
  // Un 4xx de proveedor es PERMANENTE: reintentarlo devuelve el mismo 4xx.
  // Se cubren los DOS órdenes porque los errores reales se construyen como
  // `OPENROUTER_ERROR_400` (nombre primero) y a veces como `400 ... provider`.
  [/PROVIDER[^\s]*_(?:400|401|403|404|405|409|413|422)\b/i, 'PROVIDER_PERMANENT_ERROR'],
  [/(?:ASSEMBLYAI|OPENROUTER)_(?:UPLOAD|TRANSCRIPT|POLL)?_?ERROR_(?:400|401|403|404|405|409|413|422)\b/i, 'PROVIDER_PERMANENT_ERROR'],
  [/\b(?:400|401|403|404|422)\b[^\n]{0,80}(?:PROVIDER|ASSEMBLYAI|OPENROUTER)/i, 'PROVIDER_PERMANENT_ERROR'],
  [/UNSUPPORTED_JOB_TYPE/i, 'UNSUPPORTED_JOB_TYPE'],
];

const RETRYABLE_PATTERNS: ReadonlyArray<readonly [RegExp, RetryableErrorCode]> = [
  [/DEPENDENCY_NOT_READY|_NOT_READY|PRECONDITION/i, 'DEPENDENCY_NOT_READY'],
  // Una evidencia que todavía no se ve puede ser retraso de replicación o un
  // job encolado antes de que la fila existiera. Reintentar es sensato; lo que
  // no es sensato es quemarlo como terminal. Nótese que `FACT_RUN_NOT_FOUND` NO
  // está aquí: ese sí es determinista y aparece arriba.
  //
  // ENOENT entra con EVIDENCE_NOT_FOUND porque un objeto de storage que aún no
  // está es la misma situación: la dependencia no está lista, no es inválida.
  // Sin esta línea, un fallo transitorio de lectura caía en el fallback
  // TERMINAL y quemaba los intentos: exactamente el defecto que se corrige.
  [/EVIDENCE_NOT_FOUND|STORAGE_DOWNLOAD_FAILED|\bENOENT\b/i, 'DEPENDENCY_NOT_READY'],
  [/\b429\b|rate.?limit|quota exceeded/i, 'RATE_LIMITED'],
  [/\b408\b|\btimed?.?out\b|ETIMEDOUT|ESOCKETTIMEDOUT|ABORT_ERR/i, 'TIMEOUT'],
  [/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network/i, 'NETWORK_ERROR'],
  [/\b5\d\d\b|bad gateway|service unavailable|gateway timeout|INTERNAL_ERROR/i, 'TRANSIENT_PROVIDER_ERROR'],
  [/ASSEMBLYAI_POLL_ERROR|ASSEMBLYAI_UPLOAD_ERROR|ASSEMBLYAI_TRANSCRIPT_ERROR|OPENROUTER_.*ERROR/i, 'TRANSIENT_PROVIDER_ERROR'],
];

/**
 * Clasifica un error. El orden importa: TERMINAL se evalúa primero, porque un
 * mensaje de proveedor puede contener un 4xx que no es transitorio, y porque
 * un error de estado que además menciona algo "transient" debe seguir siendo
 * terminal.
 */
export function classifyJobError(error: unknown, fallbackMessage?: string): ClassifiedError {
  const message = error instanceof Error ? error.message : (fallbackMessage ?? 'Error transitorio.');

  for (const [pattern, code] of TERMINAL_PATTERNS) {
    if (pattern.test(message)) {
      return {
        code,
        retryable: false,
        // Un 4xx de proveedor se rechaza antes de cobrar; el resto no se sabe.
        costMayHaveBeenCharged: code === 'PROVIDER_RESULT_UNKNOWN',
        message,
      };
    }
  }

  for (const [pattern, code] of RETRYABLE_PATTERNS) {
    if (pattern.test(message)) {
      return { code, retryable: true, costMayHaveBeenCharged: false, message };
    }
  }

  // Fallo de clasificación. Se elige TERMINAL a propósito.
  //
  // La alternativa ("reintentar por si acaso") es la que causó este incidente:
  // un error no reconocido se reintentaba, el reintento fallaba igual, y el job
  // se quedaba en RETRY_SCHEDULED. Ante la duda, PARAR es reversible: una
  // persona puede relanzar. Cobrar dos veces, no.
  return {
    code: 'DETERMINISTIC_STATE_ERROR',
    retryable: false,
    costMayHaveBeenCharged: false,
    message,
  };
}

/** Backoff con tope. El original usaba 30 s fijos para todo. */
export function retryDelaySeconds(attempt: number): number {
  const capped = Math.min(Math.max(attempt, 1), 6);
  return Math.min(30 * 2 ** (capped - 1), 15 * 60);
}
