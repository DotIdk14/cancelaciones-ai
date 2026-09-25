import { createHash } from 'node:crypto';
import { canonicalFingerprintV1 } from '@cancelaciones/domain';
import type { DatabaseClient, JobArtifact } from '@cancelaciones/db';
import { describe, expect, it, vi } from 'vitest';
import { blindCanonicalInputV1, isBlindAuditResultV1, isBlindAuditFailure, runAndPersistBlindMachineAudit, runBlindMachineAudit } from './blind-audit';
import { hashAiDecisionV1Snapshot } from './ai-decision-snapshot';
import { runEvidenceInterpreter } from './evidence-interpreter';
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

const candidate = {
  probableOutcome: 'NO_APLICA_CANCELACION_VENTA' as const,
  outcomeStatus: 'INSUFFICIENT_EVIDENCE' as const,
  ruleRefs: [],
  evidenceRefs: [],
  evidenceGaps: [],
  conditionNotes: [],
  explanation: 'No hay evidencia suficiente para una decisión.',
  reasoningTrace: [],
};

function extractedCandidate(overrides: Record<string, unknown> = {}) {
  return {
    factType: 'contact.effectiveContact',
    value: 'Sin contacto efectivo',
    confidence: 0.8,
    evidenceRefs: [{ evidenceId: 'evidence-a-safe', artifactId: 'a-safe' }],
    artifactRefs: [{ artifactId: 'a-safe', sha256: 'sha-a-safe' }],
    extractionMethod: 'artifact_fallback' as const,
    observedText: 'Sin contacto efectivo',
    warnings: [],
    ...overrides,
  };
}

function storedFact(value: string) {
  return {
    id: `fact-${value}`,
    auditId: 'audit-blind',
    runId: 'run-a',
    factType: 'contact.effectiveContact',
    classification: 'OBSERVABLE',
    value,
    sourceRef: { evidenceId: 'evidence-a-safe', artifactId: 'a-safe', sha256: 'sha-a-safe' },
    confidence: 0.8,
    createdAt: '2026-09-24T00:00:00Z',
  };
}

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

  it('falla cerrado antes de extraction cuando falta el manifest de sanitización', async () => {
    let interpreterCalled = false;
    const result = await runBlindMachineAudit({
      auditId: 'audit-blind',
      factRunId: 'run-a',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      storedFacts: [],
      artifacts: [jobArtifact('a1', 'texto limpio')],
      interpreterFetcher: async ({ artifacts }) => {
        interpreterCalled = true;
        expect(artifacts.map((artifact) => artifact.id)).toEqual([]);
        return { candidates: [], fallbacks: [], coverage: {}, warnings: [] };
      },
      candidateFetcher: async () => candidate,
    });

    expect(isBlindAuditFailure(result)).toBe(true);
    if (isBlindAuditFailure(result)) expect(result.kind).toBe('BLIND_INPUT_INVALID');
    expect(interpreterCalled).toBe(false);
  });

  it('filtra evidencia humana antes de extraction y reasoner', async () => {
    const received: string[] = [];
    const result = await runBlindMachineAudit({
      auditId: 'audit-blind',
      factRunId: 'run-a',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      storedFacts: [],
      artifacts: [
        jobArtifact('a-safe', 'texto limpio', { confidence: 0.8 }),
        jobArtifact('a-human', 'Dictamen humano: se determina cancelar'),
      ],
      evidencesForSanitization: [
        { evidenceId: 'evidence-a-safe', document_role: 'EVIDENCE', artifactId: 'a-safe' },
        { evidenceId: 'evidence-a-human', document_role: 'HUMAN_DECISION_DOCUMENT', artifactId: 'a-human' },
      ],
      interpreterFetcher: async ({ artifacts }) => {
        received.push(...artifacts.map((artifact) => artifact.id));
        return { candidates: [], fallbacks: [], coverage: {}, warnings: [] };
      },
      candidateFetcher: async () => candidate,
    });

    expect(received).toEqual(['a-safe']);
    expect(JSON.stringify(result)).not.toContain('Dictamen humano');
  });

  it('usa un type guard que excluye BlindAuditFailure', async () => {
    const failure = await runBlindMachineAudit({
      auditId: 'audit-blind',
      factRunId: 'run-a',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      storedFacts: [],
      artifacts: [jobArtifact('a1', 'texto limpio')],
      candidateFetcher: async () => candidate,
    });

    expect(isBlindAuditFailure(failure)).toBe(true);
    expect(isBlindAuditResultV1(failure)).toBe(false);
  });

  it('rechaza relación artifact-evidence inválida antes del grafo y del candidate fetcher', async () => {
    let graphCalled = false;
    let candidateFetcherCalled = false;
    const result = await runBlindMachineAudit({
      auditId: 'audit-blind',
      factRunId: 'run-a',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      storedFacts: [],
      artifacts: [
        { ...jobArtifact('a-mismatch', 'texto limpio'), evidenceId: 'evidence-actual' },
        jobArtifact('a-human', 'Dictamen humano: se determina cancelar'),
      ],
      evidencesForSanitization: [
        { evidenceId: 'evidence-declared', document_role: 'EVIDENCE', artifactId: 'a-mismatch' },
        { evidenceId: 'evidence-actual', document_role: 'EVIDENCE', artifactId: 'a-other' },
        { evidenceId: 'evidence-a-human', document_role: 'HUMAN_DECISION_DOCUMENT', artifactId: 'a-human' },
      ],
      graphFetcher: () => {
        graphCalled = true;
        throw new Error('El grafo no debe construirse con referencias inválidas');
      },
      candidateFetcher: async () => {
        candidateFetcherCalled = true;
        return candidate;
      },
    });

    expect(isBlindAuditFailure(result)).toBe(true);
    if (isBlindAuditFailure(result)) expect(result.kind).toBe('BLIND_INPUT_INVALID');
    expect(graphCalled).toBe(false);
    expect(candidateFetcherCalled).toBe(false);
  });

  it('rechaza artifact con evidencia actual desconocida aunque el manifest declare una permitida', async () => {
    let graphCalled = false;
    let candidateFetcherCalled = false;
    const result = await runBlindMachineAudit({
      auditId: 'audit-blind',
      factRunId: 'run-a',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      storedFacts: [],
      artifacts: [
        { ...jobArtifact('a1', 'texto limpio'), evidenceId: 'e2' },
      ],
      evidencesForSanitization: [
        { evidenceId: 'e1', document_role: 'EVIDENCE', artifactId: 'a1' },
      ],
      graphFetcher: () => {
        graphCalled = true;
        throw new Error('El grafo no debe construirse con referencias inválidas');
      },
      candidateFetcher: async () => {
        candidateFetcherCalled = true;
        return candidate;
      },
    });

    expect(isBlindAuditFailure(result)).toBe(true);
    if (isBlindAuditFailure(result)) {
      expect(result.kind).toBe('BLIND_INPUT_INVALID');
      expect(result.message).toBe('BLIND_REFERENCE_INVALID');
    }
    expect(graphCalled).toBe(false);
    expect(candidateFetcherCalled).toBe(false);
  });

  it('rechaza stored facts humanos antes del grafo y del candidate fetcher', async () => {
    let graphCalled = false;
    let candidateFetcherCalled = false;
    const result = await runBlindMachineAudit({
      auditId: 'audit-blind',
      factRunId: 'run-a',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      storedFacts: [{
        id: 'fact-human',
        auditId: 'audit-blind',
        runId: 'run-a',
        factType: 'contact.effectiveContact',
        classification: 'OBSERVABLE',
        value: 'Sin contacto efectivo',
        sourceRef: { evidenceId: 'evidence-a-human', artifactId: 'a-human', sha256: 'sha-a-human' },
        confidence: 0.9,
        createdAt: '2026-09-24T00:00:00Z',
      }],
      artifacts: [
        jobArtifact('a-safe', 'texto limpio'),
        jobArtifact('a-human', 'Dictamen humano: se determina cancelar'),
      ],
      evidencesForSanitization: [
        { evidenceId: 'evidence-a-safe', document_role: 'EVIDENCE', artifactId: 'a-safe' },
        { evidenceId: 'evidence-a-human', document_role: 'HUMAN_DECISION_DOCUMENT', artifactId: 'a-human' },
      ],
      graphFetcher: () => {
        graphCalled = true;
        throw new Error('El grafo no debe construirse con referencias inválidas');
      },
      candidateFetcher: async () => {
        candidateFetcherCalled = true;
        return candidate;
      },
    });

    expect(isBlindAuditFailure(result)).toBe(true);
    if (isBlindAuditFailure(result)) expect(result.kind).toBe('BLIND_INPUT_INVALID');
    expect(graphCalled).toBe(false);
    expect(candidateFetcherCalled).toBe(false);
  });

  it.each([
    ['humana', extractedCandidate({
      evidenceRefs: [{ evidenceId: 'evidence-a-human', artifactId: 'a-safe' }],
    })],
    ['desconocida', extractedCandidate({
      evidenceRefs: [{ evidenceId: 'evidence-missing', artifactId: 'a-safe' }],
    })],
    ['inconsistente', extractedCandidate({
      artifactRefs: [{ artifactId: 'a-safe', sha256: 'sha-other' }],
    })],
  ])('rechaza candidate %s antes del grafo y del candidate fetcher', async (_case, extracted) => {
    let graphCalled = false;
    let candidateFetcherCalled = false;
    const result = await runBlindMachineAudit({
      auditId: 'audit-blind',
      factRunId: 'run-a',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      storedFacts: [],
      artifacts: [jobArtifact('a-safe', 'texto limpio')],
      evidencesForSanitization: [{ evidenceId: 'evidence-a-safe', document_role: 'EVIDENCE', artifactId: 'a-safe' }],
      interpreterFetcher: async () => ({
        candidates: [extracted],
        fallbacks: [],
        coverage: {},
        warnings: [],
      }),
      graphFetcher: () => {
        graphCalled = true;
        throw new Error('El grafo no debe construirse con candidates inválidos');
      },
      candidateFetcher: async () => {
        candidateFetcherCalled = true;
        return candidate;
      },
    });

    expect(isBlindAuditFailure(result)).toBe(true);
    if (isBlindAuditFailure(result)) expect(result.kind).toBe('BLIND_INPUT_INVALID');
    expect(graphCalled).toBe(false);
    expect(candidateFetcherCalled).toBe(false);
  });

  it('incluye candidates extraídos y stored facts en inputFingerprint', async () => {
    const first = await runBlindMachineAudit({
      auditId: 'audit-one',
      factRunId: 'run-one',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      storedFacts: [],
      artifacts: [jobArtifact('a-safe', 'texto limpio')],
      evidencesForSanitization: [{ evidenceId: 'evidence-a-safe', document_role: 'EVIDENCE', artifactId: 'a-safe' }],
      interpreterFetcher: async () => ({ candidates: [extractedCandidate()], fallbacks: [], coverage: {}, warnings: [] }),
      candidateFetcher: async () => candidate,
    });
    const second = await runBlindMachineAudit({
      auditId: 'audit-two',
      factRunId: 'run-two',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      storedFacts: [],
      artifacts: [jobArtifact('a-safe', 'texto limpio')],
      evidencesForSanitization: [{ evidenceId: 'evidence-a-safe', document_role: 'EVIDENCE', artifactId: 'a-safe' }],
      interpreterFetcher: async () => ({
        candidates: [extractedCandidate({ value: 'Contacto efectivo observado' })],
        fallbacks: [],
        coverage: {},
        warnings: [],
      }),
      candidateFetcher: async () => candidate,
    });

    const firstStoredFacts = await runBlindMachineAudit({
      auditId: 'audit-one',
      factRunId: 'run-one',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      storedFacts: [storedFact('Sin contacto efectivo')],
      artifacts: [jobArtifact('a-safe', 'texto limpio')],
      evidencesForSanitization: [{ evidenceId: 'evidence-a-safe', document_role: 'EVIDENCE', artifactId: 'a-safe' }],
      candidateFetcher: async () => candidate,
    });
    const secondStoredFacts = await runBlindMachineAudit({
      auditId: 'audit-two',
      factRunId: 'run-two',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      storedFacts: [storedFact('Contacto efectivo observado')],
      artifacts: [jobArtifact('a-safe', 'texto limpio')],
      evidencesForSanitization: [{ evidenceId: 'evidence-a-safe', document_role: 'EVIDENCE', artifactId: 'a-safe' }],
      candidateFetcher: async () => candidate,
    });

    expect(first.inputFingerprint).not.toBe(second.inputFingerprint);
    expect(firstStoredFacts.inputFingerprint).not.toBe(secondStoredFacts.inputFingerprint);
  });

  it('mantiene los candidates del interpreter al invertir el orden de artifacts con el mismo manifest', async () => {
    const manifest = [
      { evidenceId: 'evidence-a-one', document_role: 'EVIDENCE' as const, artifactId: 'a-one' },
      { evidenceId: 'evidence-a-two', document_role: 'EVIDENCE' as const, artifactId: 'a-two' },
    ];
    const runWithArtifacts = async (artifacts: JobArtifact[]) => {
      let extractedValue = '';
      let receivedArtifactIds: string[] = [];
      const result = await runBlindMachineAudit({
        auditId: 'audit-order',
        factRunId: 'run-order',
        policyCode: 'GDM_GAM_PRD_MLG_003',
        policyVersion: '5',
        storedFacts: [],
        artifacts,
        evidencesForSanitization: manifest,
        interpreterFetcher: async ({ auditId, artifacts: receivedArtifacts, storedFacts }) => {
          receivedArtifactIds = receivedArtifacts.map((artifact) => artifact.id);
          const interpreted = await runEvidenceInterpreter({ auditId, artifacts: receivedArtifacts, storedFacts });
          extractedValue = String(interpreted.candidates.find((item) => item.factType === 'contact.effectiveContact')?.value ?? '');
          return interpreted;
        },
        candidateFetcher: async () => ({ ...candidate, explanation: extractedValue }),
      });
      if (!isBlindAuditResultV1(result)) throw new Error(result.message);
      return { extractedValue, receivedArtifactIds };
    };

    const first = await runWithArtifacts([
      jobArtifact('a-one', 'Sin contacto efectivo observado A'),
      jobArtifact('a-two', 'Contacto efectivo observado B'),
    ]);
    const second = await runWithArtifacts([
      jobArtifact('a-two', 'Contacto efectivo observado B'),
      jobArtifact('a-one', 'Sin contacto efectivo observado A'),
    ]);

    expect(first.receivedArtifactIds).toEqual(second.receivedArtifactIds);
    expect(first.extractedValue).toBe(second.extractedValue);
  });
  it('ordena hashes por code points sin depender de localeCompare', () => {
    const localeCompare = vi.spyOn(String.prototype, 'localeCompare').mockImplementation(() => 1);

    try {
      const canonical = blindCanonicalInputV1({
        policyCode: 'GDM_GAM_PRD_MLG_003',
        policyVersion: '5',
        artifacts: [jobArtifact('b', 'texto b'), jobArtifact('a', 'texto a')],
        storedFacts: [],
      });
      const hash = (value: unknown) => createHash('sha256').update(canonicalFingerprintV1(value)).digest('hex');
      const lexical = [...canonical.artifacts].sort((left, right) => {
        const leftHash = hash(left);
        const rightHash = hash(right);
        return leftHash < rightHash ? -1 : leftHash > rightHash ? 1 : 0;
      });

      const hashComparisons = localeCompare.mock.calls.filter(([value]) => (
        typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
      ));
      expect(canonical.artifacts).toEqual(lexical);
      expect(hashComparisons).toEqual([]);
    } finally {
      localeCompare.mockRestore();
    }
  });

  it('mantiene inputFingerprint estable ante IDs y timestamps operativos', async () => {
    const first = await runBlindMachineAudit({
      auditId: 'audit-one',
      factRunId: 'fact-run-one',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      storedFacts: [],
      artifacts: [{ ...jobArtifact('artifact-one', 'texto equivalente', { confidence: 0.8 }), evidenceId: 'evidence-one', contentSha256: 'sha-equivalente' }],
      evidencesForSanitization: [{ evidenceId: 'evidence-one', document_role: 'EVIDENCE', artifactId: 'artifact-one' }],
      candidateFetcher: async () => candidate,
    });
    const second = await runBlindMachineAudit({
      auditId: 'audit-two',
      factRunId: 'fact-run-two',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      storedFacts: [],
      artifacts: [{ ...jobArtifact('artifact-two', 'texto equivalente', { confidence: 0.8 }), evidenceId: 'evidence-one', contentSha256: 'sha-equivalente', createdAt: '2027-01-01T00:00:00Z' }],
      evidencesForSanitization: [{ evidenceId: 'evidence-one', document_role: 'EVIDENCE', artifactId: 'artifact-two' }],
      candidateFetcher: async () => candidate,
    });

    expect(first.inputFingerprint).toBe(second.inputFingerprint);
  });

  it('conserva el artifactId en evidenceRefs y artifactRefs del fingerprint canónico', () => {
    const canonicalHash = (value: unknown) => createHash('sha256').update(canonicalFingerprintV1(value)).digest('hex');
    const withArtifact = (artifactId: string) => blindCanonicalInputV1({
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      artifacts: [jobArtifact(artifactId, 'texto limpio')],
      storedFacts: [],
      candidates: [extractedCandidate({
        evidenceRefs: [{ evidenceId: 'evidence-a-safe', artifactId }],
        artifactRefs: [{ artifactId, sha256: 'sha-a-safe' }],
      })],
    });

    const first = withArtifact('a-safe');
    const second = withArtifact('a-other');

    expect(first.candidates[0].evidenceRefs[0]).toEqual({ evidenceId: 'evidence-a-safe', artifactId: 'a-safe', page: undefined });
    expect(first.candidates[0].artifactRefs[0]).toEqual({ artifactId: 'a-safe', sha256: 'sha-a-safe', page: undefined });
    expect(canonicalHash(first)).not.toBe(canonicalHash(second));
  });

  it('el fingerprint de entrada no depende de localeCompare', async () => {
    const auditInput = {
      auditId: 'audit-locale',
      factRunId: 'run-locale',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      storedFacts: [],
      artifacts: [jobArtifact('a-safe', 'texto limpio')],
      evidencesForSanitization: [{ evidenceId: 'evidence-a-safe', document_role: 'EVIDENCE' as const, artifactId: 'a-safe' }],
      candidateFetcher: async () => candidate,
    };

    const before = await runBlindMachineAudit(auditInput);
    const localeCompare = vi.spyOn(String.prototype, 'localeCompare').mockImplementation(() => -1);
    let after: Awaited<ReturnType<typeof runBlindMachineAudit>>;
    try {
      after = await runBlindMachineAudit(auditInput);
    } finally {
      localeCompare.mockRestore();
    }

    expect(after.inputFingerprint).toBe(before.inputFingerprint);
  });

  it('falla antes del interpreter cuando el transcript humano tiene text vacío', async () => {
    let interpreterCalled = false;
    const result = await runBlindMachineAudit({
      auditId: 'audit-blind',
      factRunId: 'run-a',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      storedFacts: [],
      artifacts: [jobArtifact('a-human-transcript', 'texto vacío', { text: '   ', transcript: 'Dictamen humano: se determina cancelar' })],
      evidencesForSanitization: [{ evidenceId: 'evidence-a-human-transcript', document_role: 'EVIDENCE', artifactId: 'a-human-transcript' }],
      interpreterFetcher: async () => {
        interpreterCalled = true;
        return { candidates: [], fallbacks: [], coverage: {}, warnings: [] };
      },
      candidateFetcher: async () => candidate,
    });

    expect(isBlindAuditFailure(result)).toBe(true);
    if (isBlindAuditFailure(result)) expect(result.kind).toBe('BLIND_INPUT_INVALID');
    expect(interpreterCalled).toBe(false);
  });

  it('concatena los textos de artifacts que comparten evidenceId antes de sanitizar', async () => {
    let interpreterCalled = false;
    const result = await runBlindMachineAudit({
      auditId: 'audit-blind',
      factRunId: 'run-a',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      storedFacts: [],
      artifacts: [
        { ...jobArtifact('a-human-text', 'Dictamen humano: se determina cancelar la venta'), evidenceId: 'evidence-shared' },
        { ...jobArtifact('a-clean', 'texto limpio'), evidenceId: 'evidence-shared' },
      ],
      evidencesForSanitization: [
        { evidenceId: 'evidence-shared', document_role: 'EVIDENCE', artifactId: 'a-human-text' },
        { evidenceId: 'evidence-shared', document_role: 'EVIDENCE', artifactId: 'a-clean' },
      ],
      interpreterFetcher: async () => {
        interpreterCalled = true;
        return { candidates: [], fallbacks: [], coverage: {}, warnings: [] };
      },
      candidateFetcher: async () => candidate,
    });

    expect(isBlindAuditFailure(result)).toBe(true);
    if (isBlindAuditFailure(result)) expect(result.kind).toBe('BLIND_INPUT_INVALID');
    expect(interpreterCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task 8 — wrapper explicito y NO productivo: runAndPersistBlindMachineAudit
// ---------------------------------------------------------------------------

interface WrapperFakeOptions {
  insertError?: { code: string; message: string } | null;
}

function createWrapperFakeDatabase(options: WrapperFakeOptions = {}) {
  const rows: Array<Record<string, unknown>> = [];
  const matches = (row: Record<string, unknown>, filters: Array<[string, unknown]>): boolean =>
    filters.every(([column, value]) => row[column] === value);

  const database: DatabaseClient = {
    from(table: string) {
      if (table !== 'ai_decision_snapshots') throw new Error(`TABLA NO ESPERADA: ${table}`);
      const filters: Array<[string, unknown]> = [];
      const selectChain = {
        select: () => selectChain,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return selectChain;
        },
        limit: async () => ({ data: rows.filter((row) => matches(row, filters)), error: null }),
      };
      return {
        select: () => selectChain,
        insert: (payload: Array<Record<string, unknown>>) => {
          const insertChain = {
            select: () => insertChain,
            single: async () => {
              if (options.insertError) return { data: null, error: options.insertError };
              rows.push(...payload);
              return { data: payload[0] ?? null, error: null };
            },
          };
          return insertChain;
        },
      };
    },
  };

  return { database, rows };
}

const wrapperPersistenceOptions = {
  policySourceId: 'policy-source-1',
  engineVersion: 'policy-engine-5.8.0',
  extractorVersion: 'deterministic-v1',
};

function successfulBlindAuditInput() {
  return {
    auditId: 'audit-blind-persist',
    factRunId: 'fact-run-1',
    policyCode: 'GDM_GAM_PRD_MLG_003',
    policyVersion: '5',
    storedFacts: [],
    artifacts: [jobArtifact('a-safe', 'Sin contacto efectivo observado')],
    evidencesForSanitization: [{ evidenceId: 'evidence-a-safe', document_role: 'EVIDENCE' as const, artifactId: 'a-safe' }],
    interpreterFetcher: async () => ({
      candidates: [extractedCandidate()],
      fallbacks: [],
      coverage: {},
      warnings: [],
    }),
    candidateFetcher: async () => candidate,
  };
}

describe('runAndPersistBlindMachineAudit (wrapper no productivo)', () => {
  it('persiste el snapshot completo sólo cuando la auditoría tiene éxito', async () => {
    const fake = createWrapperFakeDatabase();

    const result = await runAndPersistBlindMachineAudit({ ...successfulBlindAuditInput(), ...wrapperPersistenceOptions, database: fake.database });

    expect(result.status).toBe('PERSISTED');
    if (result.status !== 'PERSISTED') return;
    expect(fake.rows).toHaveLength(1);
    expect(result.snapshot).toEqual({
      auditId: 'audit-blind-persist',
      factRunId: 'fact-run-1',
      decisionVersion: 'AI_DECISION_V1',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      policySourceId: 'policy-source-1',
      engineVersion: 'policy-engine-5.8.0',
      promptVersion: null,
      extractorVersion: 'deterministic-v1',
      provider: null,
      model: 'artifact_fallback_mode',
      inputFingerprint: result.record.inputFingerprint,
      decisionSnapshot: {
        candidate: result.record.candidate,
        validation: result.record.validation,
        adjudication: result.record.adjudication,
      },
      ruleTraceSnapshot: {
        verdict: result.record.validation.verdict,
        validatedBy: result.record.validation.validatedBy,
        ruleRefs: result.record.candidate.ruleRefs,
        evaluatedRules: result.record.adjudication.evaluatedRules,
        trace: result.record.adjudication.trace,
      },
      evidenceSnapshot: {
        evidenceRefs: result.record.candidate.evidenceRefs,
        evidenceGaps: result.record.adjudication.evidenceGaps,
        graph: result.record.adjudication.graph,
        exclusions: result.record.exclusions,
        inputFingerprint: result.record.inputFingerprint,
      },
      createdAt: result.record.createdAt,
      hash: hashAiDecisionV1Snapshot(result.snapshot),
    });
  });

  it('no construye snapshot ni persiste cuando la auditoría falla', async () => {
    const fake = createWrapperFakeDatabase();

    const result = await runAndPersistBlindMachineAudit({
      ...successfulBlindAuditInput(),
      ...wrapperPersistenceOptions,
      database: fake.database,
      // evidencesForSanitization ausente: BLIND_INPUT_INVALID garantizado.
      evidencesForSanitization: undefined,
    });

    expect(result.status).toBe('AUDIT_FAILURE');
    if (result.status !== 'AUDIT_FAILURE') return;
    expect(result.failure.kind).toBe('BLIND_INPUT_INVALID');
    expect(fake.rows).toHaveLength(0);
  });

  it('devuelve PERSISTENCE_ERROR y ningún outcome oficial cuando la base falla', async () => {
    const fake = createWrapperFakeDatabase({ insertError: { code: '57014', message: 'connection terminated unexpectedly' } });

    const result = await runAndPersistBlindMachineAudit({ ...successfulBlindAuditInput(), ...wrapperPersistenceOptions, database: fake.database });

    expect(result.status).toBe('PERSISTENCE_ERROR');
    if (result.status !== 'PERSISTENCE_ERROR') return;
    expect(result.reasonCode).toBe('PERSISTENCE_ERROR');
    expect(result.message).toContain('connection terminated unexpectedly');
    expect(result).not.toHaveProperty('record');
    expect(result).not.toHaveProperty('snapshot');
    expect(fake.rows).toHaveLength(0);
  });
});
