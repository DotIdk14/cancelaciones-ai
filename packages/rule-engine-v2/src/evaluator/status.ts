/**
 * Estado normativo y resultado provisional.
 *
 * ## La distinción que este módulo protege
 *
 * `normativeStatus` y `closestOutcome` son respuestas a **preguntas
 * distintas**:
 *
 * - «¿Qué dice la norma?» → `normativeStatus` / `normativeOutcome`
 * - «¿Qué se parece más a esta evidencia?» → `closestOutcome` (provisional)
 *
 * Que coincidan a veces no significa que sean la misma cosa. Cuando la norma
 * calla, `normativeOutcome` es `null` aunque `closestOutcome` tenga valor. La
 * UI y el reporte deben mostrarlos por separado, y este módulo se encarga de
 * que el tipo los impida confundir.
 *
 * ## Precedencia
 *
 * Sólo las reglas que **declaran** precedencia pueden desplazar a otras. Cuando
 * dos desenlaces compiten sin precedencia declarada, el motor no elige: escala a
 * `REQUIRES_HUMAN_REVIEW` con el conflicto correspondiente
 * (`OPERATIONAL_PRECEDENCE_IS_NOT_POLICY`).
 */

import type {
  CandidateOutcomeTrace,
  Fact,
  EvidenceRef,
  FactRequirement,
  NormativeStatus,
  Outcome,
  PolicyConflict,
  ProvisionalAssessment,
} from '../contracts';
import type { RuleApplication } from './application';
import type { DeclaredPrecedence } from './precedence';
import { survivingOutcomes } from './precedence';
import { isNormativeAuthority, pendingAmbiguityIds } from '../rules/authority';

export interface StatusInput {
  readonly effectiveApplications: readonly RuleApplication[];
  readonly allApplications: readonly RuleApplication[];
  readonly allFacts: readonly Fact[];
  readonly policyConflicts: readonly PolicyConflict[];
  readonly candidateTrace: readonly CandidateOutcomeTrace[];
  readonly evidences: readonly EvidenceRef[];
  /** Prevalencia declarada, compartida con el ranking. */
  readonly declaredPrecedence: DeclaredPrecedence;
}

export interface StatusDecision {
  readonly status: NormativeStatus;
  /** Presente sólo si `status === 'DETERMINATE'`. */
  readonly normativeOutcome: Outcome | null;
  readonly closestOutcome: Outcome | null;
  readonly alternativeOutcomes: readonly Outcome[];
  readonly assessment: ProvisionalAssessment | null;
  /**
   * Por qué este estado y no otro, en una frase.
   *
   * Existe porque la UI y el reporte deben poder explicar la escalada sin
   * recalcularla. Antes de exponerlo, cada rama construía el motivo y lo
   * descartaba, de modo que la traza decía «REQUIRES_HUMAN_REVIEW» sin decir por
   * qué: el nivel de detalle que laEvidence exige quedaba atrás.
   */
  readonly reason: string;
}

/**
 * Decide el estado normativo.
 *
 * Precedencia de las condiciones, en este orden:
 *
 * 1. Hay conflicto materializado ⇒ `REQUIRES_HUMAN_REVIEW`. Un conflicto
 *   _normativo_ dominates la falta de evidencia: aunque sepamos todo, la
 *    norma no cierra el caso.
 * 2. Una regla declara `OWNER_DECISION_REQUIRED` ⇒ `REQUIRES_HUMAN_REVIEW`.
 *    La fuente alcanzó el caso pero no fija desenlace.
 * 3. Hay desenlaces con precedencia declarada y sin oposición ⇒
 *    `DETERMINATE`.
 * 4. Hay hechos faltantes en reglas que de otro modo cerrarían ⇒
 *    `INSUFFICIENT_EVIDENCE`.
 * 5. Hay varios desenlacessin precedencia ⇒ `REQUIRES_HUMAN_REVIEW`.
 * 6. Hay exactamente un desenlace ⇒ `DETERMINATE`.
 * 7. Ningún desenlace ⇒ `INSUFFICIENT_EVIDENCE`.
 */
export function decideStatus(input: StatusInput): StatusDecision {
  const { policyConflicts, effectiveApplications, candidateTrace, allApplications } = input;
  const precedence = input.declaredPrecedence;

  /**
   * Reglas de desenlace apoyadas sólo en fuentes auxiliares.
   *
   * Se calcula antes de decidir el estado porque sus consecuencias aparecen en
   * más de una rama: no sólo impide cerrar por sí misma, sino que además cambia
   * el motivo que se reporta cuando el caso escala por otro motivo.
   */
  const ungrounded = effectiveApplications.filter(
    (application) => application.rule.onMatch.kind === 'OUTCOME' && !isNormativeAuthority(application.rule),
  );

  // 1. Conflicto normativo en el camino alcanzado.
  if (policyConflicts.length > 0) {
    return review(
      policyConflicts,
      candidateTrace,
      input.evidences,
      // El motivo enumera ambas causas. Anunciar sólo el conflicto invita al
      // auditor a pensar que resolverlo basta, cuando mientras la lectura
      // auxiliar siga viva el primario no puede cerrar en solitario.
      'El recorrido alcanzó un conflicto normativo sin resolver.' + ungroundedReason(ungrounded),
    );
  }

  // 2. La fuente alcanza el caso pero no fija desenlace.
  const ownerRequired = effectiveApplications.filter(
    (application) => application.rule.onMatch.kind === 'OWNER_DECISION_REQUIRED',
  );
  if (ownerRequired.length > 0) {
    const conflictIds = ownerRequired
      .map((application) =>
        application.rule.onMatch.kind === 'OWNER_DECISION_REQUIRED'
          ? application.rule.onMatch.conflictId
          : null,
      )
      .filter((id): id is string => id !== null);
    return review(
      [],
      candidateTrace,
      input.evidences,
      'La fuente alcanza el caso pero no declara desenlace: decisión del Owner requerida.',
      [],
      conflictIds,
      precedence,
    );
  }

  // Desenlaces que las reglas efectivamente coincidentes proponen.
  const proposals = new Map<Outcome, RuleApplication[]>();
  for (const application of effectiveApplications) {
    if (application.rule.onMatch.kind !== 'OUTCOME') continue;
    const outcome = application.rule.onMatch.outcome;
    const bucket = proposals.get(outcome) ?? [];
    bucket.push(application);
    proposals.set(outcome, bucket);
  }

  // 2b. Una fuente auxiliar propuso un desenlace sin grounding en el
  //     primario ⇒ el caso no puede cerrarse normativamente.
  //
  //     Es la misma clase de situación que 2: la fuente alcanzó el caso pero no
  //     tiene autoridad para fijar el desenlace. No se descarta el desenlace —el
  //     auditor sí recibe una respuesta concreta a través de `closestOutcome`—
  //     pero `normativeOutcome` queda en `null` y el caso escala.
  //
  //     Se comprueba también cuando hay además una propuesta autoritativa: si una
  //     lectura auxiliar sigue viva, el primario no puede cerrar en solitario, y
  //     `UNKNOWN_IS_NOT_FALSE` impide tratar la duda como si no existiera.
  if (ungrounded.length > 0) {
    const reglas = ungrounded.map((application) => application.rule.ruleId);
    return review(
      [],
      candidateTrace,
      input.evidences,
      'Una regla de fuente auxiliar propone un desenlace que GDM_GAM_PRD_MLG_003 no ' +
        'autoriza a determinar. La fuente primaria es la única que fija el desenlace ' +
        'final, de modo que el resultado sólo puede ser provisional.' +
        ungroundedReason(ungrounded),
      [...proposals.keys()],
      reglas,
      precedence,
    );
  }

  // 3. Desenlaces que otra regla desplazaría por precedencia **declarada**.
  //
  //    La prevalencia ya viene calculada en `precedence.ts` para que el estado y
  //    el ranking no puedan discrepar sobre qué se desplazó. Sólo cuenta lo que
  //    el texto declara; una preferencia operativa aprobada por el Owner se
  //    almacena separada y no se mezcla aquí
  //    (`OPERATIONAL_PRECEDENCE_IS_NOT_POLICY`).
  const survivors = survivingOutcomes(new Set(proposals.keys()), precedence);

  if (survivors.length === 1) {
    return determinate(
      survivors[0],
      proposals,
      candidateTrace,
      input.evidences,
      allApplications,
      input.allFacts,
    );
  }

  // 4. ¿Faltan hechos en reglas que podrían cerrar el caso?
  const missing = collectBlockingFacts(allApplications);
  if (proposals.size <= 1 && missing.length > 0) {
    const only = [...proposals.keys()][0] ?? null;
    return insufficient(
      only,
      proposals,
      candidateTrace,
      input.evidences,
      `La política no pudo aplicarse porque faltan ${missing.length} hecho(s) requerido(s).`,
      missing,
      input.allFacts,
    );
  }

  // 5. Varios desenlaces sin precedencia declarada.
  if (proposals.size > 1) {
    return review(
      [],
      candidateTrace,
      input.evidences,
      'Dos lecturas de la fuente proponen desenlaces distintos y ninguna declara precedencia: ' +
        'el motor no elige.',
      [...proposals.keys()],
      [],
      precedence,
    );
  }

  // 6. Un único desenlace.
  if (proposals.size === 1) {
    const [only] = [...proposals.keys()];
    return determinate(only, proposals, candidateTrace, input.evidences, allApplications, input.allFacts);
  }

  // 7. Ningún desenlace alcanzado.
  return insufficient(
    null,
    proposals,
    candidateTrace,
    input.evidences,
    'Ninguna regla del recorrido coincidió con la evidencia disponible.',
    missing,
    input.allFacts,
  );
}

/**
 * Motivo compartido por las ramas que escalan por lectura auxiliar.
 *
 * Nombra la regla y la ambigüedad que la desbloquearía, para que el motivo sea
 * accionable en lugar de genérico.
 */
function ungroundedReason(ungrounded: readonly RuleApplication[]): string {
  if (ungrounded.length === 0) return '';
  const reglas = ungrounded.map((application) => application.rule.ruleId);
  const pending = pendingAmbiguityIds(ungrounded.map((application) => application.rule));
  return (
    ` Además ${reglas.length === 1 ? 'la regla' : 'las reglas'} ${reglas.join(', ')} ` +
    `${reglas.length === 1 ? 'se apoya' : 'se apoyan'} en fuentes auxiliares que ` +
    'GDM_GAM_PRD_MLG_003 no autoriza a determinar el desenlace, de modo que resolver ' +
    'el conflicto no basta para cerrar el caso.' +
    (pending.length > 0 ? ` Ambigüedades del Owner pendientes: ${pending.join(', ')}.` : '')
  );
}

/** `DETERMINATE`: la fuente cierra el caso. */
function determinate(
  outcome: Outcome,
  proposals: ReadonlyMap<Outcome, RuleApplication[]>,
  candidateTrace: readonly CandidateOutcomeTrace[],
  evidences: readonly EvidenceRef[],
  allApplications: readonly RuleApplication[],
  allFacts: readonly Fact[],
): StatusDecision {
  const trace = candidateTrace.find((item) => item.outcome === outcome);
  const support = proposals.get(outcome) ?? [];
  return {
    status: 'DETERMINATE',
    normativeOutcome: outcome,
    reason:
      `La fuente normativa fija ${outcome} de forma unívoca: ` +
      `${support.length} regla(s) autoritativa(s) coinciden y ninguna otra lectura ` +
      'deja el desenlace en disputa.',
    closestOutcome: outcome,
    alternativeOutcomes: candidateTrace
      .filter((item) => item.outcome !== outcome)
      .map((item) => item.outcome),
    assessment: assessmentFor(outcome, proposals, trace, evidences, allApplications, allFacts, []),
  };
}

/** `INSUFFICIENT_EVIDENCE`: la política es clara pero faltan hechos. */
function insufficient(
  outcome: Outcome | null,
  proposals: ReadonlyMap<Outcome, RuleApplication[]>,
  candidateTrace: readonly CandidateOutcomeTrace[],
  evidences: readonly EvidenceRef[],
  reason: string,
  missing: readonly string[],
  allFacts: readonly Fact[],
): StatusDecision {
  const trace = outcome ? candidateTrace.find((item) => item.outcome === outcome) : undefined;
  return {
    status: 'INSUFFICIENT_EVIDENCE',
    normativeOutcome: null,
    // Provisional, nunca presentado como normativo.
    closestOutcome: outcome,
    reason,
    alternativeOutcomes: candidateTrace
      .filter((item) => item.outcome !== outcome)
      .map((item) => item.outcome),
    assessment:
      outcome === null
        ? null
        : assessmentFor(outcome, proposals, trace, evidences, [], allFacts, missing, reason),
  };
}

/** `REQUIRES_HUMAN_REVIEW`: conflicto o ambigüedad normativa. */
function review(
  conflicts: readonly PolicyConflict[],
  candidateTrace: readonly CandidateOutcomeTrace[],
  evidences: readonly EvidenceRef[],
  reason: string,
  /** Desenlaces en disputa: el motor no elige entre ellos. */
  disputedOutcomes: readonly Outcome[] = [],
  extraConflictIds: readonly string[] = [],
  precedence: DeclaredPrecedence = { overridden: new Set(), overriddenBy: new Map() },
): StatusDecision {
  const blockingConflictIds = [
    ...new Set([
      ...conflicts.map((conflict) => conflict.conflictId),
      ...extraConflictIds,
    ]),
  ];

  // `closestOutcome` existe sólo si el ranking no está empatado. Un empate es
  // información: la evidencia no prefiere ninguno.
  //
  // Un desenlace que la fuente declara desplazado no puede ser el «más
  // cercano»: sería recomendar exactamente lo que el texto excluye. Sigue
  // apareciendo en `alternativeOutcomes` y en `candidateTrace`, porque la traza
  // debe mostrar que la lectura existió y por qué se descartó.
  const eligible = candidateTrace.filter((item) => !precedence.overridden.has(item.outcome));
  const top = eligible[0];
  const tied =
    top !== undefined &&
    eligible.length > 1 &&
    eligible[1].supportScore === top.supportScore;
  const closest = tied ? null : (top?.outcome ?? null);

  const support = top && closest ? top.supportingRuleIds : [];

  return {
    status: 'REQUIRES_HUMAN_REVIEW',
    normativeOutcome: null,
    closestOutcome: closest,
    reason,
    // Si el ranking no produjo candidatos (caso OWNER_DECISION_REQUIRED), los
    // desenlaces en disputa provienen de las reglas que se alcanzaron.
    alternativeOutcomes:
      candidateTrace.length > 0
        ? candidateTrace.map((item) => item.outcome)
        : [...disputedOutcomes],
    assessment: closest
      ? {
          supportingEvidence: evidences,
          conflictingEvidence: [],
          supportingRuleIds: support,
          unresolvedFactors: blockingConflictIds,
          explanation: `${reason} El desenlace mostrado es PROVISIONAL y no es un resultado normativo.`,
          blockingConflictIds,
        }
      : null,
  };
}

/** Construye el assessment provisional a partir de la traza del candidato. */
function assessmentFor(
  outcome: Outcome,
  proposals: ReadonlyMap<Outcome, RuleApplication[]>,
  trace: CandidateOutcomeTrace | undefined,
  evidences: readonly EvidenceRef[],
  allApplications: readonly RuleApplication[],
  allFacts: readonly Fact[],
  missing: readonly string[],
  extraExplanation?: string,
): ProvisionalAssessment {
  const support = proposals.get(outcome) ?? [];
  const supportingEvidence = evidences.filter((evidence) =>
    support.some((application) => application.usedFactIds.length > 0),
  );

  // `EvidenceRef` no declara `factId`: la relación hecho↔evidencia vive en
  // `Fact.evidenceRefs`. Por eso la evidencia contradictoria se toma de los
  // hechos marcados CONTRADICTED, no de las reglas.
  const contradictoryFactIds = new Set(
    allApplications.flatMap((application) => application.contradictoryFactIds),
  );
  const conflictingEvidence = allFacts
    .filter((fact) => contradictoryFactIds.has(fact.factId))
    .flatMap((fact) => fact.evidenceRefs);

  const base = trace?.rationale ?? `Sin reglas de apoyo para ${outcome} en este recorrido.`;
  const seen = new Set<string>();

  return {
    supportingEvidence,
    conflictingEvidence: conflictingEvidence.filter((evidence) => {
      if (seen.has(evidence.evidenceId)) return false;
      seen.add(evidence.evidenceId);
      return true;
    }),
    supportingRuleIds: trace?.supportingRuleIds ?? support.map((a) => a.rule.ruleId),
    unresolvedFactors: missing,
    explanation: extraExplanation
      ? `${extraExplanation} ${base}`
      : `${base} Evaluación PROVISIONAL: no constituye resultado normativo.`,
    blockingConflictIds: trace?.conflictIds ?? [],
  };
}

/** Hechos no determinables consultados por reglas que no coincidencearon. */
function collectBlockingFacts(applications: readonly RuleApplication[]): string[] {
  const ids = new Set<string>();
  for (const application of applications) {
    if (application.matched) continue;
    for (const factId of application.blockingFactIds) ids.add(factId);
  }
  return [...ids].sort();
}
