import { describe, expect, it } from 'vitest';
import { businessDaysBetween, calculateInteractionDistribution, compareHistoricalOutcome, evaluatePolicy, isBusinessDay } from './index';

const fact = (type: string, value: unknown) => ({ id: type, type, value });

describe('policy version isolation', () => {
  it('evaluates the same facts against an explicitly pinned version', () => {
    const facts = [fact('contact.callAttempts', []), fact('contact.writtenInteractions', [])];
    const v2 = evaluatePolicy({ policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '2', facts });
    const v5 = evaluatePolicy({ policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', facts });
    expect(v2.policyVersion).toBe('2');
    expect(v5.policyVersion).toBe('5');
    expect(v2.evaluatedRules.every((rule) => rule.source.version === '2')).toBe(true);
    expect(v5.evaluatedRules.every((rule) => rule.source.version === '5')).toBe(true);
    expect(v2.rulesFingerprint).not.toBe(v5.rulesFingerprint);
  });
});

describe('contact calculations', () => {
  it('does not turn missing facts into false', () => {
    const result = evaluatePolicy({ policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', facts: [] });
    expect(result.unknownRules).toContain('GDM-V5-5.2-A-CONTACT-ATTEMPTS');
    expect(result.missingData.some((item) => item.severity === 'BLOCKING')).toBe(true);
  });

  it('keeps written interaction distribution observable', () => {
    const result = calculateInteractionDistribution([
      { id: 'a', kind: 'WRITTEN', occurredAt: '2026-01-01T10:00:00Z' },
      { id: 'b', kind: 'WRITTEN', occurredAt: '2026-01-03T10:00:00Z' },
      { id: 'c', kind: 'WRITTEN', occurredAt: '2026-01-10T10:00:00Z' },
    ]);
    expect(result).toEqual({ week1: 2, week2: 1, total: 3 });
  });

  it('evaluates licenciatura criteria separately from other academic levels', () => {
    const licenciatura = evaluatePolicy({
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      facts: [
        fact('student.level', 'LICENCIATURA'),
        fact('contact.effectiveContact', false),
        fact('classroom.hasLogin', false),
        fact('classroom.hasEvaluationMode', false),
      ],
    });
    const posgrado = evaluatePolicy({
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      facts: [
        fact('student.level', 'POSGRADO'),
        fact('contact.effectiveContact', false),
        fact('classroom.hasActivities', false),
      ],
    });

    expect(licenciatura.evaluatedRules.some((rule) => rule.ruleId === 'GDM-V5-5.8-A-LICENCIATURA')).toBe(true);
    expect(posgrado.evaluatedRules.some((rule) => rule.ruleId === 'GDM-V5-5.8-A-NON-LICENCIATURA')).toBe(true);
    expect(licenciatura.evaluatedRules.find((rule) => rule.ruleId.includes('LICENCIATURA'))?.conditions.map((item) => item.id))
      .toContain('licenciatura-no-evaluation-mode');
    expect(posgrado.evaluatedRules.find((rule) => rule.ruleId.includes('NON-LICENCIATURA'))?.conditions.map((item) => item.id))
      .toContain('non-licenciatura-no-activity');
  });

  it('returns unknown for an incomplete written collection even when six rows are visible', () => {
    const result = evaluatePolicy({
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      facts: [
        fact('contact.callAttempts', { events: [], observedCount: 0, sourceCompleteness: 'COMPLETE' }),
        fact('contact.writtenInteractions', {
          events: Array.from({ length: 6 }, (_, index) => ({ kind: 'EMAIL', occurredAt: `2026-09-${index + 1}T10:00:00Z` })),
          observedCount: 6,
          sourceCompleteness: 'PARTIAL',
        }),
      ],
    });
    const rule = result.evaluatedRules.find((item) => item.ruleId === 'GDM-V5-5.2-A-CONTACT-ATTEMPTS');
    expect(rule?.conditions.find((item) => item.id === 'written-count')?.state).toBe('UNKNOWN');
  });

  it('implements the 5.7.e exclusion rule and removes it from coverage gaps', () => {
    const result = evaluatePolicy({
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      facts: [
        fact('classroom.hasGrades', true),
        fact('contact.effectiveContact', false),
        fact('student.level', 'LICENCIATURA'),
        fact('classroom.hasLogin', false),
        fact('classroom.hasEvaluationMode', false),
      ],
    });
    expect(result.evaluatedRules.some((rule) => rule.ruleId === 'GDM-V5-5.7-E-INITIAL-BIMESTER-GRADES')).toBe(true);
    expect(result.exclusions).toContain('GDM-V5-5.7-E-INITIAL-BIMESTER-GRADES');
    expect(result.softwareCoverageGaps.some((gap) => gap.includes('5.7.e'))).toBe(false);
  });

  it('does not select a non-licenciatura branch when academic level is missing', () => {
    const result = evaluatePolicy({
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      facts: [fact('contact.effectiveContact', false)],
    });
    expect(result.evaluatedRules.some((item) => item.ruleId === 'GDM-V5-5.8-A-ACADEMIC-LEVEL-UNKNOWN')).toBe(true);
    expect(result.suggestedOutcome).toBeNull();
  });

  it('keeps a known suggested outcome separate from review status', () => {
    const result = evaluatePolicy({
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      facts: [
        fact('contact.effectiveContact', false),
        fact('student.level', 'LICENCIATURA'),
        fact('classroom.hasLogin', false),
        fact('classroom.hasEvaluationMode', false),
      ],
    });

    expect(result.suggestedOutcome).toBe('CANCELACION_VENTA');
    expect(result.decisionStatus).toBe('REVIEW_REQUIRED');
    expect(result.reviewRequired).toBe(true);
    expect(result.supportingRules).toContain('GDM-V5-5.8-A-LICENCIATURA');
    expect(result.pendingRules).toContain('GDM-V5-5.2-A-CONTACT-ATTEMPTS');
    expect(result.nextActions.length).toBeGreaterThan(0);
  });

  it('does not treat UNKNOWN as support for an outcome', () => {
    const result = evaluatePolicy({
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '5',
      facts: [fact('student.level', 'LICENCIATURA')],
    });

    expect(result.suggestedOutcome).toBeNull();
    expect(result.decisionStatus).toBe('INDETERMINATE');
    expect(result.supportingRules).toEqual([]);
  });
});

describe('business days', () => {
  it('excludes weekends and handles boundaries', () => {
    expect(isBusinessDay('2026-09-21')).toBe(true);
    expect(isBusinessDay('2026-09-20')).toBe(false);
    expect(businessDaysBetween('2026-09-18', '2026-09-21')).toBe(1);
  });

  describe('normative shadow evaluation', () => {
    it('does not call an indeterminate machine result a mismatch', () => {
      const evaluation = evaluatePolicy({ policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', facts: [] });
      expect(compareHistoricalOutcome({ evaluation, humanOutcome: 'CANCELACION_VENTA' }).comparison).toBe('AI_INDETERMINATE');
    });

    it('blocks comparison across policy versions', () => {
      const evaluation = evaluatePolicy({ policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', facts: [] });
      expect(compareHistoricalOutcome({ evaluation, humanOutcome: 'BAJA', humanPolicyVersion: '2' }).classification).toBe('POLICY_VERSION_MISMATCH');
    });
  });
});
