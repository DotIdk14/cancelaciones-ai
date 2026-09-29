import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../src/server/env';
import { runAudit } from '../src/server/audit-service';
import type { AuditResult } from '../src/skills/audit/schema';
import { fakeClient, getCase, listAudits, resetStore, seedCase, seedEvidence } from './helpers/fake-store';

vi.mock('../src/server/cases', async () => {
  const store = await import('./helpers/fake-store');
  return {
    getCaseOr404: store.getCaseOr404,
    listEvidenceRows: store.listEvidenceRows,
    updateEvidenceStatus: store.updateEvidenceStatus,
    latestAudit: store.latestAudit,
    latestCompletedAuditByFingerprint: store.latestCompletedAuditByFingerprint,
    latestRunningAuditByFingerprint: store.latestRunningAuditByFingerprint,
    countAuditsByFingerprint: store.countAuditsByFingerprint,
    insertAudit: store.insertAudit,
    updateAuditResult: store.updateAuditResult,
    updateCaseStatus: store.updateCaseStatus,
  };
});

vi.mock('../src/server/assemblyai', () => ({ getTranscription: vi.fn() }));

afterEach(() => {
  resetStore();
  resetEnvCache();
});

describe.skipIf(process.env.RUN_AI_SMOKE !== '1' || !process.env.OPENROUTER_API_KEY)('smoke live OpenRouter (evidencia sintética)', () => {
  it('completa una auditoría durable en memoria con assessment validado y trazable', async () => {
    process.env.INSFORGE_BASE_URL ??= 'https://synthetic.insforge.invalid';
    process.env.INSFORGE_ANON_KEY ??= 'synthetic-anon';
    process.env.INSFORGE_API_KEY ??= 'synthetic-admin';
    process.env.TRANSCRIPTION_POLL_TIMEOUT_MS = '0';
    resetEnvCache();

    const caseId = 'synthetic-ai-smoke-case';
    const evidenceId = 'synthetic-evidence-001';
    seedCase({ id: caseId, student_identifier: null });
    seedEvidence({
      id: evidenceId,
      case_id: caseId,
      filename: 'solicitud-ficticia.txt',
      mime_type: 'text/plain',
      processing_status: 'READY',
      content: 'EJEMPLO FICTICIO PARA PRUEBA TECNICA. Una persona estudiante inventada solicita cancelar antes del inicio de actividades. No usar como caso real.',
    });

    const outcome = await runAudit(fakeClient, caseId);
    const result = (outcome.phase === 'done' ? outcome.audit.resultJson : null) as AuditResult | null;
    const evidenceIds = new Set([evidenceId]);
    expect(outcome.phase).toBe('done');
    expect(outcome.phase === 'done' ? outcome.audit.status : null).toBe('COMPLETED');
    expect(getCase(caseId)?.status).toBe('COMPLETED');
    expect(listAudits()[0]?.status).toBe('COMPLETED');
    expect(result).not.toBeNull();
    if (!result) throw new Error('Synthetic audit returned no result');
    const references = [
      ...result.evidenceSummary.map((item) => item.evidenceId),
      ...result.facts.flatMap((item) => item.evidenceIds),
      ...result.timeline.flatMap((item) => item.evidenceIds),
      ...result.conflicts.flatMap((item) => item.evidenceIds),
      ...result.audit.supportingEvidenceIds,
      ...result.audit.procedureChecks.flatMap((item) => item.evidenceIds),
      ...result.audit.missingEvidence.flatMap((item) => item.relatedEvidenceIds),
      ...(result.audit.provisionalResolution?.evidenceIds ?? []),
    ];

    expect(result.evidenceSummary.map((item) => item.evidenceId)).toContain(evidenceId);
    expect(result.audit.result).toMatch(/^(CANCELACION_VENTA|BAJA|CANCELACION_VENTA_OPERATIVA|CANCELACION_MATRICULA|DICTAMINACION|EVIDENCIA_INSUFICIENTE)$/);
    expect(result.audit.reasoning.trim().length).toBeGreaterThan(0);
    expect(result.audit.procedureSection.trim().length).toBeGreaterThan(0);
    expect(result.audit.supportingEvidenceIds.length).toBeGreaterThan(0);
    expect(references.every((id) => evidenceIds.has(id))).toBe(true);
    process.stdout.write(`AI_SMOKE_COMPLETED model=${result.model.model} promptTokens=${result.usage.promptTokens ?? 'n/a'} completionTokens=${result.usage.completionTokens ?? 'n/a'}\n`);
  }, 120_000);

  it('completa EVIDENCIA_INSUFICIENTE con requisitos ausentes sin fabricar referencias', async () => {
    process.env.INSFORGE_BASE_URL ??= 'https://synthetic.insforge.invalid';
    process.env.INSFORGE_ANON_KEY ??= 'synthetic-anon';
    process.env.INSFORGE_API_KEY ??= 'synthetic-admin';
    process.env.TRANSCRIPTION_POLL_TIMEOUT_MS = '0';
    resetEnvCache();

    const caseId = 'synthetic-missing-evidence-smoke-case';
    const evidenceId = 'synthetic-unrelated-evidence-002';
    seedCase({ id: caseId, student_identifier: null });
    seedEvidence({
      id: evidenceId,
      case_id: caseId,
      filename: 'nota-ficticia.txt',
      mime_type: 'text/plain',
      processing_status: 'READY',
      content: 'SIMULACIÓN TÉCNICA. Nota sin fechas, matrícula, registro de contacto ni evidencia de actividad académica. No contiene datos personales reales.',
    });

    const outcome = await runAudit(fakeClient, caseId);
    const result = (outcome.phase === 'done' ? outcome.audit.resultJson : null) as AuditResult | null;
    expect(outcome.phase).toBe('done');
    expect(outcome.phase === 'done' ? outcome.audit.status : null).toBe('COMPLETED');
    expect(result?.audit.result).toBe('EVIDENCIA_INSUFICIENTE');
    expect(result?.audit.provisionalResolution).not.toBeNull();
    expect(result?.audit.missingEvidence.some((item) => item.relatedEvidenceIds.length === 0)).toBe(true);
    expect(result?.audit.procedureChecks.some((item) => item.status === 'NO_DETERMINABLE' && item.evidenceIds.length === 0 && item.observedValues.length === 0)).toBe(true);
    process.stdout.write(`AI_SMOKE_INSUFFICIENT_COMPLETED model=${result?.model.model ?? 'n/a'}\n`);
  }, 120_000);
});
