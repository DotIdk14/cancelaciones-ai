import { NextResponse, type NextRequest } from 'next/server';
import { createAuditRepository, createEvidenceRepository, createFactRepository, createJobRepository } from '@cancelaciones/db';
import { stableFingerprint } from '@cancelaciones/domain';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });
  const { auditId } = await context.params;
  const client = await createInsForgeServerClient();
  const audit = await createAuditRepository(client.database).findById(auditId);
  if (!audit) return NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 });
  const jobs = await createJobRepository(client.database).listByAudit(auditId);
  const latestByScope = new Map<string, (typeof jobs)[number]>();
  for (const job of jobs) {
    if (!latestByScope.has(job.operationScope)) latestByScope.set(job.operationScope, job);
  }
  return NextResponse.json({ jobs: Array.from(latestByScope.values()) });
}

export async function POST(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });
  const { auditId } = await context.params;
  const client = await createInsForgeServerClient();
  const audit = await createAuditRepository(client.database).findById(auditId);
  if (!audit) return NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 });

  const form = await request.formData().catch(() => null);
  const action = String(form?.get('action') ?? 'PROCESS_EVIDENCES');
  const repo = createJobRepository(client.database);
  let job;
  if (action === 'EXTRACT_FACTS') {
    const factsRepo = createFactRepository(client.database);
    const artifactSetFingerprint = await factsRepo.artifactSetFingerprint(auditId);
    const run = await factsRepo.createRun({ auditId, policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', extractorVersion: 'deterministic-facts-v1', artifactSetFingerprint, createdBy: user.id });
    await client.database.from('fact_extraction_runs').update({ state: 'PROCESSING' }).eq('id', run.id);
    const payload = { auditId, factRunId: run.id, version: 'deterministic-facts-v1' };
    job = await repo.enqueue({ auditId, jobType: 'FACT_EXTRACTION', operationScope: `audit:${auditId}:facts`, idempotencyKey: `facts:${run.id}:v1`, inputFingerprint: stableFingerprint(payload), payload, actorId: user.id });
  } else {
    const evidences = await createEvidenceRepository(client.database).listByAudit(auditId);
    const stored = evidences.filter((evidence) => evidence.status === 'STORED');
    if (stored.length === 0) return NextResponse.json({ error: 'NO_STORED_EVIDENCE', message: 'Primero sube al menos una evidencia almacenada.' }, { status: 409 });
    const jobs = [];
    for (const evidence of stored) {
      const rerun = action === 'RERUN_EVIDENCES';
      const version = evidence.detectedMimeType.startsWith('image/')
        ? rerun ? 'vision-extraction-v4' : 'vision-extraction-v3'
        : rerun ? 'deterministic-text-v2' : 'deterministic-text-v1';
      const payload = { auditId, evidenceId: evidence.id, sha256: evidence.sha256, version };
      jobs.push(await repo.enqueue({ auditId, jobType: 'EVIDENCE_PROCESSING', operationScope: `evidence:${evidence.id}:process`, idempotencyKey: `evidence:${evidence.id}:process:${version}`, inputFingerprint: stableFingerprint(payload), payload, evidenceId: evidence.id, actorId: user.id }));
    }
    return NextResponse.json({ jobs }, { status: 202 });
  }

  return NextResponse.json({ job }, { status: 202 });
}
