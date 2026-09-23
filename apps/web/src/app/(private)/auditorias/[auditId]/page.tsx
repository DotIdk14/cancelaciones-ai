import { notFound } from 'next/navigation';
import { createAuditManualCommentsRepository, createAuditRepository, createDictamenDocumentRepository, createEvidenceRepository, createFactRepository, createHumanReviewRepository, createJobRepository, createReportSnapshotRepository } from '@cancelaciones/db';
import type { PolicyEvaluation } from '@cancelaciones/policy-engine';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getLocalDemoDetail, isLocalDemoMode } from '@/server/local-demo';
import { AuditWorkspace } from './components/AuditWorkspace';

export const dynamic = 'force-dynamic';

const ruleLabels: Record<string, string> = {
  'GDM-V5-5.2-A-CONTACT-ATTEMPTS': 'Intentos de contacto y distribución de interacciones',
  'GDM-V5-5.8-A-LICENCIATURA': 'Condiciones académicas para licenciatura',
  'GDM-V5-5.8-A-NON-LICENCIATURA': 'Condiciones académicas para otros niveles',
  'GDM-V5-5.8-A-ACADEMIC-LEVEL-UNKNOWN': 'Nivel académico no identificado',
};

export default async function AuditDetailPage({ params, searchParams }: { params: Promise<{ auditId: string }>; searchParams?: Promise<{ commentsSaved?: string }> }) {
  const { auditId } = await params;
  const { commentsSaved } = (await searchParams) ?? {};

  if (isLocalDemoMode()) {
    const demo = getLocalDemoDetail(auditId);
    if (!demo) notFound();
    return renderAuditDetail({
      commentsSaved,
      audit: demo.audit,
      manualComments: demo.manualComments,
      evidences: demo.evidences,
      artifacts: demo.artifacts,
      humanReview: demo.humanReview,
      snapshot: demo.snapshot,
      dictamenDocuments: demo.dictamenDocuments,
      selectedRun: demo.factRuns[0] ?? null,
      evaluation: demo.evaluation,
    });
  }

  const client = await createInsForgeServerClient();
  const audit = await createAuditRepository(client.database).findById(auditId);
  if (!audit) notFound();

  const [manualComments, evidences, artifacts, humanReview, snapshot, dictamenDocuments] = await Promise.all([
    createAuditManualCommentsRepository(client.database).findByAudit(auditId),
    createEvidenceRepository(client.database).listByAudit(auditId),
    createJobRepository(client.database).listArtifactsByAudit(auditId),
    createHumanReviewRepository(client.database).findByAudit(auditId),
    createReportSnapshotRepository(client.database).findLatestByAudit(auditId),
    createDictamenDocumentRepository(client.database).listByAudit(auditId),
  ]);

  const factRuns = await createFactRepository(client.database).listRunsByAudit(auditId);
  const selectedRun = factRuns.find((run) => run.state === 'FROZEN') ?? factRuns[0] ?? null;
  const latestEngineRun = await client.database.from('engine_runs').select('*').eq('audit_id', auditId).order('created_at', { ascending: false }).limit(1);
  const evaluation = latestEngineRun.data?.[0]?.evaluation as PolicyEvaluation | undefined;

  return renderAuditDetail({ commentsSaved, audit, manualComments, evidences, artifacts, humanReview, snapshot, dictamenDocuments, selectedRun, evaluation });
}

function renderAuditDetail({ commentsSaved, audit, manualComments, evidences, artifacts, humanReview, snapshot, dictamenDocuments, selectedRun, evaluation }: {
  commentsSaved?: string;
  audit: NonNullable<Awaited<ReturnType<ReturnType<typeof createAuditRepository>['findById']>>>;
  manualComments: Awaited<ReturnType<ReturnType<typeof createAuditManualCommentsRepository>['findByAudit']>>;
  evidences: Awaited<ReturnType<ReturnType<typeof createEvidenceRepository>['listByAudit']>>;
  artifacts: Awaited<ReturnType<ReturnType<typeof createJobRepository>['listArtifactsByAudit']>>;
  humanReview: Awaited<ReturnType<ReturnType<typeof createHumanReviewRepository>['findByAudit']>>;
  snapshot: Awaited<ReturnType<ReturnType<typeof createReportSnapshotRepository>['findLatestByAudit']>>;
  dictamenDocuments: Awaited<ReturnType<ReturnType<typeof createDictamenDocumentRepository>['listByAudit']>>;
  selectedRun: Awaited<ReturnType<ReturnType<typeof createFactRepository>['listRunsByAudit']>>[number] | null;
  evaluation?: PolicyEvaluation;
}) {
  const transcripts = artifacts.filter((artifact) => artifact.artifactType === 'audio-transcript' && Array.isArray(artifact.result.utterances));
  return (
    <AuditWorkspace
      audit={audit}
      status={selectedRun?.state === 'FROZEN' ? 'FROZEN' : selectedRun ? 'PROCESSING' : 'DRAFT'}
      evidences={evidences.map((evidence) => ({ id: evidence.id, auditId: audit.id, originalFilename: evidence.originalFilename, detectedMimeType: evidence.detectedMimeType, sizeBytes: evidence.sizeBytes, sha256: evidence.sha256, status: evidence.status }))}
      transcripts={transcripts.map((artifact) => ({ id: artifact.id, evidenceId: artifact.evidenceId, result: artifact.result }))}
      evaluation={evaluation as import('./components/types').PolicyEvaluationShape | undefined}
      policyVersion={selectedRun ? `${selectedRun.policyCode} V${selectedRun.policyVersion}` : null}
      manualComments={manualComments}
      commentsSaved={commentsSaved === '1'}
      humanReview={humanReview}
      snapshot={snapshot}
      documents={dictamenDocuments}
      hasHumanReview={Boolean(humanReview)}
      rules={(evaluation?.evaluatedRules as import('./components/types').EvaluatedRule[] | undefined) ?? []}
      missingItems={(evaluation?.missingData as import('./components/types').MissingItem[] | undefined) ?? []}
      ruleLabels={ruleLabels}
    />
  );
}
