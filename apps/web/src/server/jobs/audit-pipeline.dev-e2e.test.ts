import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAdminClient, createClient } from '@insforge/sdk';
import { createAuditRepository, createEvidenceRepository, createFactRepository, createJobRepository } from '@cancelaciones/db';
import { uploadEvidenceFilesForAudit } from '@/server/evidence/upload';
import { enqueueEvidenceProcessingJobs } from './enqueue-evidence';
import { executeClaimedJob } from './handlers';

const DEV_BRANCH_APPKEY = '4pw4jdzv-cif';

function requireDevEnv() {
  const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const anonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
  const apiKey = process.env.INSFORGE_DEV_API_KEY;
  const actorId = process.env.INSFORGE_DEV_ACTOR_ID;
  if (!baseUrl || !anonKey || !apiKey || !actorId) throw new Error('DEV_INFRA_NOT_CONFIGURED: NEXT_PUBLIC_INSFORGE_URL, NEXT_PUBLIC_INSFORGE_ANON_KEY, INSFORGE_DEV_API_KEY e INSFORGE_DEV_ACTOR_ID son obligatorios. No hay fallback.');
  if (!baseUrl.includes(DEV_BRANCH_APPKEY)) throw new Error(`REFUSING_NON_DEV_INSFORGE_URL: esperado appkey DEV ${DEV_BRANCH_APPKEY}.`);
  return { baseUrl, anonKey, apiKey, actorId };
}

async function drainQueue(database: ReturnType<typeof createClient>['database'], storage: ReturnType<typeof createClient>['storage'], workerId = `dev-e2e-${randomUUID()}`) {
  const repo = createJobRepository(database);
  for (let index = 0; index < 30; index += 1) {
    const claimed = await repo.claimNext(workerId, 60);
    if (!claimed) return;
    await executeClaimedJob({ database, storage, workerId }, claimed);
  }
  throw new Error('QUEUE_DID_NOT_DRAIN');
}

async function cleanup(client: ReturnType<typeof createClient>, auditId: string) {
  const evidences = await createEvidenceRepository(client.database).listByAudit(auditId).catch(() => []);
  const keys = evidences.filter((evidence) => evidence.storageKey).map((evidence) => evidence.storageKey!);
  if (keys.length > 0) await client.storage.from('dictamen-evidencias').remove(keys).catch(() => null);
  await client.database.from('report_snapshots').delete().eq('audit_id', auditId);
  await client.database.from('audit_runs').delete().eq('audit_id', auditId);
  await client.database.from('engine_rule_results').delete().in('engine_run_id', (await client.database.from('engine_runs').select('id').eq('audit_id', auditId)).data?.map((row: { id: string }) => row.id) ?? []);
  await client.database.from('engine_runs').delete().eq('audit_id', auditId);
  await client.database.from('facts').delete().eq('audit_id', auditId);
  await client.database.from('fact_extraction_runs').delete().eq('audit_id', auditId);
  await client.database.from('job_artifacts').delete().in('job_id', (await client.database.from('jobs').select('id').eq('audit_id', auditId)).data?.map((row: { id: string }) => row.id) ?? []);
  await client.database.from('job_attempts').delete().in('job_id', (await client.database.from('jobs').select('id').eq('audit_id', auditId)).data?.map((row: { id: string }) => row.id) ?? []);
  await client.database.from('jobs').delete().eq('audit_id', auditId);
  await client.database.from('audit_log').delete().eq('audit_id', auditId);
  await client.database.from('evidences').delete().eq('audit_id', auditId);
  await client.database.from('audits').delete().eq('id', auditId);
}

describe('AUDIT PIPELINE DEV INFRA E2E', () => {
  it('ejecuta pipeline completo contra InsForge DEV real con storage y queue reales', async () => {
    const env = requireDevEnv();
    const client = createAdminClient({ baseUrl: env.baseUrl, apiKey: env.apiKey });
    const actorId = env.actorId;
    await client.database.from('profiles').upsert([{ id: actorId, role: 'AUDITOR', display_name: 'DEV E2E' }]);
    const audit = await createAuditRepository(client.database).create({ createdBy: actorId, displayName: 'DEV E2E sintético', externalCaseId: `DEV-E2E-${Date.now()}` });

    try {
      const files = [
        new File(['ESTUDIANTE: DEV UNO\nMATRICULA: DEV-001\nNIVEL: LICENCIATURA\nNO CONTACTO EFECTIVO'], 'dev-a.txt', { type: 'text/plain' }),
        new File(['SIN LOGIN\nSIN MODALIDAD\nCALL: 2026-09-01\nEMAIL: 2026-09-02'], 'dev-b.txt', { type: 'text/plain' }),
      ];
      const uploaded = await uploadEvidenceFilesForAudit({ auditId: audit.id, actorId, files, database: client.database, storage: client.storage });
      expect(uploaded.map((item) => item.status)).toEqual(['STORED', 'STORED']);
      const jobs = await enqueueEvidenceProcessingJobs({ database: client.database, auditId: audit.id, actorId });
      expect(jobs).toHaveLength(2);

      const repo = createJobRepository(client.database);
      const workerId = `dev-e2e-${randomUUID()}`;
      const first = await repo.claimNext(workerId, 60);
      expect(first?.jobType).toBe('EVIDENCE_PROCESSING');
      await executeClaimedJob({ database: client.database, storage: client.storage, workerId }, first!);
      expect((await repo.listByAudit(audit.id)).filter((job) => job.jobType === 'FACT_EXTRACTION')).toHaveLength(0);
      const second = await repo.claimNext(workerId, 60);
      expect(second?.jobType).toBe('EVIDENCE_PROCESSING');
      await executeClaimedJob({ database: client.database, storage: client.storage, workerId }, second!);

      await drainQueue(client.database, client.storage, workerId);

      const reloaded = createAdminClient({ baseUrl: env.baseUrl, apiKey: env.apiKey });
      const [auditReloaded, evidences, artifacts, factRuns, engineRuns, reports, jobsReloaded] = await Promise.all([
        createAuditRepository(reloaded.database).findById(audit.id),
        createEvidenceRepository(reloaded.database).listByAudit(audit.id),
        createJobRepository(reloaded.database).listArtifactsByAudit(audit.id),
        createFactRepository(reloaded.database).listRunsByAudit(audit.id),
        reloaded.database.from('engine_runs').select('*').eq('audit_id', audit.id),
        reloaded.database.from('report_snapshots').select('*').eq('audit_id', audit.id),
        createJobRepository(reloaded.database).listByAudit(audit.id),
      ]);
      const facts = await createFactRepository(reloaded.database).listFactsByRun(factRuns[0].id);
      const ruleResults = await reloaded.database.from('engine_rule_results').select('*').eq('engine_run_id', engineRuns.data?.[0]?.id);

      expect(auditReloaded).toMatchObject({ id: audit.id, status: 'COMPLETED' });
      expect(jobsReloaded.filter((job) => job.jobType === 'FACT_EXTRACTION')).toHaveLength(1);
      expect(evidences).toHaveLength(2);
      expect(artifacts).toHaveLength(2);
      expect(factRuns).toMatchObject([{ state: 'FROZEN' }]);
      expect(facts.map((fact) => fact.factType)).toEqual(expect.arrayContaining(['student.level', 'contact.effectiveContact', 'classroom.hasLogin', 'classroom.hasEvaluationMode']));
      expect(engineRuns.data).toHaveLength(1);
      expect(ruleResults.data?.length ?? 0).toBeGreaterThan(0);
      expect(reports.data).toHaveLength(1);
      expect(jobsReloaded.every((job) => job.status === 'COMPLETED' || job.status === 'SUCCEEDED')).toBe(true);

      const anonymous = createClient({ baseUrl: env.baseUrl, anonKey: env.anonKey });
      const unauthorized = await anonymous.database.from('audits').select('id').eq('id', audit.id).limit(1);
      expect(unauthorized.data ?? []).toEqual([]);
    } finally {
      await cleanup(client, audit.id);
    }
  }, 60_000);
});
