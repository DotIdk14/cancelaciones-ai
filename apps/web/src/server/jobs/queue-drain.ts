/**
 * ============================================================================
 * POLÍTICA DE DRENADO DE COLA (extraída de AuditWorkflow para poder testearla)
 * ============================================================================
 *
 * QUÉ RESUELVE
 * El incidente del 2026-09-25: `waitForJobs` hacía `POST /api/jobs/process`
 * cada ~700 ms mientras existiera CUALQUIER job en `QUEUED`, `RUNNING` o
 * `RETRY_SCHEDULED`. Con un job atascado en `RETRY_SCHEDULED` eso producía
 * ~60 POSTs por llamada y hasta ~120 por montaje de página, todos devolviendo
 * HTTP 200.
 *
 * POR QUÉ ESTA EN UN MÓDULO PROPIO Y NO DENTRO DEL COMPONENTE
 * Porque el bug era una decisión, no un despiste: la condición de "hay trabajo
 * activo" estaba confundida con "el cliente debe pedir que se procese". Eso no
 * se puede ver ni comprobar en un `.tsx`. Aquí la decisión es una función pura
 * y se testea sin React ni red.
 *
 * LA REGLA
 * Pedir procesamiento solo cuando hay trabajo REALMENTE reclamable:
 *
 *   QUEUED           -> el cliente pide procesar. Es lo único que justifica un POST.
 *   RUNNING          -> ya lo está procesando alguien. NO se pide. Volver a pedirlo
 *                       no acelera nada: el claim está en la base, no en el cliente.
 *   RETRY_SCHEDULED  -> está en backoff. `available_at` dice cuándo. POSTear antes
 *                       es un no-op que devuelve 200, y por tanto es la causa del loop.
 *   SUCCEEDED        -> terminado. No se pide.
 *   FAILED           -> falló. Se propaga el error. No se reintenta en bucle.
 *
 * `RUNNING` en la lista de estados "activos" era el error de fondo: un job en
 * RUNNING no es trabajo pendiente, es trabajo EN CURSO. Pedirlo otra vez desde
 * el mismo cliente es exactamente el "doble disparo" que el lease de la base de
 * datos ya impide, pero que el cliente sigue pidiendo.
 */

export type QueueJobStatus = 'QUEUED' | 'RUNNING' | 'RETRY_SCHEDULED' | 'SUCCEEDED' | 'FAILED' | string;

export interface QueueJobView {
  id: string;
  jobType: string;
  status: QueueJobStatus;
  attemptCount?: number;
  maxAttempts?: number;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  /** Backoff del reintento. Presente sólo si el job lo expone. */
  availableAt?: string | null;
}

export type DrainAction =
  /** No hay nada que hacer. La auditoría sigue su curso. */
  | { kind: 'done' }
  /** Hay un job fallido: hay que reportarlo, no seguir insistiendo. */
  | { kind: 'failed'; job: QueueJobView }
  /** Hay trabajo reclamable: un POST, y solo uno, está justificado. */
  | { kind: 'process' }
  /** Hay trabajo en curso o en backoff: SOLO consultar, nunca POST. */
  | { kind: 'wait'; reason: 'RUNNING' | 'RETRY_SCHEDULED' };

/** Estados en los que el trabajo ya está en manos de alguien o en backoff. */
const IN_FLIGHT = new Set(['RUNNING', 'RETRY_SCHEDULED']);

/** Estados terminales: no se vuelve a pedir nada. */
const TERMINAL = new Set(['SUCCEEDED', 'FAILED']);

export function decideDrainAction(jobs: QueueJobView[]): DrainAction {
  const failed = jobs.find((job) => job.status === 'FAILED');
  if (failed) return { kind: 'failed', job: failed };

  const claimable = jobs.some((job) => job.status === 'QUEUED');
  if (claimable) return { kind: 'process' };

  const inFlight = jobs.find((job) => IN_FLIGHT.has(job.status));
  if (inFlight) return { kind: 'wait', reason: inFlight.status as 'RUNNING' | 'RETRY_SCHEDULED' };

  if (jobs.length === 0) return { kind: 'done' };
  if (jobs.every((job) => TERMINAL.has(job.status))) return { kind: 'done' };

  // Estados que no conocemos: no se procesa a ciegas ni se espera a ciegas.
  // Se sale del bucle y se informa, en vez de POSTear hasta el timeout.
  return { kind: 'done' };
}

/** ¿Este resultado de `POST /api/jobs/process` justifica otro intento? */
export function shouldRetryProcess(status: string | null | undefined): boolean {
  return status === 'processed';
}

/** Un job en backoff cuyo `available_at` ya pasó vuelve a ser reclamable por el backend. */
export function isBackoffElapsed(job: QueueJobView, now: number): boolean {
  if (job.status !== 'RETRY_SCHEDULED') return false;
  if (!job.availableAt) return false;
  const at = Date.parse(job.availableAt);
  return Number.isFinite(at) && at <= now;
}
