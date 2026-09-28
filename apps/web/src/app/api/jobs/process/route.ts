import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createJobRepository, sweepStaleOperations } from '@cancelaciones/db';
import { createInsForgeAdminClient, createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';
import { executeClaimedJob } from '@/server/jobs/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });

    const workerId = `http-${randomUUID()}`;
    const client = await createInsForgeServerClient();
    const adminClient = createInsForgeAdminClient();
    if (adminClient) {
      await sweepStaleOperations(adminClient.database);
    } else {
      console.warn('[jobs.process] INSFORGE_API_KEY no configurada; se omite el sweep privilegiado.');
    }
    const repo = createJobRepository(client.database);
    const claimed = await repo.claimNext(workerId, 60);
    if (!claimed) return NextResponse.json({ processed: 0, workerId });

    await executeClaimedJob({ database: client.database, storage: client.storage, workerId }, claimed);
    return NextResponse.json({ processed: 1, workerId, jobId: claimed.jobId });
  } catch (error) {
    console.error('[jobs.process]', error);
    return NextResponse.json({
      error: 'JOB_PROCESS_ERROR',
      message: error instanceof Error ? error.message : 'No fue posible procesar la cola.',
    }, { status: 500 });
  }
}
