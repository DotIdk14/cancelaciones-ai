import { NextResponse, type NextRequest } from 'next/server';
import { createAuditRepository, createAuditRunRepository, createJobRepository } from '@cancelaciones/db';
import { sha256Hex } from '@cancelaciones/shared';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';
import { enqueueEvidenceProcessingJobs } from '@/server/jobs/enqueue-evidence';

export const dynamic = 'force-dynamic';

function routeError(error: unknown) {
  console.error('[audits.jobs]', error);
  return NextResponse.json({ error: 'JOB_ROUTE_ERROR', message: error instanceof Error ? error.message : 'No fue posible operar la cola.' }, { status: 500 });
}

export async function GET(_request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });
    const { auditId } = await context.params;
    const client = await createInsForgeServerClient();
    const audit = await createAuditRepository(client.database).findById(auditId);
    if (!audit) return NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 });
    const repo = createJobRepository(client.database);
    return NextResponse.json({ jobs: await repo.listByAudit(auditId), artifacts: await repo.listArtifactsByAudit(auditId) });
  } catch (error) {
    return routeError(error);
  }
}

async function readAction(request: NextRequest): Promise<string> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await request.json().catch(() => ({}));
    return String((body as Record<string, unknown>).action ?? 'PROCESS_EVIDENCES');
  }
  const form = await request.formData().catch(() => null);
  return String(form?.get('action') ?? 'PROCESS_EVIDENCES');
}

export async function POST(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });
    const { auditId } = await context.params;
    const action = await readAction(request);
    const client = await createInsForgeServerClient();
    const audit = await createAuditRepository(client.database).findById(auditId);
    if (!audit) return NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 });

    if (action === 'PROCESS_EVIDENCES') {
      const jobs = await enqueueEvidenceProcessingJobs({ database: client.database, auditId, actorId: user.id });
      return NextResponse.json({ jobs }, { status: 202 });
    }

    if (action === 'START_AUDIT' || action === 'RUN_AUDIT') {
      const latest = await createAuditRunRepository(client.database).latest(auditId);
      const payload = { auditId, runId: latest?.id ?? null, actorId: user.id, action: 'START_AUDIT' };
      const job = await createJobRepository(client.database).enqueue({
        auditId,
        jobType: 'AUDIT_RUN',
        operationScope: `audit:${auditId}:run`,
        idempotencyKey: `audit:${auditId}:run:${latest?.id ?? 'new'}`,
        inputFingerprint: sha256Hex(JSON.stringify(payload)),
        payload,
        maxAttempts: 2,
        actorId: user.id,
      });
      return NextResponse.json({ job }, { status: 202 });
    }

    return NextResponse.json({ error: 'BAD_ACTION', message: 'Accion no soportada.' }, { status: 400 });
  } catch (error) {
    return routeError(error);
  }
}
