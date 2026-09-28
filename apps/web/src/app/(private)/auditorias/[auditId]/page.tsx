import { notFound } from 'next/navigation';
import { createAuditLogRepository, createAuditRepository, createAuditResultRepository, createAuditRunRepository, createEvidenceRepository, createJobRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { AuditWorkspace } from './components/AuditWorkspace';

export const dynamic = 'force-dynamic';

export default async function AuditDetailPage({ params }: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await params;
  const client = await createInsForgeServerClient();
  const audit = await createAuditRepository(client.database).findById(auditId);
  if (!audit) notFound();

  const [evidences, jobs, artifacts, runs, events, result] = await Promise.all([
    createEvidenceRepository(client.database).listByAudit(auditId),
    createJobRepository(client.database).listByAudit(auditId),
    createJobRepository(client.database).listArtifactsByAudit(auditId),
    createAuditRunRepository(client.database).listByAudit(auditId),
    createAuditLogRepository(client.database).listByAudit(auditId),
    createAuditResultRepository(client.database).finalForAudit(auditId),
  ]);

  return <AuditWorkspace audit={audit} evidences={evidences} jobs={jobs} artifacts={artifacts} runs={runs} events={events} result={result} />;
}
