/**
 * Ranking provisional de desenlaces candidatos.
 *
 * ## Qué es y qué no es
 *
 * Este módulo **no** elige el resultado normativo. Ordena candidatos para
 * responder «¿qué desenlace es el más compatible con la evidencia disponible?»
 * y eso se etiqueta como provisional en la UI y en los reportes.
 *
 * ## Por qué un conteo entero y no una probabilidad
 *
 * Las fuentes no contienen frecuencias, priors ni probabilidades. Publicar
 * «CANCELACION_VENTA con 78 % de confianza» sería inventar un número que la
 * norma no respalda (`NO_FAKE_PROBABILITIES`). El soporte es un **conteo
 * entero** de reglas de apoyo menos reglas bloqueantes, y su explicación dice
 * exactamente qué reglas lo componen.
 *
 * ## Empates
 *
 * Si dos desenlaces empatan en el máximo, no hay soporte que prefiera a ninguno:
 * `closestOutcome` es `null` y ambos aparecen en `alternativeOutcomes`. Nunca
 * se rompe el empate por orden de declaración, porque eso sería el motor
 * inventando preferencia normativa.
 */

import { OUTCOMES } from '../contracts';
import type {
  CandidateOutcomeTrace,
  EvidenceRef,
  Outcome,
  PolicyConflict,
} from '../contracts';
import type { RuleApplication } from '../evaluator/application';

/** Acumulación de un candidato. */
interface Accumulator {
  outcome: Outcome;
  supporting: RuleApplication[];
  blocking: RuleApplication[];
  conflicting: RuleApplication[];
  unresolvedFactIds: Set<string>;
  contradictoryFactIds: Set<string>;
  conflictIds: Set<string>;
}

/**
 * Ordena los candidatos y decide el `closestOutcome`.
 *
 * @param effective  reglas que coincidieron y no fueron neutralizadas
 * @param conflicts  conflictos materializados en este recorrido
 * @param evidences  evidencia del caso, para el assessment provisional
 */
export function rankCandidates(
  effective: readonly RuleApplication[],
  conflicts: readonly PolicyConflict[],
  evidences: readonly EvidenceRef[],
): readonly CandidateOutcomeTrace[] {
  const byOutcome = new Map<Outcome, Accumulator>();

  const acc = (outcome: Outcome): Accumulator => {
    let found = byOutcome.get(outcome);
    if (!found) {
      found = {
        outcome,
        supporting: [],
        blocking: [],
        conflicting: [],
        unresolvedFactIds: new Set(),
        contradictoryFactIds: new Set(),
        conflictIds: new Set(),
      };
      byOutcome.set(outcome, found);
    }
    return found;
  };

  // 1. Reglas de apoyo por desenlace.
  for (const application of effective) {
    if (application.rule.onMatch.kind !== 'OUTCOME') continue;
    const bucket = acc(application.rule.onMatch.outcome);
    bucket.supporting.push(application);
    for (const factId of application.blockingFactIds) bucket.unresolvedFactIds.add(factId);
    for (const factId of application.contradictoryFactIds) {
      bucket.contradictoryFactIds.add(factId);
    }
    for (const conflictId of application.conflictIds) bucket.conflictIds.add(conflictId);
  }

  // 2. Reglas bloqueantes: restan al desenlace que la regla bloqueada habría
  //    producido. Una contraevidencia que no declara desenlace no resta a nadie:
  //    bloquea, y eso basta.
  for (const application of effective) {
    const blockedIds = application.rule.blocksRuleIds ?? [];
    if (blockedIds.length === 0) continue;
    for (const blockedRuleId of blockedIds) {
      const blocked = effective.find((item) => item.rule.ruleId === blockedRuleId);
      if (blocked && blocked.rule.onMatch.kind === 'OUTCOME') {
        acc(blocked.rule.onMatch.outcome).blocking.push(application);
      }
    }
  }

  // 3. Conflictos: marcan a todos los desenlaces que el conflicto podría tomar.
  for (const conflict of conflicts) {
    for (const outcome of conflict.candidateOutcomes) {
      acc(outcome).conflictIds.add(conflict.conflictId);
    }
  }

  // 4. Puntuación entera: apoyo menos bloqueo.
  //
  //    Un cubo creado sólo por el paso 3 —es decir, un desenlace que *menciona*
  //    un conflicto pero que ninguna regla efectiva propone— no es un candidato:
  //    ofrecerlo inflaría el ranking con desenlaces que nadie sostiene. Se
  //    conserva el caso con apoyo negativo (una regla que lo proponía fue
  //    neutralizada por contraevidencia), porque ahí el cero sí es información.
  const scored = [...byOutcome.values()]
    .filter((bucket) => bucket.supporting.length > 0 || bucket.blocking.length > 0)
    .map((bucket) => {
      const supportScore = bucket.supporting.length - bucket.blocking.length;
      return { bucket, supportScore };
    });

  // 5. Orden determinista: puntuación descendente y, a igualdad, el orden
  //    canónico de `OUTCOMES`. Este desempate NO decide `closestOutcome`; sólo
  //    ordena la lista para que la salida sea estable.
  const canonicalOrder = new Map(OUTCOMES.map((outcome, index) => [outcome, index]));
  scored.sort((a, b) => {
    if (b.supportScore !== a.supportScore) return b.supportScore - a.supportScore;
    return (
      (canonicalOrder.get(a.bucket.outcome) ?? 0) - (canonicalOrder.get(b.bucket.outcome) ?? 0)
    );
  });

  return scored.map((entry, index) => ({
    outcome: entry.bucket.outcome,
    rank: index + 1,
    supportScore: entry.supportScore,
    supportingRuleIds: entry.bucket.supporting.map((item) => item.rule.ruleId),
    supportingFactIds: unique(entry.bucket.supporting.flatMap((item) => item.usedFactIds)),
    blockingRuleIds: unique(
      entry.bucket.blocking.map((item) => item.rule.ruleId),
    ),
    contradictoryFactIds: [...entry.bucket.contradictoryFactIds].sort(),
    unresolvedFactIds: [...entry.bucket.unresolvedFactIds].sort(),
    conflictIds: [...entry.bucket.conflictIds].sort(),
    rationale: rationaleFor(entry.bucket, entry.supportScore, evidences.length),
  }));
}

/** Explicación legible del puntaje. Sin porcentajes. */
function rationaleFor(
  bucket: Accumulator,
  supportScore: number,
  evidenceCount: number,
): string {
  const parts: string[] = [];
  if (bucket.supporting.length > 0) {
    parts.push(`${bucket.supporting.length} regla(s) de apoyo`);
  }
  if (bucket.blocking.length > 0) {
    parts.push(`${bucket.blocking.length} contraevidencia(s)`);
  }
  if (bucket.conflictIds.size > 0) {
    parts.push(`${bucket.conflictIds.size} conflicto(s) normativo(s)`);
  }
  const head =
    parts.length > 0 ? parts.join(', ') : 'sin reglas de apoyo en este recorrido';
  return (
    `Puntaje ${supportScore} = ${head}. Conteo entero, no probabilidad. ` +
    `Evidencia del caso: ${evidenceCount} referencia(s).`
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
