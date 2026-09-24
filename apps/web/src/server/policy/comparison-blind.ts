import type { AiDecisionV1Record } from './blind-audit';

export interface BlindComparisonResult {
  runType: 'HUMAN_COMPARISON';
  match: 'MATCH' | 'DISCREPANCY';
  machineOutcome: string | null;
  humanOutcome: string;
  aiDecisionHash: string;
  comparedAt: string;
}

/**
 * Comparación con dictamen humano (HUMAN_COMPARISON). Solo existe cuando hay
 * decisión humana y una AI_DECISION_V1 previa. El resultado humano entra
 * exclusivamente en este punto, jamás en el circuito de la máquina (blind).
 */
export function compareBlindAuditWithHuman(input: {
  audit: AiDecisionV1Record;
  humanOutcome: string | null;
}): BlindComparisonResult | null {
  if (!input.humanOutcome) return null;
  const machineOutcome = input.audit.adjudication.probableOutcome;
  return {
    runType: 'HUMAN_COMPARISON',
    match: machineOutcome === input.humanOutcome ? 'MATCH' : 'DISCREPANCY',
    machineOutcome,
    humanOutcome: input.humanOutcome,
    aiDecisionHash: input.audit.aiDecisionHash,
    comparedAt: new Date().toISOString(),
  };
}