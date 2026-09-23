// Fixture sintetico de Phase 7.
// MARCADO: SYNTHETIC / DEVELOPMENT ONLY y NON_PRODUCTION_VALIDATION.
// Crea una auditoria de control con facts, fact run congelado, engine run,
// comentarios manuales y evidencias sinteticas (sin PII) para poder ejercitar
// el workflow completo de dictamen sin expediente real.
// Este fixture NO cierra MVP Acceptance Gate.
import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  createAuditManualCommentsRepository,
  createAuditRepository,
  createEvidenceRepository,
  createFactRepository,
} from '@cancelaciones/db';
import { evaluatePolicy } from '@cancelaciones/policy-engine';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';
import { mapStoredFactsToPolicyFacts } from '@/server/policy/frozen-fact-run';

export const dynamic = 'force-dynamic';

const SYNTHETIC_TAG = 'SYNTHETIC / DEVELOPMENT ONLY / NON_PRODUCTION_VALIDATION';
const POLICY_CODE = 'GDM_GAM_PRD_MLG_003';
const POLICY_VERSION = '5';

function issuerName(): string {
  return 'el equipo de desarrollo de Cancelaciones AI';
}

// 16+ llamadas separadas 6h+, 7 interacciones escritas con distribucion 70/30,
// licenciatura sin login ni modalidad y sin calificaciones => caso de control.
function syntheticFacts(auditId: string, runId: string, evidenceIds: string[]) {
  const calls: Array<{ id: string; occurredAt: string; kind: 'CALL' }> = [];
  let t = Date.parse('2026-08-01T09:00:00-06:00');
  for (let i = 0; i < 17; i += 1) {
    calls.push({ id: `call-${i + 1}`, occurredAt: new Date(t).toISOString(), kind: 'CALL' });
    t += 7 * 3600000;
  }
  const written: Array<{ id: string; occurredAt: string; kind: 'WRITTEN' }> = [];
  let w = Date.parse('2026-08-01T12:00:00-06:00');
  for (let i = 0; i < 7; i += 1) {
    written.push({ id: `written-${i + 1}`, occurredAt: new Date(w).toISOString(), kind: 'WRITTEN' });
    w += i < 4 ? 3600000 * 20 : 3600000 * 30;
  }

  return [
    {
      auditId,
      runId,
      factType: 'student.identity.name',
      value: 'Alumno de Control Sintetico',
      sourceRef: { evidenceId: evidenceIds[0] ?? null, note: SYNTHETIC_TAG },
    },
    {
      auditId,
      runId,
      factType: 'student.identity.enrollmentId',
      value: 'MAT-SINT-0001',
      sourceRef: { evidenceId: evidenceIds[0] ?? null, note: SYNTHETIC_TAG },
    },
    {
      auditId,
      runId,
      factType: 'student.email',
      value: 'alumno.sintetico@example.com',
      sourceRef: { evidenceId: evidenceIds[0] ?? null, note: SYNTHETIC_TAG },
    },
    {
      auditId,
      runId,
      factType: 'student.phone',
      value: '5550000000',
      sourceRef: { evidenceId: evidenceIds[0] ?? null, note: SYNTHETIC_TAG },
    },
    {
      auditId,
      runId,
      factType: 'sale.channel',
      value: 'Ventas',
      sourceRef: { evidenceId: evidenceIds[1] ?? null, note: SYNTHETIC_TAG },
    },
    {
      auditId,
      runId,
      factType: 'student.program',
      value: 'Licenciatura en Administracion',
      sourceRef: { evidenceId: evidenceIds[0] ?? null, note: SYNTHETIC_TAG },
    },
    {
      auditId,
      runId,
      factType: 'student.startDate',
      value: '2026-09-01T00:00:00-06:00',
      sourceRef: { evidenceId: evidenceIds[0] ?? null, note: SYNTHETIC_TAG },
    },
    {
      auditId,
      runId,
      factType: 'academic.lastCourseAccess',
      value: '2026-08-10T14:00:00-06:00',
      sourceRef: { evidenceId: evidenceIds[0] ?? null, note: SYNTHETIC_TAG },
    },
    {
      auditId,
      runId,
      factType: 'finance.firstPaymentDate',
      value: '2026-08-05T10:00:00-06:00',
      sourceRef: { evidenceId: evidenceIds[1] ?? null, note: SYNTHETIC_TAG },
    },
    {
      auditId,
      runId,
      factType: 'audit.ticketRequestDate',
      value: '2026-08-20T09:30:00-06:00',
      sourceRef: { evidenceId: evidenceIds[1] ?? null, note: SYNTHETIC_TAG },
    },
    {
      auditId,
      runId,
      factType: 'audit.assignedTo',
      value: 'Dictaminador Sintetico',
      sourceRef: { evidenceId: null, note: SYNTHETIC_TAG },
    },
    {
      auditId,
      runId,
      factType: 'audit.reason',
      value: 'Solicitud de cancelacion de venta antes de inicio de ciclo',
      sourceRef: { evidenceId: evidenceIds[1] ?? null, note: SYNTHETIC_TAG },
    },
    {
      auditId,
      runId,
      factType: 'audit.description',
      value: 'Descripcion sintetica de control (no reemplaza un expediente real).',
      sourceRef: { evidenceId: null, note: SYNTHETIC_TAG },
    },
    {
      auditId,
      runId,
      factType: 'contact.callAttempts',
      value: { events: calls, observedCount: calls.length, sourceCompleteness: 'COMPLETE' },
      sourceRef: { evidenceId: evidenceIds[0] ?? null, note: SYNTHETIC_TAG },
    },
    {
      auditId,
      runId,
      factType: 'contact.writtenInteractions',
      value: { events: written, observedCount: written.length, sourceCompleteness: 'COMPLETE' },
      sourceRef: { evidenceId: evidenceIds[0] ?? null, note: SYNTHETIC_TAG },
    },
    {
      auditId,
      runId,
      factType: 'contact.effectiveContact',
      value: false,
      sourceRef: { evidenceId: evidenceIds[0] ?? null, note: SYNTHETIC_TAG },
    },
    {
      auditId,
      runId,
      factType: 'classroom.hasGrades',
      value: false,
      sourceRef: { evidenceId: evidenceIds[1] ?? null, note: SYNTHETIC_TAG },
    },
    {
      auditId,
      runId,
      factType: 'student.level',
      value: 'LICENCIATURA',
      sourceRef: { evidenceId: evidenceIds[0] ?? null, note: SYNTHETIC_TAG },
    },
    {
      auditId,
      runId,
      factType: 'classroom.hasLogin',
      value: false,
      sourceRef: { evidenceId: evidenceIds[0] ?? null, note: SYNTHETIC_TAG },
    },
    {
      auditId,
      runId,
      factType: 'classroom.hasEvaluationMode',
      value: false,
      sourceRef: { evidenceId: evidenceIds[1] ?? null, note: SYNTHETIC_TAG },
    },
  ];
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'FORBIDDEN', message: 'El fixture sintetico solo esta disponible en desarrollo local.' }, { status: 403 });
  }

  const client = await createInsForgeServerClient();
  const audits = createAuditRepository(client.database);
  const factsRepo = createFactRepository(client.database);
  const evidencesRepo = createEvidenceRepository(client.database);
  const commentsRepo = createAuditManualCommentsRepository(client.database);

  const audit = await audits.create({
    createdBy: user.id,
    displayName: `[${SYNTHETIC_TAG}] Caso de control Phase 7`,
    externalCaseId: 'SINT-2026-0001',
  });

  // Evidencias sinteticas (sin subir archivo real; solo referencia para seleccion).
  const evidenceIds: string[] = [];
  for (const [index, name] of ['bitacora-contacto-sintetica.pdf', 'pantalla-crm-sintetica.png'].entries()) {
    const evidence = await evidencesRepo.createPending({
      id: randomUUID(),
      auditId: audit.id,
      originalFilename: `[SINTETICO] ${name}`,
      safeFilename: `sintetico-${index + 1}-${name}`,
      mimeType: name.endsWith('.pdf') ? 'application/pdf' : 'image/png',
      detectedMimeType: name.endsWith('.pdf') ? 'application/pdf' : 'image/png',
      sizeBytes: 0,
      sha256: createHash('sha256').update(`sintetico-${name}-phase7`).digest('hex'),
      storageBucket: 'evidencias',
      storageKey: `sintetico/${audit.id}/${name}`,
      uploadedBy: user.id,
    });
    evidenceIds.push(evidence.id);
  }

  const run = await factsRepo.createRun({
    auditId: audit.id,
    policyCode: POLICY_CODE,
    policyVersion: POLICY_VERSION,
    extractorVersion: 'synthetic-fixture-v1',
    artifactSetFingerprint: createHash('sha256').update(`synthetic-${audit.id}`).digest('hex'),
    createdBy: user.id,
  });
  await factsRepo.insertFacts(syntheticFacts(audit.id, run.id, evidenceIds));
  await factsRepo.freezeRun(run.id);

  const storedFacts = await factsRepo.listFactsByRun(run.id);
  const evaluation = evaluatePolicy({
    policyCode: POLICY_CODE,
    policyVersion: POLICY_VERSION,
    facts: mapStoredFactsToPolicyFacts(storedFacts),
  });
  const factsFingerprint = createHash('sha256').update(evaluation.factsFingerprint).digest('hex');
  const rulesFingerprint = createHash('sha256').update(evaluation.rulesFingerprint).digest('hex');

  const engineRun = await client.database
    .from('engine_runs')
    .insert([{
      audit_id: audit.id,
      fact_run_id: run.id,
      policy_code: evaluation.policyCode,
      policy_version: evaluation.policyVersion,
      rules_fingerprint: rulesFingerprint,
      facts_fingerprint: factsFingerprint,
      status: 'COMPLETED',
      suggested_outcome: evaluation.suggestedOutcome,
      outcome_status: evaluation.outcomeStatus,
      evaluation,
    }])
    .select('*')
    .single();
  if (engineRun.error || !engineRun.data) {
    return NextResponse.json({ error: 'DATABASE_ERROR', message: engineRun.error?.message ?? 'No fue posible crear el engine run sintetico.' }, { status: 500 });
  }

  await commentsRepo.upsert({
    auditId: audit.id,
    actorId: user.id,
    comments: {
      backOfficeComment: `Comentario BO sintetico. ${SYNTHETIC_TAG}`,
      helpdeskComment: 'Comentario HelpDesk sintetico: ticket de control.',
      schoolServicesComment: 'Comentario SER sintetico: sin reporte academico real.',
      financeComment: 'Comentario Finanzas sintetico: primer pago registrado en fixture.',
      additionalComment: null,
    },
  });

  return NextResponse.json({
    auditId: audit.id,
    factRunId: run.id,
    engineRunId: engineRun.data.id,
    suggestedOutcome: evaluation.suggestedOutcome,
    outcomeStatus: evaluation.outcomeStatus,
    evidenceIds,
    note: `Fixture creado por ${issuerName()}. ${SYNTHETIC_TAG}. No usar para cerrar MVP Acceptance Gate.`,
  }, { status: 201 });
}