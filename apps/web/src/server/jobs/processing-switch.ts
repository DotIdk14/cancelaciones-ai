/**
 * ============================================================================
 * KILL SWITCH DE PROCESAMIENTO COSTOSO
 * ============================================================================
 *
 * QUÉ ES
 * Un interruptor server-side que impide por completo invocar proveedores externos
 * (AssemblyAI, OpenRouter, OCR) sin tocar el resto de la aplicación.
 *
 * POR QUÉ EXISTE
 * Hay una clase de incidente en la que el pipeline puede reintentar llamadas
 * pagadas. El 2026-09-25 no hubo coste duplicado, pero la única razón fue que
 * el claim con lease aguantó; no porque existiera un freno. Un freno que depende
 * de que otra cosa funcione correctamente no es un freno.
 *
 * QUÉ NO HACE
 *   - No apaga el pipeline: las rutas de lectura siguen sirviendo.
 *   - No apaga la trazabilidad: el Decision Trace sigue funcionando, porque
 *     leer lo ya persistido no cuesta dinero y es justamente lo que se necesita
 *     para diagnosticar.
 *   - No borra ni modifica jobs. Un job que no se ejecuta queda RETRY_SCHEDULED
 *     o se marca como bloqueado; no se finge que se procesó.
 *
 * POR QUÉ ES UNA VARIABLE DE ENTORNO Y NO UN CAMPO EN LA BASE
 * Porque tiene que poder activarse sin deploy, en segundos, cuando algo va mal
 * en producción. Un flag en la base exigiría un despliegue para cambiarlo, que es
 * justo lo que no se quiere en una emergencia. Se lee en cada invocación, no se
 * cachea: si el valor cambia, el efecto cambia en la siguiente petición.
 *
 * CÓMO SE USA (documentado, NO se cambia en producción desde aquí)
 *   Con AI_PROCESSING_ENABLED ausente o distinto de 'false' -> procesamiento
 *   ACTIVO. Es el default, para que un despliegue sin la variable no rompa nada.
 *
 *   Para detener todo trabajo costoso, en Vercel -> Settings -> Environment
 *   Variables: poner AI_PROCESSING_ENABLED=false y redeploy. O como variable de
 *   runtime si el hosting lo permite.
 *
 *   `false`, `0`, `no` y `off` (sin distinguir mayúsculas) apagan. Cualquier
 *   otro valor enciende. Se lee el valor crudo, no un boolean parseado flojo,
 *   para que un typo no apagara producción por sorpresa ni la encendiera.
 */

const DISABLED_VALUES = new Set(['false', '0', 'no', 'off']);

export function isAiProcessingEnabled(raw: string | undefined | null): boolean {
  if (raw === undefined || raw === null) return true;
  return !DISABLED_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Motivo por el que se puede denegar una ejecución. Es un dato técnico, no una
 * valoración normativa, y no se registra en ningún log con contenido de evidencia.
 */
export type ProcessingDenialReason = 'AI_PROCESSING_DISABLED' | 'UNKNOWN_JOB_TYPE';

export interface ProcessingGuard {
  enabled: boolean;
  reason: ProcessingDenialReason | null;
}

export function guardProcessing(enabled: boolean): ProcessingGuard {
  if (enabled) return { enabled: true, reason: null };
  return { enabled: false, reason: 'AI_PROCESSING_DISABLED' };
}
