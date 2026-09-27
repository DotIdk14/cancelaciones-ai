/**
 * Autoridad normativa de una regla para determinar un desenlace de primer nivel.
 *
 * ## La regla del proyecto
 *
 * ```text
 * PRIMARY_NORMATIVE_DECISION_SOURCE = GDM_GAM_PRD_MLG_003
 * ```
 *
 * Sólo esa fuente define la resolución final de una auditoría. D53 y el
 * glosario son fuentes auxiliares: aportan hechos, definiciones y plazos, y
 * participan en el razonamiento porque el primario los invoca, pero no pueden
 * **declarar** por sí mismas un desenlace de deserción.
 *
 * ## Por qué no basta con «la regla cita al primario»
 *
 * Una regla puede citar al primario para justificar *un hecho* y emitir el
 * desenlace por otra vía. El test correcto no es «¿apareció SOURCE-01 en las
 * citas?», sino «¿existe una cita del primario que autorice **este** desenlace?».
 * Eso es `primaryGrounding`: una cita explícita, en la propia regla, que conecta
 * el desenlace con el procedimiento rector.
 *
 * ## Qué se hace con una regla sin grounding
 *
 * No se borra ni se silencia. Sigue declarando su desenlace, así que el ranking
 * provisional puede ofrecerlo y el auditor recibe una respuesta concreta. Lo que
 * no puede es **promoverse** a `normativeOutcome`: la evaluación pasa a
 * `REQUIRES_HUMAN_REVIEW` y expone qué ambigüedades del Owner bloquean la
 * confirmación.
 *
 * Esto es exactamente el caso B del producto: respuesta útil + estado que
 * califica. La revisión humana verifica la excepción; no repite la auditoría.
 * Y no responde ninguna de las 15 preguntas: las registra.
 */

import type { Rule } from './types';
import type { ProvisionalOnlyRule } from '../contracts';
import { isPrimaryNormativeSource } from '../sources';

/**
 * `true` si la regla puede fundamentar un desenlace normativo por sí misma.
 *
 * Sólo las reglas que emiten un desenlace de primer nivel necesitan grounding;
 * una regla `CONTINUE`, `ESCALATE_TO_NODE` o `OWNER_DECISION_REQUIRED` no
 * determina ningún desenlace y por tanto no lo necesita.
 */
export function isNormativeAuthority(rule: Rule): boolean {
  // Una regla que no propone desenlace no tiene nada que fundamentar.
  if (rule.onMatch.kind !== 'OUTCOME') return true;

  // Camino indirecto: el cuerpo de la regla se apoya en una fuente auxiliar,
  // pero el primario conecta explícitamente ese contenido con el desenlace. Es el
  // caso de `R-RET-03`, cuyo cuerpo es glosario y cuyo grounding es `N-32`.
  if (rule.primaryGrounding !== undefined) {
    return isPrimaryNormativeSource(rule.primaryGrounding.sourceLockId);
  }

  // Camino directo: la propia regla cita al primario, y esa cita es el
  // grounding. No hace falta declarar un segundo campo para lo que las
  // `sourceRefs` ya digo.
  return rule.sourceRefs.some((ref) => isPrimaryNormativeSource(ref.sourceLockId));
}

/**
 * Reglas que calificaron pero no pueden fundamentar el desenlace.
 *
 * Se exponen en la evaluación para que la UI pueda decir *qué* espera: no un
 * «revisar» genérico, sino los IDs de ambigüedad concretos que hoy bloquean la
 * confirmación normativa.
 *
 * El tipo vive en `contracts.ts` porque forma parte de la evaluación pública; no
 * se redeclara aquí para evitar dos definiciones que puedan divergir.
 */

function describeProvisionalOnly(rule: Rule): ProvisionalOnlyRule | null {
  if (rule.onMatch.kind !== 'OUTCOME') return null;
  if (isNormativeAuthority(rule)) return null;
  return {
    ruleId: rule.ruleId,
    outcome: rule.onMatch.outcome,
    awaitsAmbiguityIds: rule.awaitsAmbiguityIds ?? [],
    sourceRefs: rule.sourceRefs.map((ref) => ({
      sourceLockId: ref.sourceLockId,
      statementId: ref.statementId,
    })),
  };
}

/** Filtra las reglas emparejadas que sólo pueden aportar un resultado provisional. */
export function provisionalOnlyRules(rules: readonly Rule[]): ProvisionalOnlyRule[] {
  const out: ProvisionalOnlyRule[] = [];
  for (const rule of rules) {
    const described = describeProvisionalOnly(rule);
    if (described !== null) out.push(described);
  }
  return out;
}

/** IDs de ambigüedad pendientes, deduplicados y en orden estable. */
export function pendingAmbiguityIds(rules: readonly Rule[]): string[] {
  const ids = new Set<string>();
  for (const rule of rules) {
    for (const id of rule.awaitsAmbiguityIds ?? []) ids.add(id);
  }
  return [...ids].sort();
}
