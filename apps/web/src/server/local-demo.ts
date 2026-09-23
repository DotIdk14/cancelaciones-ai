import type { Audit } from '@cancelaciones/domain';
import type { AuditManualComments, DictamenDocumentRecord, EvidenceSelectionRecord, FactExtractionRun, HumanReviewRecord, JobArtifact, ReportSnapshotRecord, StoredFact } from '@cancelaciones/db';
import type { PolicyEvaluation } from '@cancelaciones/policy-engine';

export const LOCAL_DEMO_AUDIT_ID = 'local-demo-audit-001';

export function isLocalDemoMode() {
  return process.env.LOCAL_DEMO === '1' || process.env.NEXT_PUBLIC_LOCAL_DEMO === '1';
}

export const localDemoUser = {
  id: 'local-demo-user',
  email: 'demo.local@cancelaciones.ai',
};

const now = '2026-09-23T12:00:00.000Z';

export const localDemoAudits: Audit[] = [
  {
    id: LOCAL_DEMO_AUDIT_ID,
    displayName: 'Caso demo local — visual Phase 8',
    status: 'DRAFT',
    externalCaseId: 'LOCAL-2026-0001',
    createdBy: localDemoUser.id,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'local-demo-audit-002',
    displayName: 'Expediente demo rápido',
    status: 'DRAFT',
    externalCaseId: 'LOCAL-2026-0002',
    createdBy: localDemoUser.id,
    createdAt: '2026-09-22T17:35:00.000Z',
    updatedAt: '2026-09-22T17:35:00.000Z',
  },
];

export function getLocalDemoAudit(auditId: string): Audit | null {
  return localDemoAudits.find((audit) => audit.id === auditId) ?? localDemoAudits[0] ?? null;
}

export function getLocalDemoDetail(auditId: string) {
  const audit = getLocalDemoAudit(auditId);
  if (!audit) return null;

  const evidences = [
    { id: 'local-ev-pdf', auditId: audit.id, originalFilename: 'solicitud_cancelacion_demo.pdf', safeFilename: 'solicitud_cancelacion_demo.pdf', mimeType: 'application/pdf', detectedMimeType: 'application/pdf', sizeBytes: 1450000, sha256: 'local-demo-pdf-sha256', storageBucket: 'local-demo', storageKey: null, status: 'STORED' as const, uploadedBy: localDemoUser.id, createdAt: now, updatedAt: now },
    { id: 'local-ev-img', auditId: audit.id, originalFilename: 'identificacion_demo.jpg', safeFilename: 'identificacion_demo.jpg', mimeType: 'image/jpeg', detectedMimeType: 'image/jpeg', sizeBytes: 850000, sha256: 'local-demo-img-sha256', storageBucket: 'local-demo', storageKey: null, status: 'STORED' as const, uploadedBy: localDemoUser.id, createdAt: now, updatedAt: now },
    { id: 'local-ev-audio', auditId: audit.id, originalFilename: 'llamada_retencion_demo.mp3', safeFilename: 'llamada_retencion_demo.mp3', mimeType: 'audio/mpeg', detectedMimeType: 'audio/mpeg', sizeBytes: 4200000, sha256: 'local-demo-audio-sha256', storageBucket: 'local-demo', storageKey: null, status: 'STORED' as const, uploadedBy: localDemoUser.id, createdAt: now, updatedAt: now },
  ];

  const manualComments: AuditManualComments = {
    id: 'local-comments',
    auditId: audit.id,
    backOfficeComment: 'Comentario demo BO para validar separación visual del panel derecho.',
    helpdeskComment: 'Ticket demo generado para revisión local.',
    schoolServicesComment: null,
    financeComment: 'Validación demo de primer pago para pruebas visuales.',
    additionalComment: null,
    createdAt: now,
    updatedAt: now,
    updatedBy: localDemoUser.id,
  };

  const factRun: FactExtractionRun = { id: 'local-fact-run', auditId: audit.id, policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', extractorVersion: 'local-demo', artifactSetFingerprint: 'local-demo-artifacts', state: 'FROZEN', frozenAt: now, createdAt: now };

  const facts: StoredFact[] = [
    { id: 'local-fact-name', auditId: audit.id, runId: factRun.id, factType: 'student.name', classification: 'OBSERVABLE', value: 'Alumno Demo Local', sourceRef: { evidenceId: 'local-ev-pdf' }, confidence: 0.92, createdAt: now },
    { id: 'local-fact-calls', auditId: audit.id, runId: factRun.id, factType: 'contact.callAttempts', classification: 'OBSERVABLE', value: { observedCount: 17, sourceCompleteness: 'COMPLETE', events: [] }, sourceRef: { evidenceId: 'local-ev-audio' }, confidence: 0.86, createdAt: now },
  ];

  const evaluation = {
    policyCode: 'GDM_GAM_PRD_MLG_003',
    policyVersion: '5',
    suggestedOutcome: 'Procede cancelación',
    suggestedReason: 'Demo local con evidencia suficiente para validar la presentación visual. No es validación real.',
    outcomeStatus: 'ACTIONABLE',
    decisionStatus: 'READY',
    reviewRequired: true,
    factsFingerprint: 'local-facts-fingerprint',
    rulesFingerprint: 'local-rules-fingerprint',
    decisiveRules: ['GDM-V5-5.2-A-CONTACT-ATTEMPTS'],
    satisfiedRules: ['GDM-V5-5.2-A-CONTACT-ATTEMPTS'],
    unknownRules: [],
    notApplicableRules: [],
    missingData: [],
    evaluatedRules: [{ ruleId: 'GDM-V5-5.2-A-CONTACT-ATTEMPTS', status: 'SATISFIED', source: { documentCode: 'GDM_GAM_PRD_MLG_003', version: '5', section: '5.2', page: 1 }, conditions: [] }],
  } as unknown as PolicyEvaluation;

  const artifacts: JobArtifact[] = [{
    id: 'local-transcript',
    jobId: 'local-job',
    evidenceId: 'local-ev-audio',
    artifactType: 'audio-transcript',
    contentSha256: 'local-transcript-sha256',
    createdAt: now,
    result: { evidenceId: 'local-ev-audio', utterances: [
      { speaker: 'Asesor', start: 15000, text: 'Buen día, se comunica al área de retención y control escolar.' },
      { speaker: 'Cliente', start: 38000, text: 'Hola, llamo para verificar el estatus de mi baja y la recepción de documentos.' },
      { speaker: 'Asesor', start: 72000, text: 'Permíteme validar en sistema la confirmación de recepción física.' },
    ] },
  }];

  return {
    audit,
    manualComments,
    evidences,
    artifacts,
    humanReview: null as HumanReviewRecord | null,
    evidenceSelection: [] as EvidenceSelectionRecord[],
    snapshot: null as ReportSnapshotRecord | null,
    dictamenDocuments: [] as DictamenDocumentRecord[],
    timelineEvents: [{ id: 'local-log', eventType: 'LOCAL_DEMO_LOADED', actorId: localDemoUser.id, createdAt: now, metadata: { mode: 'LOCAL_DEMO' } }],
    factRuns: [factRun],
    facts,
    evaluation,
  };
}
