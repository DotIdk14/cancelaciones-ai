/**
 * Construcción de la traza de decisión.
 *
 * ## Contrato
 *
 * La traza es la **explicación completa** del resultado: por qué cada regla
 * coincidió o no, qué hechos consultó, qué fuentes se tocaron, qué conflictos
 * se materializaron y por qué el estado normativo es el que es
 * (`TRACE_EVERY_DECISION`).
 *
 * Un paso de la traza enlaza siempre, cuando aplica, cuatro cosas: **regla**,
 * **condición**, **hecho** y **evidencia/fuente**. Un paso sin esos enlaces es
 * una aserción, no una trazabilidad, y por eso `detail` nunca se usa para
 * shortcutear la información estructurada.
 *
 * ## Determinismo
 *
 * El número de paso (`step`) es correlativo y el orden de emisión es fijo:
 * hechos → nodos → reglas → conflictos → faltantes → candidatos → estado →
 * resultado. El fingerprint se calcula sobre esa misma secuencia, así que dos
 * ejecuciones idénticas producen trazas idénticas.
 */

import type {
  CandidateOutcomeTrace,
  EvidenceRef,
  Fact,
  FactRequirement,
  NormativeStatus,
  ShortCircuitTrace,
  Outcome,
  PolicyConflict,
  ProvisionalOnlyRule,
  SourceRef,
  TraceEntry,
} from '../contracts';
import { NODES } from '../nodes/graph';
import type { NodeId } from '../nodes/graph';
import { stableHash } from '../evaluator/fingerprint';
import { conditionsFingerprint } from '../evaluator/conditions-fingerprint';
import type { RuleApplication } from '../evaluator/application';

export interface TraceInput {
  readonly applications: readonly RuleApplication[];
  readonly visitedNodes: readonly NodeId[];
  readonly policyConflicts: readonly PolicyConflict[];
  readonly candidateTrace: readonly CandidateOutcomeTrace[];
  readonly normativeStatus: NormativeStatus;
  readonly normativeOutcome: Outcome | null;
  readonly closestOutcome: Outcome | null;
  readonly missingFacts: readonly FactRequirement[];
  readonly allFacts: readonly Fact[];
  readonly shortCircuit: ShortCircuitTrace | null;
  readonly evidences: readonly EvidenceRef[];
  /** Por qué el estado normativo es el que es. */
  readonly statusReason: string;
  /** Reglas que Lennan un desenlace sin autoridad para fijarlo. */
  readonly provisionalOnly: readonly ProvisionalOnlyRule[];
}

/** Emisor correlativo de pasos. */
class TraceBuilder {
  private readonly entries: TraceEntry[] = [];

  add(
    kind: TraceEntry['kind'],
    ref: string,
    detail: string,
    extra: Partial<Omit<TraceEntry, 'step' | 'kind' | 'ref' | 'detail'>> = {},
  ): void {
    this.entries.push({
      step: this.entries.length + 1,
      kind,
      ref,
      detail,
      ...extra,
    });
  }

  build(): TraceEntry[] {
    return this.entries;
  }
}

export function buildTrace(input: TraceInput): {
  entries: readonly TraceEntry[];
  fingerprint: string;
} {
  const builder = new TraceBuilder();

  traceEvidences(builder, input.evidences);
  traceFacts(builder, input.allFacts);
  traceNodes(builder, input.visitedNodes);
  traceShortCircuit(builder, input.shortCircuit);
  traceRules(builder, input.applications);
  traceConflicts(builder, input.policyConflicts);
  traceMissing(builder, input.missingFacts);
  traceCandidates(builder, input.candidateTrace);
  traceAuthority(builder, input.applications, input.provisionalOnly);
  traceProvisionalOnly(builder, input.provisionalOnly);
  traceStatus(builder, input.normativeStatus, input.statusReason, input.provisionalOnly);
  traceResult(
    builder,
    input.normativeStatus,
    input.normativeOutcome,
    input.closestOutcome,
    input.provisionalOnly,
  );

  const entries = builder.build();
  return { entries, fingerprint: fingerprintOf(entries) };
}

/**
 * Paso 1: la evidencia que entró al caso.
 *
 * `TraceStepKind` declaraba `EVIDENCE` pero ninguna evaluación lo emitía: la
 * pregunta «¿con qué documentos se trabajó» sólo se podía responder
 * reejecutando el motor. Se emite siempre, incluso sin evidencia, para que la
 * ausencia sea visible en lugar de silenciosa.
 */
function traceEvidences(builder: TraceBuilder, evidences: readonly EvidenceRef[]): void {
  if (evidences.length === 0) {
    builder.add('EVIDENCE', 'none', 'La evaluación no recibió evidencia.');
    return;
  }
  for (const evidence of evidences) {
    builder.add('EVIDENCE', evidence.evidenceId, `Evidencia ${evidence.kind} «${evidence.label}».`, {
      value: {
        evidenceId: evidence.evidenceId,
        kind: evidence.kind,
        label: evidence.label,
        // La procedencia viaja con la evidencia: un documento sin hash ni
        // fecha de captura no puede sostener una decisión auditable.
        hash: evidence.hash ?? null,
        capturedAt: evidence.capturedAt ?? null,
      },
    });
  }
}

/** Paso 2: los hechos del caso, con su estado y procedencia. */
function traceFacts(builder: TraceBuilder, facts: readonly Fact[]): void {
  for (const fact of facts) {
    const detail =
      fact.state === 'KNOWN'
        ? `Hecho ${fact.factId} = ${JSON.stringify(fact.value)} (KNOWN).`
        : `Hecho ${fact.factId} en estado ${fact.state}. ${
            fact.unknownReason ?? fact.notes ?? 'Sin razón declarada.'
          }`;
    builder.add('FACT', fact.factId, detail, {
      factId: fact.factId,
      value: {
        // El valor y la procedencia viajan juntos: un paso `FACT` que sólo
        // dijera el valor dejaría sin responder de dónde salió.
        state: fact.state,
        extracted: fact.value,
        evidenceRefs: fact.evidenceRefs,
        provenance: fact.provenance,
        extractionMethod: fact.extractionMethod,
        relevantTimestamp: fact.relevantTimestamp,
      },
    });
  }
}

/** Paso 2: los nodos visitados, en el orden del recorrido. */
function traceNodes(builder: TraceBuilder, visited: readonly NodeId[]): void {
  for (const nodeId of visited) {
    const node = NODES[nodeId];
    builder.add('NODE', nodeId, `Nodo «${node.label}» (${node.section}).`, {
      value: { label: node.label, section: node.section, terminal: node.terminal },
    });
  }
}

/**
 * Paso 2b: el cortocircuito de prevalencia, si lo hubo.
 *
 * Se emite aunque no haya Filter-1 evaluado, para que el paso exista siempre en
 * la misma posición relativa y la traza de dos ejecuciones sea comparable paso a
 * paso.
 */
function traceShortCircuit(builder: TraceBuilder, shortCircuit: ShortCircuitTrace | null): void {
  if (!shortCircuit) {
    builder.add(
      'SHORT_CIRCUIT',
      'none',
      'Ningún filtro declaró exclusión de prevalencia: se recorrió el árbol completo.',
    );
    return;
  }
  const skipped =
    shortCircuit.skippedNodes.length > 0
      ? ` Nodos no recorridos: ${shortCircuit.skippedNodes.join(', ')}.`
      : '';
  builder.add(
    'SHORT_CIRCUIT',
    shortCircuit.ruleId,
    `${shortCircuit.reason}${skipped}`,
    {
      ruleId: shortCircuit.ruleId,
      sourceRefs: shortCircuit.sourceRefs,
      value: {
        nodeId: shortCircuit.nodeId,
        excludedOutcomes: shortCircuit.excludedOutcomes,
        skippedNodes: shortCircuit.skippedNodes,
      },
    },
  );
}

/**
 * Paso 3: cada regla evaluada.
 *
 * Se emiten **todas** las reglas, coincidan o no: una regla que no coincidió
 * explica por qué el caso no se resolvió por ahí.
 */
function traceRules(builder: TraceBuilder, applications: readonly RuleApplication[]): void {
  for (const application of applications) {
    const { rule } = application;
    const verdict = application.matched
      ? application.blocked
        ? 'coincidió pero fue neutralizada por contraevidencia'
        : 'coincidió'
      : `no coincidió (${application.conditionValue})`;

    builder.add('RULE', rule.ruleId, `${rule.description} → ${verdict}. ${application.reason}`, {
      ruleId: rule.ruleId,
      sourceRefs: rule.sourceRefs,
      value: {
        nodeId: application.nodeId,
        kind: rule.kind,
        conditionValue: application.conditionValue,
        matched: application.matched,
        blocked: application.blocked,
        // Sin este campo la traza no puede responder «¿por qué esta regla no
        // proposing?», que es justamente lo que la contraevidencia necesita
        // explicar.
        blockingRuleIds: application.blockingRuleIds,
        target: rule.onMatch,
        conditionFingerprint: conditionsFingerprint(rule.condition),
        usedFactIds: application.usedFactIds,
        blockingFactIds: application.blockingFactIds,
        contradictoryFactIds: application.contradictoryFactIds,
        conflictIds: application.conflictIds,
        dependsOnUndeclaredThreshold: rule.dependsOnUndeclaredThreshold ?? false,
      },
    });

    // Cada hecho no determinable que bloqueó la regla merece su propio paso:
    // es lo que el auditor tiene que conseguir.
    for (const factId of application.blockingFactIds) {
      builder.add('MISSING_FACT', factId, `El hecho ${factId} bloqueó ${rule.ruleId}.`, {
        factId,
        ruleId: rule.ruleId,
      });
    }
  }
}

/** Paso 4: los conflictos materializados, con sus lecturas en conflicto. */
function traceConflicts(builder: TraceBuilder, conflicts: readonly PolicyConflict[]): void {
  for (const conflict of conflicts) {
    builder.add('CONFLICT', conflict.conflictId, `${conflict.title}. ${conflict.explanation}`, {
      sourceRefs: conflict.sourceRefs,
      value: {
        kind: conflict.kind,
        affectedRuleIds: conflict.affectedRuleIds,
        candidateOutcomes: conflict.candidateOutcomes,
        status: conflict.status,
        readings: conflict.conflictingInterpretations.map((item) => ({
          reading: item.reading,
          resultingOutcome: item.resultingOutcome,
        })),
      },
    });
  }
}

/** Paso 5: los requisitos de evidencia pendientes. */
function traceMissing(builder: TraceBuilder, missing: readonly FactRequirement[]): void {
  for (const requirement of missing) {
    builder.add(
      'MISSING_FACT',
      requirement.requirementId,
      `Falta «${requirement.name}». ${requirement.whyItMatters}`,
      {
        factId: requirement.factId,
        sourceRefs: requirement.sourceRefs,
        value: {
          requiredForRuleIds: requirement.requiredForRuleIds,
          satisfiableBy: requirement.satisfiableBy,
        },
      },
    );
  }
}

/** Paso 6: el ranking de candidatos, con su conteo entero. */
function traceCandidates(builder: TraceBuilder, candidates: readonly CandidateOutcomeTrace[]): void {
  for (const candidate of candidates) {
    builder.add(
      'CANDIDATE',
      candidate.outcome,
      `#${candidate.rank} puntaje ${candidate.supportScore}. ${candidate.rationale}`,
      {
        value: {
          rank: candidate.rank,
          supportScore: candidate.supportScore,
          supportingRuleIds: candidate.supportingRuleIds,
          blockingRuleIds: candidate.blockingRuleIds,
          conflictIds: candidate.conflictIds,
          unresolvedFactIds: candidate.unresolvedFactIds,
        },
      },
    );
  }
}

/** Paso 7: el estado normativo y su motivo. */
function traceStatus(
  builder: TraceBuilder,
  status: NormativeStatus,
  reason: string,
  provisionalOnly: readonly ProvisionalOnlyRule[],
): void {
  const explanation: Record<NormativeStatus, string> = {
    DETERMINATE: 'La fuente normativa cierra el caso de forma unívoca.',
    INSUFFICIENT_EVIDENCE:
      'La política es aplicable pero faltan hechos requeridos: no se puede cerrar.',
    REQUIRES_HUMAN_REVIEW:
      'El caso alcanza un conflicto o una ambigüedad normativa: la decisión es del Owner.',
  };
  const pending = pendingIds(provisionalOnly);
  builder.add('STATUS', status, `${explanation[status]} ${reason}`, {
    value: {
      status,
      // Motivo específico del módulo de estado, no la explicación genérica del
      // tipo: la diferencia entre «hay un conflicto» y «una fuente auxiliar
      // propuso algo que el primario no autoriza» cambia lo que debe hacer el
      // auditor.
      reason,
      pendingAmbiguityIds: pending,
      provisionalOnlyRuleIds: provisionalOnly.map((rule) => rule.ruleId),
    },
  });
}

/**
 * Paso 6b: la decisión de autoridad, regla por regla.
 *
 * Se emite para cada regla de desenlace que coincidió, no sólo para las
 * Auxiliares: una regla autoritativa también debe dejar constancia de *por qué*
 * lo es, o «normativo» sería un hecho sin explicación.
 */
function traceAuthority(
  builder: TraceBuilder,
  applications: readonly RuleApplication[],
  provisionalOnly: readonly ProvisionalOnlyRule[],
): void {
  const provisionalIds = new Set(provisionalOnly.map((rule) => rule.ruleId));
  for (const application of applications) {
    const { rule } = application;
    if (!application.matched || rule.onMatch.kind !== 'OUTCOME') continue;
    const outcome = rule.onMatch.outcome;
    const provisional = provisionalIds.has(rule.ruleId);
    builder.add(
      'AUTHORITY',
      rule.ruleId,
      provisional
        ? `«${outcome}» es PROVISIONAL: la regla se apoya en fuentes auxiliares y ` +
            'GDM_GAM_PRD_MLG_003 no la autoriza a determinar el desenlace.'
        : `«${outcome}» es NORMATIVO: la regla cita o conecta con la fuente primaria.`,
      {
        ruleId: rule.ruleId,
        sourceRefs: rule.sourceRefs,
        value: {
          outcome,
          isNormative: !provisional,
          authority: provisional ? 'AUXILIARY_WITHOUT_PRIMARY_GROUNDING' : 'PRIMARY_GROUNDED',
          primaryGrounding: rule.primaryGrounding ?? null,
          awaitsAmbiguityIds: rule.awaitsAmbiguityIds ?? [],
        },
      },
    );
  }
}

/** Paso 6c: el resumen accionable de lo que impide cerrar el caso. */
function traceProvisionalOnly(builder: TraceBuilder, provisionalOnly: readonly ProvisionalOnlyRule[]): void {
  if (provisionalOnly.length === 0) return;
  const pending = pendingIds(provisionalOnly);
  builder.add(
    'PROVISIONAL_ONLY',
    'pending-authority',
    `Hay ${provisionalOnly.length} regla(s) de fuente auxiliar proponiendo desenlace sin ` +
      `grounding en el primario. Ambigüedades del Owner que las desbloquean: ` +
      `${pending.length > 0 ? pending.join(', ') : 'ninguna declarada'}.`,
    {
      value: {
        rules: provisionalOnly.map((rule) => ({
          ruleId: rule.ruleId,
          outcome: rule.outcome,
          awaitsAmbiguityIds: rule.awaitsAmbiguityIds,
        })),
        pendingAmbiguityIds: pending,
      },
    },
  );
}

function pendingIds(provisionalOnly: readonly ProvisionalOnlyRule[]): readonly string[] {
  return [...new Set(provisionalOnly.flatMap((rule) => rule.awaitsAmbiguityIds))].sort();
}

/**
 * Paso 8: el resultado, con la separación normativa/provisional explícita.
 *
 * Este paso es donde se evita la confusión más damaging del sistema: que un
 * resultado provisional se lea como normativo.
 */
function traceResult(
  builder: TraceBuilder,
  status: NormativeStatus,
  normativeOutcome: Outcome | null,
  closestOutcome: Outcome | null,
  provisionalOnly: readonly ProvisionalOnlyRule[],
): void {
  builder.add('RESULT', 'normative', describeNormative(status, normativeOutcome), {
    value: { status, normativeOutcome },
  });
  const pending = pendingIds(provisionalOnly);
  builder.add('RESULT', 'provisional', describeProvisional(closestOutcome), {
    value: {
      closestOutcome,
      isNormative: false,
      // Se adjunta al resultado provisional lo que impide convertirlo en
      // normativo, para que la UI pueda pintar «qué falta» sin recalcular.
      pendingAmbiguityIds: pending,
      provisionalOnlyRuleIds: provisionalOnly.map((rule) => rule.ruleId),
    },
  });
}

function describeNormative(status: NormativeStatus, outcome: Outcome | null): string {
  if (status !== 'DETERMINATE') {
    return 'SIN RESULTADO NORMATIVO: la norma no cierra el caso.';
  }
  return `RESULTADO NORMATIVO: ${outcome}.`;
}

function describeProvisional(closest: Outcome | null): string {
  if (closest === null) {
    return (
      'SIN RESULTADO PROVISIONAL: la evidencia disponible no prefiere ' +
      'claramente ningún desenlace. No se fuerza uno.'
    );
  }
  return `RESOLUCIÓN MÁS COMPATIBLE (provisional, no normativa): ${closest}.`;
}

/** Huella de la traza: cambios si cambia cualquier paso. */
function fingerprintOf(entries: readonly TraceEntry[]): string {
  // Reutiliza el hasher del registro de reglas para que ambos dominios tengan
  // la misma noción de «cambió».
  return stableHash(
    entries.map((entry) => `${entry.step}:${entry.kind}:${entry.ref}:${JSON.stringify(entry.value ?? null)}`),
  );
}

export type { SourceRef };
