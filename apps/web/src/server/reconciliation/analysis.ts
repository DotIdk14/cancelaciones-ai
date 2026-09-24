import type { ComparisonStatus, DiscrepancyType, FinalAdjudicationType } from '@cancelaciones/domain';

/**
 * Análisis de reconciliación IA vs humano — módulo determinista y testeable.
 *
 * Solo consume datos estructurados ya persistidos (baseline, extracción humana
 * y comparación). No conoce HTTP ni LLM: el job AI_RECONCILIATION puede
 * enriquecer este análisis con el modelo, pero la estructura base siempre se
 * puede calcular sin red (fallback determinista garantizado).
 */

export interface ReconciliationAnalysisInput {
  comparisonStatus: ComparisonStatus;
  discrepancyType: DiscrepancyType | null;
  explanation: string | null;
  reasons: string[];
  counterfactuals: string[];
  unverifiedHumanClaims: Array<{ statement: string; classification: string }>;
  aiOutcome: string | null;
  humanOutcome: string | null;
  humanResolution: string | null;
  policyCode: string;
  policyVersion: string;
}

export interface ReconciliationAnalysis {
  summary: string;
  agreements: string[];
  observations: string[];
  recommendedAdjudicationType: FinalAdjudicationType;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  pointsForHumanReview: string[];
  deterministic: boolean;
}

export function buildReconciliationAnalysis(input: ReconciliationAnalysisInput): ReconciliationAnalysis {
  const agreements: string[] = [];
  const observations: string[] = [];
  const pointsForHumanReview: string[] = [];
  let recommendedAdjudicationType: FinalAdjudicationType;
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';

  if (input.comparisonStatus === 'MATCH') {
    agreements.push('La IA y el dictamen humano coinciden en la resolución.');
    if (input.unverifiedHumanClaims.length === 0) {
      recommendedAdjudicationType = 'CONFIRM_AI';
      confidence = 'HIGH';
      observations.push('Sin afirmaciones humanas pendientes de verificación; la decisión de máquina está respaldada.');
    } else {
      recommendedAdjudicationType = 'CONFIRM_AI';
      confidence = 'MEDIUM';
      observations.push(`${input.unverifiedHumanClaims.length} afirmación(es) del dictamen humano solo están mencionadas, sin respaldo documental.`);
      pointsForHumanReview.push('Confirmar si las afirmaciones solo mencionadas pueden respaldarse con evidencia.');
    }
    return { summary: `MATCH: ambas fuentes resuelven lo mismo (${input.aiOutcome ?? 'sin outcome'}); la decisión de máquina puede confirmarse.`, agreements, observations, recommendedAdjudicationType, confidence, pointsForHumanReview, deterministic: true };
  }

  // DISCREPANCY — clasificación por tipo (sin cadena de pensamiento).
  observations.push(`Discrepancia clasificada como ${input.discrepancyType ?? 'UNKNOWN_DISCREPANCY'}.`);
  if (input.explanation) observations.push(input.explanation);
  observations.push(...input.reasons);

  if (input.unverifiedHumanClaims.length > 0) {
    pointsForHumanReview.push('Solicitar evidencia documental para las afirmaciones del dictamen humano que hoy solo están mencionadas.');
    pointsForHumanReview.push(...input.unverifiedHumanClaims.slice(0, 10).map((claim) => `Afirmación sin respaldo: "${claim.statement}".`));
  }

  switch (input.discrepancyType) {
    case 'INSUFFICIENT_INFORMATION':
      recommendedAdjudicationType = 'INSUFFICIENT_INFORMATION';
      confidence = 'LOW';
      pointsForHumanReview.push('No hay elementos suficientes: completar expediente antes de adjudicar.');
      break;
    case 'MISSING_EVIDENCE':
      recommendedAdjudicationType = 'INSUFFICIENT_INFORMATION';
      confidence = 'LOW';
      pointsForHumanReview.push('Falta evidencia o las afirmaciones solo están mencionadas: integrar el expediente antes de resolver.');
      break;
    case 'HUMAN_USED_EXTERNAL_INFORMATION':
    case 'POSSIBLE_HUMAN_ERROR':
      recommendedAdjudicationType = 'CONFIRM_AI';
      confidence = 'MEDIUM';
      pointsForHumanReview.push('La resolución humana se apoya en información ajena al expediente: validar contra la política oficial.');
      break;
    case 'SOFTWARE_COVERAGE_GAP':
      recommendedAdjudicationType = 'CONFIRM_HUMAN';
      confidence = 'MEDIUM';
      pointsForHumanReview.push('El software no cubre esa sección normativa: la resolución humana puede ser la única informada.');
      break;
    case 'POLICY_APPLICATION_DIFFERENCE':
    case 'EVIDENCE_INTERPRETATION':
    case 'DATE_INTERPRETATION':
    case 'DATA_EXTRACTION_ERROR':
    case 'AI_PROCESSING_ERROR':
    default:
      recommendedAdjudicationType = 'CONFIRM_HUMAN';
      confidence = 'MEDIUM';
      pointsForHumanReview.push('Revisar la discrepancia con los expedientes originales y la política GDM_GAM_PRD_MLG_003.');
      break;
  }

  if (input.aiOutcome && input.humanOutcome) {
    observations.push(`Outcome IA: ${input.aiOutcome} — Resolución humana: ${input.humanResolution ?? input.humanOutcome}.`);
  }

  const summary = `DISCREPANCY (${input.discrepancyType ?? 'UNKNOWN'}): la línea base de la IA y el dictamen humano difieren; se recomienda ${recommendedAdjudicationType}.`;

  return { summary, agreements, observations, recommendedAdjudicationType, confidence, pointsForHumanReview, deterministic: true };
}