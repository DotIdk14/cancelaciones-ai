import { stableFingerprint } from '@cancelaciones/domain';
import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '@cancelaciones/policy-engine';
import { mapStoredFactsToPolicyFacts, validateFrozenFactRun } from './frozen-fact-run';
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
