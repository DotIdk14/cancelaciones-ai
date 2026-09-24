import type { ComparisonStatus, DiscrepancyType, HumanClaim, HumanClaimClassification } from '@cancelaciones/domain';
import type { Outcome, PolicyEvaluation, OutcomeStatus, DecisionStatus } from './index';

/**
 * Comparación IA vs Dictamen humano — módulo puro y determinista.
 *
 * No conoce React, Next.js, insforge, OpenRouter, filesystem ni HTTP.
 * Recibe estructuras ya extraídas y devuelve una clasificación estable:
 *   - MATCH: la resolución del dictamen humano coincide con el outcome sugerido por la IA.
 *   - DISCREPANCY: difieren; se clasifica con la taxonomía oficial.
 *
 * Invariantes:
 *   - El dictamen humano nunca es tratado como verdad normativa.
 *   - Los hechos mencionados solo en el dictamen humano quedan marcados
 *     como MENTIONED_IN_HUMAN_DECISION (mentioned-but-unverified).
 *   - La ausencia de evidencia no equivale a condición falsa (UNKNOWN_IS_NOT_FALSE).
 */

/**
 * Normaliza la resolución de un dictamen humano a un outcome canónico del motor.
 *
 * Orden de precedencia documentado:
 *  1. Expresiones negativas (no procede / no aplica / no corresponde) se evalúan
 *     ANTES que las positivas: 'No procede la cancelación' DEBE mapear a
 *     NO_APLICA_CANCELACION_VENTA y no a CANCELACION_VENTA (evita capturar el
 *     substring 'procede' de 'no procede').
 *  2. Marca fuerte de resultado (baja, retención, cancelación de matrícula).
 *  3. Genéricos (procede / cancelación).
 */
export function normalizeHumanResolution(raw: string | null | undefined): Outcome | null {
  if (!raw) return null;
  const normalized = raw
    .toLowerCase()
    .replace(/[áàäâ]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const labels: Array<[Outcome, string[]]> = [
    ['NO_APLICA_CANCELACION_VENTA', ['no procede', 'no aplica', 'no corresponde', 'denegado', 'rechazado', 'improcedente']],
    ['BAJA', ['baja por devengamiento', 'corresponde baja', ' la baja', ' baja ']],
    ['RETENCION', ['retencion', 'retención', 'continua']],
    ['CANCELACION_VENTA_OPERATIVA', ['operativa']],
    ['CANCELACION_MATRICULA', ['cancelacion matricula', 'matricula', 'matrícula']],
    ['CANCELACION_VENTA', ['procede', 'cancelacion', 'cancelación']],
  ];

  for (const [outcome, outcomeLabels] of labels) {
    for (const label of outcomeLabels) {
      if (normalized.includes(label)) return outcome;
    }
  }
  return null;
}

export interface ComparisonPrimitives {
  aiOutcome: Outcome | null;
  aiOutcomeStatus: OutcomeStatus;
  aiDecisionStatus: DecisionStatus;
  aiMissingEvidence: string[];
  aiSoftwareCoverageGaps: string[];
  humanResolutionRaw: string | null;
  humanResolutionNormalized: Outcome | null;
  humanClaims: HumanClaim[];
  humanExternalInformation: string[];
  humanUsedExternalInformation: boolean;
  policyVersion: string;
  factsFingerprint: string;
  rulesInvolved: string[];
}

export interface ComparisonDetail {
  status: ComparisonStatus;
  discrepancyType: DiscrepancyType | null;
  explanation: string;
  reasons: string[];
  counterfactuals: string[];
  rulesInvolved: string[];
  unverifiedHumanClaims: HumanClaim[];
  missingEvidence: string[];
  aiOutcome: Outcome | null;
  humanOutcome: Outcome | null;
  humanResolutionRaw: string | null;
}

interface DecisionInput {
  aiOutcome: Outcome | null;
  aiOutcomeStatus: ComparisonPrimitives['aiOutcomeStatus'];
  humanResolutionNormalized: Outcome | null;
}

function resolutionsMatch(input: DecisionInput): boolean {
  return input.aiOutcome !== null && input.humanResolutionNormalized !== null && input.aiOutcome === input.humanResolutionNormalized;
}

function unverifiedClaims(claims: HumanClaim[]): HumanClaim[] {
  return claims.filter((claim) => claim.classification === 'MENTIONED_IN_HUMAN_DECISION' || claim.classification === 'MISSING_EVIDENCE');
}

/** Clasifica la discrepancia con precedencia determinista y documentada. */
export function classifyDiscrepancy(input: ComparisonPrimitives): { discrepancyType: DiscrepancyType; reasons: string[] } {
  const reasons: string[] = [];
  const unverified = unverifiedClaims(input.humanClaims);

  if (!input.humanResolutionRaw || !input.humanResolutionNormalized) {
    reasons.push('El dictamen humano no expone una resolución comparable con la taxonomía del motor.');
    return { discrepancyType: 'INSUFFICIENT_INFORMATION', reasons };
  }
  if (!input.aiOutcome) {
    reasons.push('El motor normativo no pudo determinar un outcome (indeterminado o en conflicto).');
    return { discrepancyType: 'INSUFFICIENT_INFORMATION', reasons };
  }
  if (input.aiOutcomeStatus === 'CONFLICTED') {
    reasons.push('El motor normativo detectó un conflicto entre reglas de outcome.');
    return { discrepancyType: 'INSUFFICIENT_INFORMATION', reasons };
  }
  if (input.humanUsedExternalInformation && input.humanExternalInformation.length > 0) {
    reasons.push('El dictamen humano cita información externa al expediente.');
    return { discrepancyType: 'HUMAN_USED_EXTERNAL_INFORMATION', reasons };
  }
  if (unverified.length > 0) {
    reasons.push(`${unverified.length} afirmación(es) del dictamen humano no están verificadas contra las evidencias.`);
    reasons.push('La resolución humana podría apoyarse en hechos mencionados sin respaldo documental.');
    return { discrepancyType: 'MISSING_EVIDENCE', reasons };
  }
  if (input.aiSoftwareCoverageGaps.length > 0) {
    reasons.push('El software no cubre todas las secciones de la política (brechas de cobertura normativa).');
    return { discrepancyType: 'SOFTWARE_COVERAGE_GAP', reasons };
  }
  if (input.aiMissingEvidence.length > 0) {
    reasons.push('El motor normativo carece de evidencia para evaluar condiciones pendientes.');
    return { discrepancyType: 'MISSING_EVIDENCE', reasons };
  }
  if (input.humanClaims.some((claim) => isDateRelated(claim.statement))) {
    reasons.push('La diferencia involucra interpretación de fechas.');
    return { discrepancyType: 'DATE_INTERPRETATION', reasons };
  }
  if (input.aiDecisionStatus === 'REVIEW_REQUIRED') {
    reasons.push('La evaluación IA requiere revisión humana por reglas o evidencia pendientes.');
    return { discrepancyType: 'EVIDENCE_INTERPRETATION', reasons };
  }
  reasons.push('Las resoluciones difieren con información verificable equivalente para ambos lados.');
  return { discrepancyType: 'POLICY_APPLICATION_DIFFERENCE', reasons };
}

function isDateRelated(text: string): boolean {
  const lower = text.toLowerCase();
  return /(\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\bfecha\b|\bdías\b|\bdia\b|\bsemana\b|\bmes\b|\baño\b|\bplazo\b|inicio|ticket|clases)/.test(lower);
}

/**
 * Compara la evaluación de la línea base IA con el dictamen humano extraído.
 * Pura y determinista: mismo input → misma respuesta.
 */
export function compareHumanDecisionWithBaseline(input: ComparisonPrimitives): ComparisonDetail {
  const unverified = unverifiedClaims(input.humanClaims);
  const aiDetermined = input.aiOutcome !== null && input.aiOutcomeStatus !== 'CONFLICTED' && input.aiOutcomeStatus !== 'INDETERMINATE';
  const humanDetermined = input.humanResolutionNormalized !== null;

  if (aiDetermined && humanDetermined && resolutionsMatch(input)) {
    const counterfactuals = unverified.length > 0
      ? [`Si las afirmaciones no verificadas del dictamen humano se confirmaran con evidencia, la resolución podría cambiar de ${input.aiOutcome}.`]
      : [];
    return {
      status: 'MATCH',
      discrepancyType: null,
      explanation: `La IA sugiere ${input.aiOutcome} y el dictamen humano resuelve lo mismo (${input.humanResolutionRaw?.trim()}).`,
      reasons: ['Resoluciones alineadas.'],
      counterfactuals,
      rulesInvolved: input.rulesInvolved,
      unverifiedHumanClaims: unverified,
      missingEvidence: [],
      aiOutcome: input.aiOutcome,
      humanOutcome: input.humanResolutionNormalized,
      humanResolutionRaw: input.humanResolutionRaw,
    };
  }

  const { discrepancyType, reasons } = classifyDiscrepancy(input);
  const aiLabel = input.aiOutcome ? `${input.aiOutcome}${input.aiOutcomeStatus === 'DETERMINED_WITH_WARNINGS' ? ' (con advertencias)' : ''}` : 'Indeterminado';
  const humanLabel = input.humanResolutionRaw?.trim() || 'Sin resolución extraíble';

  const counterfactuals: string[] = [];
  if (discrepancyType === 'MISSING_EVIDENCE' && input.humanResolutionNormalized) {
    counterfactuals.push(`Si la evidencia faltante se acreditara, la resolución humana (${humanLabel}) podría ser la correcta; hoy solo consta mencionada.`);
  } else if (discrepancyType === 'HUMAN_USED_EXTERNAL_INFORMATION') {
    counterfactuals.push('La resolución humana se apoya en información externa ajena al expediente evaluado por la IA.');
  } else {
    counterfactuals.push('La resolución final requiere adjudicación humana con evidencia verificable.');
  }

  const missingEvidence = [...new Set([...unverified.map((claim) => claim.statement), ...input.aiMissingEvidence])];

  return {
    status: 'DISCREPANCY',
    discrepancyType,
    explanation: `La IA sugiere ${aiLabel} y el dictamen humano resuelve ${humanLabel}.`,
    reasons,
    counterfactuals,
    rulesInvolved: input.rulesInvolved,
    unverifiedHumanClaims: unverified,
    missingEvidence,
    aiOutcome: input.aiOutcome,
    humanOutcome: input.humanResolutionNormalized,
    humanResolutionRaw: input.humanResolutionRaw,
  };
}

/** Construye los primitivos de comparación a partir de una evaluación completa. */
export function primitivesFromEvaluation(input: {
  evaluation: PolicyEvaluation;
  humanResolutionRaw: string | null;
  humanClaims: HumanClaim[];
  humanExternalInformation?: string[];
  humanUsedExternalInformation?: boolean;
}): ComparisonPrimitives {
  return {
    aiOutcome: input.evaluation.suggestedOutcome,
    aiOutcomeStatus: input.evaluation.outcomeStatus,
    aiDecisionStatus: input.evaluation.decisionStatus,
    aiMissingEvidence: input.evaluation.missingEvidence,
    aiSoftwareCoverageGaps: input.evaluation.softwareCoverageGaps,
    humanResolutionRaw: input.humanResolutionRaw,
    humanResolutionNormalized: normalizeHumanResolution(input.humanResolutionRaw),
    humanClaims: input.humanClaims,
    humanExternalInformation: input.humanExternalInformation ?? [],
    humanUsedExternalInformation: input.humanUsedExternalInformation ?? (input.humanExternalInformation?.length ?? 0) > 0,
    policyVersion: input.evaluation.policyVersion,
    factsFingerprint: input.evaluation.factsFingerprint,
    rulesInvolved: input.evaluation.decisiveRules,
  };
}

/** Etiqueta legible para cada tipo de discrepancia. */
export const DISCREPANCY_LABELS: Record<DiscrepancyType, string> = {
  MISSING_EVIDENCE: 'Evidencia faltante o solo mencionada en el dictamen humano',
  EVIDENCE_INTERPRETATION: 'Interpretación distinta de la evidencia',
  POLICY_APPLICATION_DIFFERENCE: 'Aplicación normativa diferente',
  DATA_EXTRACTION_ERROR: 'Error en la extracción de datos',
  DATE_INTERPRETATION: 'Interpretación distinta de fechas',
  HUMAN_USED_EXTERNAL_INFORMATION: 'El humano usó información externa al expediente',
  AI_PROCESSING_ERROR: 'Error de procesamiento de la IA',
  POSSIBLE_HUMAN_ERROR: 'Posible error humano',
  INSUFFICIENT_INFORMATION: 'Información insuficiente para comparar',
  SOFTWARE_COVERAGE_GAP: 'El software no cubre la sección normativa',
  UNKNOWN_DISCREPANCY: 'Discrepancia no clasificable',
};

export const HUMAN_CLAIM_LABELS: Record<HumanClaimClassification, string> = {
  VERIFIED_FACT: 'Verificado contra evidencia',
  MENTIONED_IN_HUMAN_DECISION: 'Mencionado en el dictamen humano — sin verificar contra evidencia',
  INFERENCE: 'Inferencia',
  MISSING_EVIDENCE: 'Sin evidencia',
  UNKNOWN: 'Estado desconocido',
};