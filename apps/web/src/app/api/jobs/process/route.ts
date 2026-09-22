import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createJobRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';
import { executeClaimedJob } from '@/server/jobs/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });

  const workerId = `http-${randomUUID()}`;
  const client = await createInsForgeServerClient();
  const repo = createJobRepository(client.database);
  const claimed = await repo.claimNext(workerId, 60);
  if (!claimed) return NextResponse.json({ processed: 0, workerId });

  await executeClaimedJob({ database: client.database, storage: client.storage, workerId }, claimed);
  return NextResponse.json({ processed: 1, workerId, jobId: claimed.jobId });
}
