import { stableFingerprint } from '@cancelaciones/domain';
import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '@cancelaciones/policy-engine';
import { mapSnapshotFactsToPolicyFacts, mapStoredFactsToPolicyFacts, validateFrozenFactRun } from './frozen-fact-run';
import type { FactExtractionRun, StoredFact } from '@cancelaciones/db';

const frozenRun: FactExtractionRun = {
  id: 'run-1', auditId: 'audit-1', policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', extractorVersion: 'test', artifactSetFingerprint: 'artifact-fp', state: 'FROZEN', frozenAt: '2026-09-22T00:00:00Z', createdAt: '2026-09-22T00:00:00Z',
};

const facts: StoredFact[] = [{
  id: 'fact-1', auditId: 'audit-1', runId: 'run-1', factType: 'contact.effectiveContact', classification: 'OBSERVABLE', value: false,
  sourceRef: { evidenceId: 'evidence-1', artifactId: 'artifact-1', page: 1 }, confidence: 0.9, createdAt: '2026-09-22T00:00:00Z',
}];

describe('frozen fact run policy integration', () => {
  it('rechaza evaluacion sin Fact Run FROZEN', () => {
    expect(validateFrozenFactRun({ auditId: 'audit-1', policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', run: { ...frozenRun, state: 'DRAFT', frozenAt: null } }).ok).toBe(false);
    expect(validateFrozenFactRun({ auditId: 'audit-1', policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', run: null }).ok).toBe(false);
  });

  it('rechaza Fact Run de otra auditoria', () => {
    const result = validateFrozenFactRun({ auditId: 'audit-2', policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', run: frozenRun });
    expect(result).toMatchObject({ ok: false, code: 'FACT_RUN_AUDIT_MISMATCH' });
  });

  it('rechaza policy version incompatible', () => {
    const result = validateFrozenFactRun({ auditId: 'audit-1', policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '2', run: frozenRun });
    expect(result).toMatchObject({ ok: false, code: 'POLICY_VERSION_MISMATCH' });
  });

  it('carga facts reales y conserva trace a evidence/artifact', () => {
    const policyFacts = mapStoredFactsToPolicyFacts(facts);
    const evaluation = evaluatePolicy({ policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', facts: policyFacts });
    expect(policyFacts).toHaveLength(1);
    expect(evaluation.factsFingerprint).toBe(stableFingerprint(policyFacts));
    expect(evaluation.evaluatedRules.some((rule) => rule.evidenceRefs.some((ref) => ref.evidenceId === 'evidence-1' && ref.artifactId === 'artifact-1'))).toBe(true);
    expect(evaluation.unknownRules.length).toBeGreaterThan(0);
  });

  it('mismo Fact Run y mismas reglas produce evaluacion idempotente', () => {
    const policyFacts = mapStoredFactsToPolicyFacts(facts);
    const first = evaluatePolicy({ policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', facts: policyFacts });
    const second = evaluatePolicy({ policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', facts: policyFacts });
    expect(second.factsFingerprint).toBe(first.factsFingerprint);
    expect(second.rulesFingerprint).toBe(first.rulesFingerprint);
  });
});

describe('adapter del snapshot congelado (Step 6)', () => {
  it('reproduce el mismo array de hechos, y por tanto la misma huella, que la ruta legacy', () => {
    const legacy = mapStoredFactsToPolicyFacts(facts);
    const fromSnapshot = mapSnapshotFactsToPolicyFacts([
      { id: 'fact-1', type: 'contact.effectiveContact', value: false, source: { evidenceId: 'evidence-1', artifactId: 'artifact-1', page: 1 }, extractionConfidence: 0.9 },
    ]);

    expect(fromSnapshot).toEqual(legacy);
    expect(stableFingerprint(fromSnapshot)).toBe(stableFingerprint(legacy));
  });

  it('conserva un valor corregido a proposito, sin reinterpretarlo', () => {
    const corrected = mapSnapshotFactsToPolicyFacts([
      { id: 'fact-1', type: 'contact.effectiveContact', value: true, source: { evidenceId: 'evidence-1', artifactId: 'artifact-1', page: 1 }, extractionConfidence: 0.9 },
    ]);
    expect(corrected[0].value).toBe(true);
    expect(stableFingerprint(corrected)).not.toBe(stableFingerprint(mapStoredFactsToPolicyFacts(facts)));
  });

  it('rechaza un snapshot mal formado en vez de devolver hechos silenciosamente distintos', () => {
    expect(() => mapSnapshotFactsToPolicyFacts('no-es-un-array')).toThrow('FROZEN_SNAPSHOT_PAYLOAD_INVALID');
    expect(() => mapSnapshotFactsToPolicyFacts([{ type: 'x', value: 1 }])).toThrow('FROZEN_SNAPSHOT_PAYLOAD_INVALID');
    expect(() => mapSnapshotFactsToPolicyFacts([{ id: 'x', value: 1 }])).toThrow('FROZEN_SNAPSHOT_PAYLOAD_INVALID');
    expect(() => mapSnapshotFactsToPolicyFacts([{ id: 'x', type: 'y' }])).toThrow('FROZEN_SNAPSHOT_PAYLOAD_INVALID');
    expect(() => mapSnapshotFactsToPolicyFacts([null])).toThrow('FROZEN_SNAPSHOT_PAYLOAD_INVALID');
  });

  it('tolera campos opcionales ausentes sin inventar valores', () => {
    const minimal = mapSnapshotFactsToPolicyFacts([{ id: 'fact-2', type: 'student.level', value: null }]);
    expect(minimal[0]).toEqual({ id: 'fact-2', type: 'student.level', value: null });
  });
});
