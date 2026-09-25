import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createJobRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';
import { executeClaimedJob } from '@/server/jobs/handlers';
import { isAiProcessingEnabled } from '@/server/jobs/processing-switch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/jobs/process
 *
 * Reclama y ejecuta UN job. Es la única vía de escritura de la cola.
 *
 * POR QUÉ EL 200 GENÉRICO ERA EL SEGUNDO DEFECTO DEL INCIDENTE
 * Antes devolvía `200 { processed: 0 }` cuando no había nada reclamable, que es
 * indistinguible de `200 { processed: 1 }`. El cliente no podía decidir si
 * repetir, y repetía. Un 200 que no significa "seguí" es un 200 que invita a
 * un bucle.
 *
 * Ahora el cuerpo lleva un `status` DISCRIMINADO y el cliente debe mirarlo:
 *
 *   processed              -> se reclamó y ejecutó un job. Se puede pedir otro.
 *   nothing_to_process     -> no hay nada reclamable. NO pedir otra vez.
 *   already_running        -> hay un job RUNNING con lease válido. NO pedir:
 *                             está en manos de su worker y el claim es de la
 *                             base, no del cliente.
 *   retry_scheduled        -> hay un job en backoff; `availableAt` dice cuándo.
 *                             NO pedir antes de esa hora.
 *   ai_processing_disabled -> interruptor de coste apagado. NO pedir.
 *   terminal_failure       -> el job agotó sus intentos. Requiere acción humana.
 *
 * Los estados que NO autorizan otro POST son la mitad del arreglo: un 200
 * seguido de "no hagas nada" tiene que ser legible, o el cliente lo va a
 * interpretar como permiso para seguir.
 *
 * NUNCA devuelve 500 por un trabajo que no se pudo reclamar. Un error de
 * infraestructura sí es 500, y eso es distinto de "no había nada".
 */
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });

    const client = await createInsForgeServerClient();
    const repo = createJobRepository(client.database);

    // El interruptor se lee ANTES de reclamar nada. Si está apagado no se
    // toca la cola: ni un claim, ni un lease, ni un intento consumido.
    if (!isAiProcessingEnabled(process.env.AI_PROCESSING_ENABLED)) {
      return NextResponse.json({
        status: 'ai_processing_disabled',
        processed: 0,
        reason: 'AI_PROCESSING_DISABLED',
        message: 'El procesamiento con proveedores externos esta desactivado. La lectura y la trazabilidad siguen funcionando.',
      });
    }

    const workerId = `http-${randomUUID()}`;
    const claimed = await repo.claimNext(workerId, 60);

    if (!claimed) {
      // Distinguir por qué no hay nada, para que el cliente no tenga que adivinar
      // y no le dé porvenir a reintentar. Es una LECTURA, no un proceso.
      const inFlight = await describeInFlight(client.database);
      return NextResponse.json({ status: inFlight.status, processed: 0, workerId, ...inFlight.payload });
    }

    await executeClaimedJob({ database: client.database, storage: client.storage, workerId }, claimed);
    return NextResponse.json({ status: 'processed', processed: 1, workerId, jobId: claimed.jobId });
  } catch (error) {
    // `console.error` con el error entero podría volcar un payload. Se registra
    // sólo el nombre del error: los logs no son un canal de diagnóstico aquí.
    const name = error instanceof Error ? error.name : 'ErrorDesconocido';
    console.error('[jobs.process]', name);
    return NextResponse.json({
      status: 'error',
      error: 'JOB_PROCESS_ERROR',
      message: 'No fue posible procesar la cola.',
    }, { status: 500 });
  }
}

type InFlight = { status: 'nothing_to_process' | 'already_running' | 'retry_scheduled'; payload: Record<string, unknown> };

/**
 * Clasifica el motivo por el que `claim_next_job` no devolvió nada. Sin esto el
 * cliente recibe un `nothing_to_process` opaco y no puede distinguir "ya está
 * hecho" de "otro worker lo tiene" de "está esperando su backoff", que son tres
 * situaciones con импеativos opuestos.
 */
async function describeInFlight(database: Awaited<ReturnType<typeof createInsForgeServerClient>>['database']): Promise<InFlight> {
  const { data } = await database
    .from('jobs')
    .select('id,job_type,status,attempt_count,max_attempts,available_at,last_error_code')
    .in('status', ['RUNNING', 'RETRY_SCHEDULED', 'QUEUED'])
    .order('created_at', { ascending: true })
    .limit(1);

  const row = (data ?? [])[0] as {
    id?: string; job_type?: string; status?: string;
    attempt_count?: number; max_attempts?: number;
    available_at?: string | null; last_error_code?: string | null;
  } | undefined;

  if (!row) return { status: 'nothing_to_process', payload: {} };
  if (row.status === 'RUNNING') {
    return { status: 'already_running', payload: { jobId: row.id, jobType: row.job_type } };
  }
  if (row.status === 'RETRY_SCHEDULED') {
    return {
      status: 'retry_scheduled',
      payload: {
        jobId: row.id,
        jobType: row.job_type,
        availableAt: row.available_at ?? null,
        attemptCount: row.attempt_count ?? null,
        maxAttempts: row.max_attempts ?? null,
        lastErrorCode: row.last_error_code ?? null,
      },
    };
  }
  return { status: 'nothing_to_process', payload: {} };
}
