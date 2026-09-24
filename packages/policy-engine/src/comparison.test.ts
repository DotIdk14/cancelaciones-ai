import { describe, expect, it } from 'vitest';
import type { HumanClaim } from '@cancelaciones/domain';
import {
  classifyDiscrepancy,
  compareHumanDecisionWithBaseline,
  normalizeHumanResolution,
  primitivesFromEvaluation,
} from './comparison';
import type { PolicyEvaluation } from './index';

const PENDING_FACTS = ['contact.callAttempts', 'contact.writtenInteractions'];

function baselineEvaluation(overrides: Partial<PolicyEvaluation> = {}): PolicyEvaluation {
  return {
    policyCode: 'GDM_GAM_PRD_MLG_003',
    policyVersion: '5',
    rulesFingerprint: 'rules-fp',
    factsFingerprint: 'facts-fp',
    evaluatedRules: [],
    satisfiedRules: [],
    unknownRules: [],
    notApplicableRules: [],
    missingData: [],
    conflicts: [],
    suggestedOutcome: 'CANCELACION_VENTA',
    outcomeStatus: 'DETERMINED',
    decisionStatus: 'READY_TO_APPROVE',
    reviewRequired: false,
    suggestedReason: null,
    decisiveRules: ['GDM-V5-5.2-A-CONTACT-ATTEMPTS'],
    supportingRules: [],
    opposingRules: [],
    pendingRules: [],
    conflictingRules: [],
    blockedRules: [],
    exclusions: ['GDM-V5-5.7-E-INITIAL-BIMESTER-GRADES'],
    missingEvidence: [],
    missingFacts: [],
    missingNormativeSources: [],
    softwareCoverageGaps: [],
    nextActions: [],
    explanation: '',
    trace: { decision: '', ruleIds: [], factIds: [], evidenceRefs: [] },
    ...overrides,
  };
}

const claim = (statement: string, classification: HumanClaim['classification']): HumanClaim => ({
  id: `claim-${statement.length}`,
  statement,
  classification,
});

describe('normalizeHumanResolution', () => {
  it('normaliza expresiones equivalentes al outcome canónico del motor', () => {
    expect(normalizeHumanResolution('PROCEDE')).toBe('CANCELACION_VENTA');
    expect(normalizeHumanResolution('No procede la cancelación')).toBe('NO_APLICA_CANCELACION_VENTA');
    expect(normalizeHumanResolution('Corresponde baja por devengamiento')).toBe('BAJA');
    expect(normalizeHumanResolution('Retención')).toBe('RETENCION');
    expect(normalizeHumanResolution(null)).toBeNull();
    expect(normalizeHumanResolution('ininteligible')).toBeNull();
  });
});

describe('compareHumanDecisionWithBaseline — MATCH', () => {
  it('declara MATCH cuando la resolución humana coincide con el outcome de la IA', () => {
    const result = compareHumanDecisionWithBaseline({
      ...primitivesFromEvaluation({
        evaluation: baselineEvaluation(),
        humanResolutionRaw: 'PROCEDE',
        humanClaims: [claim('16 llamadas realizadas', 'VERIFIED_FACT')],
      }),
    });
    expect(result.status).toBe('MATCH');
    expect(result.discrepancyType).toBeNull();
    expect(result.aiOutcome).toBe('CANCELACION_VENTA');
    expect(result.humanOutcome).toBe('CANCELACION_VENTA');
  });

  it('MATCH con advertencias mantiene el contrafactual si hay afirmaciones no verificadas', () => {
    const result = compareHumanDecisionWithBaseline({
      ...primitivesFromEvaluation({
        evaluation: baselineEvaluation(),
        humanResolutionRaw: 'PROCEDE',
        humanClaims: [claim('el asesor confirmó verbalmente la baja', 'MENTIONED_IN_HUMAN_DECISION')],
      }),
    });
    expect(result.status).toBe('MATCH');
    expect(result.unverifiedHumanClaims).toHaveLength(1);
    expect(result.counterfactuals.length).toBeGreaterThan(0);
  });
});

describe('compareHumanDecisionWithBaseline — DISCREPANCY', () => {
  it('clasifica MISSING_EVIDENCE cuando el humano usa hechos solo mencionados', () => {
    const result = compareHumanDecisionWithBaseline({
      ...primitivesFromEvaluation({
        evaluation: baselineEvaluation(),
        humanResolutionRaw: 'NO PROCEDE',
        humanClaims: [claim('el alumno cursó con calificaciones aprobatorias', 'MENTIONED_IN_HUMAN_DECISION')],
      }),
    });
    expect(result.status).toBe('DISCREPANCY');
    expect(result.discrepancyType).toBe('MISSING_EVIDENCE');
    expect(result.unverifiedHumanClaims.map((c) => c.classification)).toContain('MENTIONED_IN_HUMAN_DECISION');
  });

  it('clasifica HUMAN_USED_EXTERNAL_INFORMATION y SOFTWARE_COVERAGE_GAP con precedencia documentada', () => {
    const humanFirst = classifyDiscrepancy({
      ...primitivesFromEvaluation({
        evaluation: baselineEvaluation(),
        humanResolutionRaw: 'NO PROCEDE',
        humanClaims: [],
        humanExternalInformation: ['Comunicado interno de la coordinación'],
        humanUsedExternalInformation: true,
      }),
    });
    expect(humanFirst.discrepancyType).toBe('HUMAN_USED_EXTERNAL_INFORMATION');

    const gap = classifyDiscrepancy({
      ...primitivesFromEvaluation({
        evaluation: baselineEvaluation({ softwareCoverageGaps: ['Sección 5.3 no formalizada todavía'] }),
        humanResolutionRaw: 'NO PROCEDE',
        humanClaims: [],
      }),
    });
    expect(gap.discrepancyType).toBe('SOFTWARE_COVERAGE_GAP');
  });

  it('clasifica INSUFFICIENT_INFORMATION cuando el humano no expone resolución', () => {
    const result = compareHumanDecisionWithBaseline({
      ...primitivesFromEvaluation({
        evaluation: baselineEvaluation(),
        humanResolutionRaw: null,
        humanClaims: [],
      }),
    });
    expect(result.status).toBe('DISCREPANCY');
    expect(result.discrepancyType).toBe('INSUFFICIENT_INFORMATION');
  });

  it('clasifica INSUFFICIENT_INFORMATION cuando la IA está indeterminada', () => {
    const result = compareHumanDecisionWithBaseline({
      ...primitivesFromEvaluation({
        evaluation: baselineEvaluation({ suggestedOutcome: null, outcomeStatus: 'INDETERMINATE' }),
        humanResolutionRaw: 'PROCEDE',
        humanClaims: [],
      }),
    });
    expect(result.discrepancyType).toBe('INSUFFICIENT_INFORMATION');
  });

  it('clasifica DATE_INTERPRETATION cuando la diferencia involucra fechas', () => {
    const result = compareHumanDecisionWithBaseline({
      ...primitivesFromEvaluation({
        evaluation: baselineEvaluation(),
        humanResolutionRaw: 'NO PROCEDE',
        humanClaims: [claim('fecha de inicio del ticket 15/01/2026', 'VERIFIED_FACT')],
      }),
    });
    expect(result.discrepancyType).toBe('DATE_INTERPRETATION');
  });

  it('nunca marca como falso lo que falta (UNKNOWN_IS_NOT_FALSE)', () => {
    const result = compareHumanDecisionWithBaseline({
      ...primitivesFromEvaluation({
        evaluation: baselineEvaluation({
          suggestedOutcome: null,
          outcomeStatus: 'INDETERMINATE',
          missingFacts: PENDING_FACTS,
          missingEvidence: PENDING_FACTS,
          pendingRules: ['GDM-V5-5.2-A-CONTACT-ATTEMPTS'],
        }),
        humanResolutionRaw: 'NO PROCEDE',
        humanClaims: [],
      }),
    });
    expect(result.status).toBe('DISCREPANCY');
    expect(result.discrepancyType).toBe('INSUFFICIENT_INFORMATION');
    expect(result.missingEvidence).toEqual(expect.arrayContaining(PENDING_FACTS));
  });
});
