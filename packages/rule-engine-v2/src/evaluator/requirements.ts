/**
 * Requisitos de evidencia no satisfeitos.
 *
 * ## Para qué sirve
 *
 * Cuando el motor devuelve `INSUFFICIENT_EVIDENCE`, el auditor necesita saber
 * **qué** pedir, no sólo que falta algo. Este módulo traduce los hechos
 * bloqueantes de las reglas no coincidentes en `FactRequirement`: identificador,
 * nombre, qué reglas lo exigen, qué tipos de evidencia lo acreditarían y por qué
 * su ausencia cambia el resultado.
 *
 * Sólo reporta hechos **realmente consultados** por una regla del recorrido. No
 * infiere requisitos: si una regla nunca se evaluó contra el caso, su requisito
 * no se reporta.
 */

import { factDefinition } from '../facts/catalog';
import { conditionFactIds } from '../conditions';
import type { FactDefinition } from '../facts/catalog';
import type { FactRequirement } from '../contracts';
import type { FactIndex } from '../conditions';
import type { RuleApplication } from './application';

export interface RequirementInput {
  readonly applications: readonly RuleApplication[];
  readonly index: FactIndex;
}

export function collectMissingRequirements(input: RequirementInput): FactRequirement[] {
  /** Reglas que exigen cada hecho pendiente. */
  const requiredBy = new Map<string, Set<string>>();

  for (const application of input.applications) {
    // Una regla que coincidió no aporta requisitos pendientes: su evidencia
    // estaba y se aplicó.
    if (application.matched) continue;

    // ## Alcance del reporte
    //
    // Reportar el hecho faltante de *toda* regla del grafo produciría decenas de
    // requisitos irrelevantes: pediría expedientes de D53 a una auditoría que
    // ni siquiera es de nuevo ingreso. Eso no es ayuda al auditor, es ruido que
    // esconde lo importante.
    //
    // Se descartan primero los valores que no son evidencia faltante:
    //
    // - `TRUE`   → la regla se aplicó: no falta nada.
    // - `FALSE`  → algún operando ya es definitivamente falso, así que aportar
    //   el dato faltante **no** cambiaría el desenlace.
    // - `NOT_APPLICABLE` / `CONTRADICTED` → el problema es la exclusión del
    //   caso o el conflicto, no la ausencia de evidencia.
    //
    // Queda `UNKNOWN`. Y aquí está el matiz que evita el ruido: una regla
    // bloqueada puede estarlo de dos maneras muy distintas para el auditor.
    if (application.conditionValue !== 'UNKNOWN') continue;
    if (!isDecisive(application, input.index)) continue;

    for (const factId of application.blockingFactIds) {
      // Si el hecho existe pero está `CONTRADICTED`, la ausencia no es el
      // problema: el conflicto es. Este módulo no lo reporta.
      const found = input.index.get(factId);
      if (found && found.state === 'CONTRADICTED') continue;

      const definition = safeDefinition(factId);
      if (!definition) continue;

      const bucket = requiredBy.get(factId) ?? new Set<string>();
      bucket.add(application.rule.ruleId);
      requiredBy.set(factId, bucket);
    }
  }

  const requirements: FactRequirement[] = [];
  for (const [factId, ruleIds] of requiredBy) {
    const definition = safeDefinition(factId);
    if (!definition) continue;
    requirements.push(toRequirement(factId, definition, [...ruleIds].sort()));
  }

  return requirements.sort((a, b) => a.factId.localeCompare(b.factId));
}

/**
 * ¿La evidencia ausente de esta regla es **decisiva** para el auditor?
 *
 * Una regla en `UNKNOWN` puede estarlo por dos motivos que exigen acciones
 * opuestas del auditor:
 *
 * 1. **Rama explorada.** La regla consulta hechos y algunos ya se resolvieron
 *    (`TRUE` o `FALSE`); sólo falta uno. Aportarlo decide la regla. El auditor
 *    debe saber cuál.
 * 2. **Rama sin explorar.** Ningún hecho de la regla está resuelto. Entonces no
 *    es que falte un dato: es que esa rama no se ha evaluado. Pedir los 5 hechos
 *    de una regla de D53 en una auditoría que ya tiene calificaciones registradas
 *    no ayuda; distrae de la evidencia que sí decide.
 *
 * Se reportan los casos (1) y el caso límite que sí es decisivo:
 *
 * 3. **Regla de un solo hecho.** Si la condición depende de exactamente un
 *    hecho, ese hecho *es* la regla: no hay rama por explorar, sólo un dato
 *    ausente. Los filtros de prevalencia (`R-FILTRO-CALIFICACIONES`) son de este
 *    tipo, y son precisamente los que más rápido determinan un caso.
 *
 * Ninguno de estos tres criterios introduce un umbral: son preguntas sobre la
 * forma de la condición y sobre lo que ya se sabe, no sobre cuánta confianza
 * acumular.
 */
function isDecisive(application: RuleApplication, index: FactIndex): boolean {
  const referenced = conditionFactIds(application.rule.condition);

  if (referenced.length === 0) return false;
  if (referenced.length === 1) return true;

  const anyResolved = referenced.some((factId) => index.get(factId)?.state === 'KNOWN');
  return anyResolved;
}

function toRequirement(
  factId: string,
  definition: FactDefinition,
  requiredForRuleIds: readonly string[],
): FactRequirement {
  return {
    requirementId: `REQ-${factId}`,
    factId,
    name: definition.name,
    description: definition.description,
    requiredForRuleIds,
    satisfiableBy: definition.satisfiableBy,
    normativeInvariant: definition.normativeInvariant ?? false,
    whyItMatters: definition.whyItMatters,
    sourceRefs: definition.sourceRefs,
  };
}

/** Definición del catálogo, o `undefined` si el hecho no está catalogado. */
function safeDefinition(factId: string): FactDefinition | undefined {
  try {
    return factDefinition(factId);
  } catch {
    return undefined;
  }
}
