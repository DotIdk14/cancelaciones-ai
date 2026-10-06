import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../src/server/env';
import { runAudit } from '../src/server/audit-service';
import type { AuditResult } from '../src/skills/audit/schema';
import { EVIDENCE_CHANNELS, EVIDENCE_COUNTRIES } from '../src/skills/audit/types';
import { fakeClient, getCase, listAudits, resetStore, seedCase, seedEvidence } from './helpers/fake-store';

vi.mock('../src/server/cases', async () => {
  const store = await import('./helpers/fake-store');
  return {
    getCaseOr404: store.getCaseOr404,
    getScopedCaseOr404: store.getScopedCaseOr404,
    derivedExtractionOf: store.derivedExtractionOf,
    persistDerivedExtraction: store.persistDerivedExtraction,
    assertCaseOwner: store.assertCaseOwner,
    listEvidenceRows: store.listEvidenceRows,
    updateEvidenceStatus: store.updateEvidenceStatus,
    latestAudit: store.latestAudit,
    latestCompletedAuditByFingerprint: store.latestCompletedAuditByFingerprint,
    latestRunningAuditByFingerprint: store.latestRunningAuditByFingerprint,
    countAuditsByFingerprint: store.countAuditsByFingerprint,
    insertAudit: store.insertAudit,
    updateAuditResult: store.updateAuditResult,
    updateCaseDimensions: store.updateCaseDimensions,
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
    expect(result.audit.result).toMatch(/^(CANCELACION_VENTA|CANCELACION_VENTA_PETICION_CLIENTE|BAJA|CANCELACION_VENTA_OPERATIVA|CANCELACION_MATRICULA|DICTAMINACION|EVIDENCIA_INSUFICIENTE)$/);
    expect(result.audit.reasoning.trim().length).toBeGreaterThan(0);
    expect(result.audit.procedureSection.trim().length).toBeGreaterThan(0);
    expect(result.audit.supportingEvidenceIds.length).toBeGreaterThan(0);
    expect(references.every((id) => evidenceIds.has(id))).toBe(true);
    // Review Focus #1: `origin` es requerido, así que el modelo DEBE emitirlo. Si no
    // lo hiciera, el assessment no validaría y este test no llegaría aquí. Se afirma
    // además que el valor está en el catálogo (o es `null`) y que, si afirma un valor,
    // trae la evidencia que lo acredita.
    expect(EVIDENCE_COUNTRIES.includes(result.origin.country as never) || result.origin.country === null).toBe(true);
    expect(EVIDENCE_CHANNELS.includes(result.origin.channel as never) || result.origin.channel === null).toBe(true);
    if (result.origin.country !== null || result.origin.channel !== null) {
      expect(result.origin.evidenceIds.length).toBeGreaterThan(0);
      expect(result.origin.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true);
    }
    process.stdout.write(
      `AI_SMOKE_COMPLETED model=${result.model.model} promptTokens=${result.usage.promptTokens ?? 'n/a'} completionTokens=${result.usage.completionTokens ?? 'n/a'} origin.country=${result.origin.country ?? 'null'} origin.channel=${result.origin.channel ?? 'null'}\n`,
    );
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

  it('CASO REAL: no confunde la fecha de creación de matrícula con el inicio de ciclo', async () => {
    // Regresión end-to-end del defecto que motivó `temporalAnalysis`.
    // Expediente sintético que reproduce la estructura del caso real: una fecha
    // administrativa (29/08) visible en un CRM y un mensaje de bienvenida que
    // acredita el inicio académico (28/09), con la solicitud del 24/09.
    // Ningún dato es real: son cadenas ficticias para comprobar la semántica.
    process.env.INSFORGE_BASE_URL ??= 'https://synthetic.insforge.invalid';
    process.env.INSFORGE_ANON_KEY ??= 'synthetic-anon';
    process.env.INSFORGE_API_KEY ??= 'synthetic-admin';
    process.env.TRANSCRIPTION_POLL_TIMEOUT_MS = '0';
    resetEnvCache();

    const caseId = 'synthetic-cycle-start-case';
    const crmId = 'synthetic-evidence-crm';
    const chatId = 'synthetic-evidence-chat';
    seedCase({ id: caseId, student_identifier: null });
    seedEvidence({
      id: crmId,
      case_id: caseId,
      filename: 'crm-ficticio.txt',
      mime_type: 'text/plain',
      processing_status: 'READY',
      content:
        'EJEMPLO FICTICIO. Captura de CRM: Fecha de creación: 29/08/2026. Fecha de decisión 35: 29/08/2026. Estudiante: Persona Inventada.',
    });
    seedEvidence({
      id: chatId,
      case_id: caseId,
      filename: 'whatsapp-ficticio.txt',
      mime_type: 'text/plain',
      processing_status: 'READY',
      content:
        'EJEMPLO FICTICIO. Conversación del 24/09/2026. Asesor: "Tu bimestre inicia el lunes 28 de septiembre". Estudiante: "Por motivos personales no voy a continuar como hago para dar de baja."',
    });

    const outcome = await runAudit(fakeClient, caseId);
    const result = (outcome.phase === 'done' ? outcome.audit.resultJson : null) as AuditResult | null;
    if (!result) throw new Error('Synthetic cycle-start audit returned no result');

    const temporal = result.temporalAnalysis;

    // La fecha de inicio debe ser la ACREDITADA por el mensaje de bienvenida,
    // nunca la fecha de creación ni la de decisión del CRM.
    expect(temporal.cycleStartDate).toBe('2026-09-28');
    expect(temporal.cycleStartEvidenceIds).toContain(chatId);
    expect(temporal.cycleStartEvidenceText).not.toBeNull();

    // La solicitud (24/09) es ANTERIOR al inicio (28/09): es cancelación de
    // venta, no una baja por solicitud posterior al inicio.
    expect(temporal.cancellationRequestDate).toBe('2026-09-24');
    expect(temporal.relationToCycleStart).toBe('ANTES_DEL_INICIO');
    expect(result.audit.result).not.toBe('BAJA');

    // La fecha administrativa se conserva como hecho aparte, sin promoverse.
    const creation = result.facts.find((fact) => fact.value === '2026-08-29');
    expect(creation).toBeDefined();
    expect(creation?.key).not.toBe('cycle_start_date');

    // Trazabilidad: el fact de la fecha de inicio existe y no se afirma con
    // certeza absoluta.
    const cycleStartFact = result.facts.find((fact) => fact.key === 'cycle_start_date');
    expect(cycleStartFact?.value).toBe('2026-09-28');
    expect(cycleStartFact?.confidence).toBeLessThan(1);
    expect(result.case.cycleStartDate).toBe(temporal.cycleStartDate);

    process.stdout.write(
      `AI_SMOKE_CYCLE_START_COMPLETED cycleStart=${temporal.cycleStartDate} request=${temporal.cancellationRequestDate} relation=${temporal.relationToCycleStart} result=${result.audit.result}\n`,
    );
  }, 120_000);
});
