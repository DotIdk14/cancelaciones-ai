/**
 * Evaluador puro y determinista de una auditoría.
 *
 * ## Principio rector
 *
 * El evaluador **no decide nada**. Las reglas deciden. Este archivo sólo:
 *  1. indexa hechos y calcula hechos derivados con la polaridad de la fuente;
 *  2. recorre nodos en orden explícito;
 *  3. acumula coincidencias, contraevidencia y bloqueos;
 *  4. agrega candidatos por desenlace;
 *  5. materializa sólo los conflictos que el recorrido alcanzó;
 *  6. delega el estado normativo y el ranking provisional.
 *
 * ## Sin dependencias
 *
 * No importa React, Next.js, InsForge, OpenRouter, AssemblyAI, `fs` ni `Date`.
 * Mismos hechos + misma versión de política ⇒ mismo resultado, byte a byte.
 */

import { evaluateCondition, FactIndex, isMatch } from '../conditions';
import { allConflictsForReachedRules } from '../conflicts/xdc';
import type {
  AuditEvaluation,
  EvaluateAuditInput,
  Fact,
  NormativeStatus,
  Outcome,
  PolicyConflict,
  ShortCircuitTrace,
  SourceRef,
} from '../contracts';
import { SUPPORTED_POLICY_VERSIONS } from '../contracts';
import { NODE_ORDER, NODES } from '../nodes/graph';
import type { NodeId } from '../nodes/graph';
import { deriveFacts } from '../facts/derive';
import { RULES } from '../rules/policy';
import { rankCandidates } from '../ranking/provisional';
import { buildTrace } from '../trace/trace';
import type { RuleApplication } from './application';
import type { Rule } from '../rules/types';
import { rulesFingerprint } from './fingerprint';
import { collectMissingRequirements } from './requirements';
import { decideStatus } from './status';
import { computeDeclaredPrecedence, outcomeOfRule } from './precedence';
import { provisionalOnlyRules } from '../rules/authority';

export function evaluateAudit(input: EvaluateAuditInput): AuditEvaluation {
  if (!(SUPPORTED_POLICY_VERSIONS as readonly string[]).includes(input.policyVersion)) {
    throw new RangeError(
      `Versión de política no soportada: ${input.policyVersion}. ` +
        `Este motor sólo evalúa ${SUPPORTED_POLICY_VERSIONS.join(', ')}.`,
    );
  }

  // 1. Hechos provistos + derivados. Los derivados se calculan ANTES de indexar
  //    para que las reglas los consulten igual que a los extraídos.
  const derived = deriveFacts(input.facts, input.evidenceContext);
  const allFacts: readonly Fact[] = [...input.facts, ...derived];
  const index = new FactIndex(allFacts);

  const applications: RuleApplication[] = [];
  // Las aplicaciones **con contraevidencia resuelta** se acumulan aparte. Antes se
  // filtraba la lista cruda, donde `blocked` siempre era `false`: la
  // contraevidencia se calculaba y se descartaba, de modo que ninguna regla
  // bloqueada perdía su desenlace.
  const resolvedApplications: RuleApplication[] = [];
  const reachedRuleIds: string[] = [];
  const visitedNodes: NodeId[] = [];

  // 2. Recorrido en orden explícito. No hay `break` por coincidencia: se
  //    evalúan todos los nodos para detectar lecturas concurrentes de la fuente.
  //
  //    Única excepción: un filtro que **declara** exclusión por categoría
  //    («por ningún motivo», `decision-tree.md` §1.1) cierra el caso antes de
  //    cualquier evaluación causal. No es un «el primero que coincide gana»: es
  //    la única salida donde la fuente dice que las ramas siguientes no aplican.
  let shortCircuit: ShortCircuitTrace | null = null;

  for (const nodeId of NODE_ORDER) {
    const nodeEvaluation = evaluateNode(nodeId, index, input);

    visitedNodes.push(nodeId);
    applications.push(...nodeEvaluation.applications);
    resolvedApplications.push(...nodeEvaluation.effectiveApplications);

    for (const application of nodeEvaluation.effectiveApplications) {
      if (application.matched && !application.blocked) {
        reachedRuleIds.push(application.rule.ruleId);
      }
    }

    const trigger = nodeEvaluation.effectiveApplications.find(
      (application) =>
        application.matched &&
        (application.rule.declaredPrecedenceOverOutcomes?.length ?? 0) > 0,
    );
    if (trigger) {
      const skipped = NODE_ORDER.slice(NODE_ORDER.indexOf(nodeId) + 1);
      shortCircuit = {
        ruleId: trigger.rule.ruleId,
        nodeId,
        excludedOutcomes: trigger.rule.declaredPrecedenceOverOutcomes ?? [],
        skippedNodes: [...skipped],
        sourceRefs: trigger.rule.sourceRefs,
        reason:
          `La fuente excluye por texto ${(trigger.rule.declaredPrecedenceOverOutcomes ?? []).join(', ')} ` +
          'antes de evaluar las causales; el resto del árbol no aplica a este caso.',
      };
      break;
    }
  }

  // 3. Conflictos sólo de los alcanzados: un conflicto en una rama no visitada
  //    no puede escalar la auditoría.
  const policyConflicts: PolicyConflict[] = allConflictsForReachedRules(reachedRuleIds);

  // 4. Candidatos por desenlace. Se excluyen las reglas informativas: informan,
  //    no deciden.
  const effective = resolvedApplications.filter(
    (application) => application.matched && !application.blocked && !application.rule.informative,
  );

  // 4b. Prevalencia declarada, calculada una sola vez y compartida entre el
  //     estado y el ranking. Si se calculara dos veces, ambos podrían discrepar
  //     sobre qué desenlace desplazó la fuente.
  const declaredPrecedence = computeDeclaredPrecedence(effective, outcomeOfRule);

  const candidateTrace = rankCandidates(
    effective,
    policyConflicts,
    input.evidenceContext.evidences,
  );

  // 5. Estado normativo.
  const statusDecision = decideStatus({
    effectiveApplications: effective,
    allApplications: applications,
    allFacts,
    policyConflicts,
    candidateTrace,
    evidences: input.evidenceContext.evidences,
    declaredPrecedence,
  });
  const normativeStatus: NormativeStatus = statusDecision.status;

  // 6. Resultado normativo: presente sólo si DETERMINATE. Nunca se rellena con
  //    un resultado provisional.
  const normativeOutcome: Outcome | null =
    normativeStatus === 'DETERMINATE' ? statusDecision.normativeOutcome : null;

  // 7. Ranking provisional, campo separado del normativo.
  const provisional = {
    closestOutcome: statusDecision.closestOutcome,
    alternativeOutcomes: statusDecision.alternativeOutcomes,
    assessment: statusDecision.assessment,
  };

  // 8. Requisitos de evidencia faltantes.
  const missingFacts = collectMissingRequirements({ applications, index });

  // 8b. Reglas de fuente auxiliar que proponen desenlace sin grounding en el
  //     primario. Se calcula antes de la traza porque la traza debe explicar la
  //     separación normativo/provisional, no sóloregistrarla.
  const provisionalOnly = provisionalOnlyRules(
    effective.filter((application) => application.matched).map((application) => application.rule),
  );

  // 9. Traza.
  const trace = buildTrace({
    applications: resolvedApplications,
    visitedNodes,
    policyConflicts,
    candidateTrace,
    normativeStatus,
    normativeOutcome,
    closestOutcome: provisional.closestOutcome,
    missingFacts,
    allFacts,
    shortCircuit,
    evidences: input.evidenceContext.evidences,
    statusReason: statusDecision.reason,
    provisionalOnly,
  });

  return {
    policyVersion: input.policyVersion,
    rulesFingerprint: rulesFingerprint(RULES),
    normativeStatus,
    normativeOutcome,
    closestOutcome: provisional.closestOutcome,
    alternativeOutcomes: provisional.alternativeOutcomes,
    provisionalAssessment: provisional.assessment,
    missingFacts,
    policyConflicts,
    candidateTrace,
    trace,
    shortCircuit,
    sourceRefs: collectSourceRefs(applications),
    provisionalOnly,
  };
}

/** Evalúa todas las reglas de un nodo. */
function evaluateNode(
  nodeId: NodeId,
  index: FactIndex,
  input: EvaluateAuditInput,
): { applications: RuleApplication[]; effectiveApplications: RuleApplication[] } {
  const rules = RULES.filter((rule) => rule.nodeId === nodeId);
  const applications: RuleApplication[] = rules.map((rule) =>
    evaluateRule(rule, index, input),
  );

  // Contraevidencia: una regla bloqueada pierde su coincidencia, pero la
  // coincidencia de la regla bloqueante se conserva.
  //
  // Dos detalles que la versión anterior no cumplía:
  //
  // 1. **Una regla neutralizada no neutraliza.** Todas las reglas bloqueantes
  //    del registro son, a su vez, bloqueables: si `R-OP-A` pierde su
  //    coincidencia por contraevidencia, tiene que dejar de bloquear a las
  //    suyas. Calcular el conjunto bloqueado en una sola pasada dejaba que una
  //    regla muerta siguiera eliminando desenlaces.
  // 2. **Cada paso declara quién lo bloqueó.** Antes, una regla neutralizada
  //    reportaba como bloqueantes *todas* las reglas que bloquean algo en el
  //    registro, aunque ninguna la tocara. La traza quedaía mintiendo sobre la
  //    causa del desenlace.
  //
  // Se itera hasta punto fijo porque el bloqueo puede ser transitivo
  // (A bloquea a B, B bloquea a C).
  const blockersOf_ = new Map<string, string[]>();
  for (const application of applications) {
    for (const target of application.rule.blocksRuleIds ?? []) {
      const list = blockersOf_.get(target) ?? [];
      if (!list.includes(application.rule.ruleId)) list.push(application.rule.ruleId);
      blockersOf_.set(target, list);
    }
  }

  const matchedIds = new Set(
    applications.filter((application) => application.matched).map((a) => a.rule.ruleId),
  );

  const blockedBy = new Map<string, string[]>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const application of applications) {
      if (!application.matched) continue;
      if (blockedBy.has(application.rule.ruleId)) continue;
      // Un bloqueante cuenta sólo si **coincidió**: tener una regla que te
      // bloquea en el registro no te neutraliza, sólo lo hace cuando esa regla
      // se activa. Y un bloqueante ya neutralizado no puede neutralizar a otro.
      const vivos = (blockersOf_.get(application.rule.ruleId) ?? []).filter(
        (id) => matchedIds.has(id) && !blockedBy.has(id),
      );
      if (vivos.length > 0) {
        blockedBy.set(application.rule.ruleId, vivos);
        changed = true;
      }
    }
  }

  const effectiveApplications = applications.map((application) => {
    const blockers = blockedBy.get(application.rule.ruleId);
    return blockers
      ? { ...application, blocked: true, blockingRuleIds: blockers }
      : application;
  });

  return { applications, effectiveApplications };
}

/** Evalúa una regla individual. */
function evaluateRule(
  rule: Rule,
  index: FactIndex,
  input: EvaluateAuditInput,
): RuleApplication {
  const evaluation = evaluateCondition(rule.condition, index, input.evidenceContext.temporal);
  const matched = isMatch(evaluation.value);

  const conflictIds = new Set<string>(rule.conflictIds ?? []);
  for (const temporalConflict of evaluation.temporalConflicts) {
    conflictIds.add(temporalConflict.conflictId);
  }

  return {
    rule,
    nodeId: rule.nodeId as NodeId,
    conditionValue: evaluation.value,
    matched,
    blocked: false,
    blockingRuleIds: [],
    blockingFactIds: evaluation.blockingFactIds,
    contradictoryFactIds: evaluation.contradictoryFactIds,
    usedFactIds: evaluation.usedFactIds,
    conflictIds: [...conflictIds],
    reason: evaluation.reason,
  };
}

/** Fuentes normativas efectivamente tocadas por la evaluación. */
function collectSourceRefs(applications: readonly RuleApplication[]): readonly SourceRef[] {
  const byKey = new Map<string, SourceRef>();
  for (const application of applications) {
    for (const ref of application.rule.sourceRefs) {
      byKey.set(`${ref.sourceLockId}:${ref.page}:${ref.section}:${ref.statementId}`, ref);
    }
  }
  return [...byKey.values()].sort((a, b) =>
    `${a.sourceLockId}${String(a.page).padStart(3, '0')}${a.statementId}`.localeCompare(
      `${b.sourceLockId}${String(b.page).padStart(3, '0')}${b.statementId}`,
    ),
  );
}

export { NODES };
export type { RuleApplication };
