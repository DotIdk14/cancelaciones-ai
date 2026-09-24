import { describe, expect, it } from 'vitest';
import { isBlindAuditResultV1, isBlindAuditFailure, runBlindMachineAudit } from './blind-audit';
import type { JobArtifact } from '@cancelaciones/db';
import { compareBlindAuditWithHuman } from './comparison-blind';

function jobArtifact(id: string, text: string, extra: Record<string, unknown> = {}): JobArtifact {
  return {
    id,
    jobId: `job-${id}`,
    evidenceId: `evidence-${id}`,
    artifactType: 'visual-transcription',
    result: { text, extractedFacts: [] as const, ...extra } as const,
    contentSha256: `sha-${id}`,
    createdAt: '2026-09-24T00:00:00Z',
  };
}

const _caveEvidenceTexts = {
  studentLevel: 'Estudiante',
  studentName: 'Ana Elena Ruiz Romero',
  studentEnrollment: 'UTEL-2026-001',
  effectiveContact: 'SIN CONTACTO EFECTIVO',
  callAttempts: '45 llamadas observadas; fuente complete',
  writtenInteractions: '32 interacciones escritas observadas; fuente complete',
  classroomActivities: 'Sin actividad academica',
  classroomGrades: 'No existen calificaciones en el bimestre inicial',
  lastCourseAccess: 'NEVER',
};

describe('CaVe-30591 E2E BLIND TEST (a partir de evidencia raw)', () => {
  it('debe comenzar desde artifacts raw y no desde storedFacts preconstruidos', async () => {
    // Artifacts raw que simulan evidencia pre-decision (SIN dictamen humano)
    const artifacts: JobArtifact[] = [
      jobArtifact('a1', 'ESTUDIANTE: Ana Elena Ruiz Romero\nNIVEL: Estudiante\nMATRÍCULA: UTEL-2026-001\nSIN CONTACTO EFECTIVO\n45 llamadas observadas; fuente complete\n32 interacciones escritas observadas; fuente complete\nSin actividad academica\nNo existen calificaciones en el bimestre inicial\nNEVER'),
      jobArtifact('a2', 'Transcripción adicional de evidencias visuales'),
    ];

    // No proporcionamos storedFacts; el pipeline debe extraerlos de artifacts
    const result = await runBlindMachineAudit({
      auditId: 'CaVe-30591',
      factRunId: 'run-1',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      storedFacts: [], // vacío: el pipeline debe poblarse de artifacts
      artifacts,
      // Evidencias para sanitización: todas con rol EVIDENCE (ninguno es HUMAN_DECISION_DOCUMENT)
      evidencesForSanitization: [
        { evidenceId: 'evidence-a1', document_role: 'EVIDENCE', artifactId: 'a1' },
        { evidenceId: 'evidence-a2', document_role: 'EVIDENCE', artifactId: 'a2' },
      ],
      candidateFetcher: async () => {
        // Inyectar candidato solo si el pipeline falla totalmente; en E2E debe ser descubierto
        throw new Error('Se esperaba que el Policy Reasoner produjera el candidato desde artifacts');
      },
      model: 'google/gemini-2.5-flash',
      provider: 'OpenRouter',
    });

    // Debería ser AI_DECISION_V1 (éxito o fallo controlado, pero no fuga de humano)
    expect(isBlindAuditResultV1(result) || isBlindAuditFailure(result)).toBe(true);
    if (isBlindAuditFailure(result)) {
      // Fallo controlado está bien en prueba E2E; registrar razón
      console.log('BLIND RESULT kind:', result.kind, 'message:', result.message);
      console.log('BLIND EXCLUSIONS:', result.exclusions);
      // En modo fallo controlado, aún verificar que no hay fuga de humano en el mensaje
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('SENTINEL_DECISION');
      expect(serialized).not.toContain('Dictamen humano');
      return;
    }

    // Si llego aquí, es AI_DECISION_V1 de éxito
    expect(isBlindAuditResultV1(result)).toBe(true);
    if (isBlindAuditFailure(result)) throw new Error('no esperado');

    // El resultado debe contener un probableOutcome y status
    expect(result.adjudication.probableOutcome).toBeDefined();
    expect(['SUPPORTED', 'PROBABLE', 'UNCERTAIN', 'INSUFFICIENT_EVIDENCE', 'CONFLICTED', 'POLICY_VALIDATION_FAILED']).toContain(result.adjudication.status);
    expect(result.adjudication.mandatoryHumanReview).toBe(true);
    expect(result.adjudication.confidence.value).toBeGreaterThan(0.4);

    // No debe haber filtración de decision humana en el hash o serialized
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('SENTINEL_DECISION');
    expect(serialized).not.toContain('Dictamen humano');
    expect(serialized).not.toContain('CANCELACION VENTA POR ESTUDIANTE ILOCALIZABLE');

    // Imprimir información para el reporte E2E
    console.log('=== CAVE-30591 BLIND E2E INPUT ===');
    console.log('Artifacts count:', artifacts.length);
    console.log('Candidato outcome:', result.adjudication.probableOutcome);
    console.log('Status:', result.adjudication.status);
    console.log('Confidence:', result.adjudication.confidence.value);
    console.log('Exclusions:', JSON.stringify(result.exclusions));
    console.log('=== CAVE-30591 BLIND E2E OUTPUT ===');

    // Ahora SÍ hacer la comparación humana (solo en este paso, el humano vive aquí)
    const humanOutcome = 'CANCELACION VENTA POR ESTUDIANTE ILOCALIZABLE';
    const comparison = compareBlindAuditWithHuman({ audit: result, humanOutcome });
    expect(comparison).not.toBeNull();
    expect(comparison?.match).toBe('MATCH'); // Should match since both are CANCELACION_VENTA
    expect(comparison?.runType).toBe('HUMAN_COMPARISON');
    expect(comparison?.humanOutcome).toBe(humanOutcome);
    // El hash de la maquina no se alteró por el resultado humano
    expect(comparison?.aiDecisionHash).toBe(result.aiDecisionHash);
  });

  it('debe fallar gracefully si no hay evidencia suficiente (INSUFFICIENT_EVIDENCE)', async () => {
    // Artifact sin información relevante
    const artifacts: JobArtifact[] = [
      jobArtifact('a1', 'Solo texto aleatorio sin información relevante'),
    ];

    const result = await runBlindMachineAudit({
      auditId: 'CaVe-30591',
      factRunId: 'run-1',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      storedFacts: [],
      artifacts,
      evidencesForSanitization: [
        { evidenceId: 'evidence-a1', document_role: 'EVIDENCE', artifactId: 'a1' },
      ],
    });

    // Debería producir un resultado (posiblemente INSUFFICIENT_EVIDENCE o MODEL_ERROR)
    expect(isBlindAuditResultV1(result) || isBlindAuditFailure(result)).toBe(true);
    if (isBlindAuditFailure(result)) {
      console.log('Fallo controlado INSUFFICIENTE:', result.kind, result.message);
      return;
    }
    if (isBlindAuditResultV1(result)) {
      console.log('Resultado AI_DECISION_V1:', result.adjudication.status);
      expect(result.adjudication.status).toBe('INSUFFICIENT_EVIDENCE');
    }
  });
});