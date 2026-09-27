import type { AuditEvaluation, FactRequirement, Outcome } from '../contracts';

export interface RelevantMissingFact {
  readonly factId: string;
  readonly name: string;
  readonly description: string;
  readonly requiredForRuleIds: readonly string[];
  readonly satisfiableBy: FactRequirement['satisfiableBy'];
  readonly whyItMatters: string;
  readonly relatedOutcome: Outcome | null;
  readonly reason: 'ACTIVE_CANDIDATE' | 'COMPETING_OUTCOME' | 'BLOCKING_REQUIREMENT';
}

export function relevantMissingFactsForEvaluation(
  evaluation: AuditEvaluation,
): readonly RelevantMissingFact[] {
  if (evaluation.normativeStatus === 'DETERMINATE') return [];

  const requirementByFact = new Map(evaluation.missingFacts.map((req) => [req.factId, req]));
  const relevant = new Map<string, RelevantMissingFact>();

  for (const candidate of evaluation.candidateTrace) {
    const reason = candidate.outcome === evaluation.closestOutcome ? 'ACTIVE_CANDIDATE' : 'COMPETING_OUTCOME';
    for (const factId of candidate.unresolvedFactIds) {
      const requirement = requirementByFact.get(factId);
      if (!requirement) continue;
      relevant.set(factId, toRelevant(requirement, candidate.outcome, reason));
    }
  }

  if (relevant.size === 0 && evaluation.closestOutcome === null) {
    for (const requirement of evaluation.missingFacts) {
      relevant.set(requirement.factId, toRelevant(requirement, null, 'BLOCKING_REQUIREMENT'));
    }
  }

  return [...relevant.values()].sort((a, b) => a.factId.localeCompare(b.factId));
}

function toRelevant(
  requirement: FactRequirement,
  relatedOutcome: Outcome | null,
  reason: RelevantMissingFact['reason'],
): RelevantMissingFact {
  return {
    factId: requirement.factId,
    name: requirement.name,
    description: requirement.description,
    requiredForRuleIds: requirement.requiredForRuleIds,
    satisfiableBy: requirement.satisfiableBy,
    whyItMatters: requirement.whyItMatters,
    relatedOutcome,
    reason,
  };
}
