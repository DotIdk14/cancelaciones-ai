import { notFound } from 'next/navigation';
import { createAuditManualCommentsRepository, createAuditRepository, createDictamenDocumentRepository, createEvidenceRepository, createFactRepository, createJobRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { AuditWorkspace } from './components/AuditWorkspace';

export const dynamic = 'force-dynamic';

/**
 * Workspace de auditoría — solo infraestructura.
 *
 * Lee evidencia, artifacts, hechos extraídos y comentarios. No consulta ni
 * muestra resultados normativos: el motor de auditoría no está implementado
 * (AI_EXTRACTS / POLICY_ENGINE_DECIDES).
 */
export default async function AuditDetailPage({ params, searchParams }: { params: Promise<{ auditId: string }>; searchParams?: Promise<{ commentsSaved?: string }> }) {
  const { auditId } = await params;
  const { commentsSaved } = (await searchParams) ?? {};

  const client = await createInsForgeServerClient();
  const audit = await createAuditRepository(client.database).findById(auditId);
  if (!audit) notFound();

  const [manualComments, evidences, artifacts, dictamenDocuments, factRuns] = await Promise.all([
    createAuditManualCommentsRepository(client.database).findByAudit(auditId),
    createEvidenceRepository(client.database).listByAudit(auditId),
    createJobRepository(client.database).listArtifactsByAudit(auditId),
    createDictamenDocumentRepository(client.database).listByAudit(auditId),
    createFactRepository(client.database).listRunsByAudit(auditId),
  ]);

  const selectedRun = factRuns.find((run) => run.state === 'FROZEN') ?? factRuns[0] ?? null;
  const transcripts = artifacts.filter((artifact) => artifact.artifactType === 'audio-transcript' && Array.isArray(artifact.result.utterances));

  return (
    <AuditWorkspace
      audit={audit}
      status={selectedRun?.state === 'FROZEN' ? 'FROZEN' : selectedRun ? 'PROCESSING' : 'DRAFT'}
      evidences={evidences.map((evidence) => ({ id: evidence.id, auditId: audit.id, originalFilename: evidence.originalFilename, detectedMimeType: evidence.detectedMimeType, sizeBytes: evidence.sizeBytes, sha256: evidence.sha256, status: evidence.status, documentRole: evidence.documentRole }))}
      transcripts={transcripts.map((artifact) => ({ id: artifact.id, evidenceId: artifact.evidenceId, result: artifact.result }))}
      extractorVersion={selectedRun?.extractorVersion ?? null}
      factRunId={selectedRun?.id ?? null}
      manualComments={manualComments}
      commentsSaved={commentsSaved === '1'}
      documents={dictamenDocuments}
    />
  );
}
