/**
 * Huella determinista de un conjunto de reglas o de una condición.
 *
 * ## Para qué sirve
 *
 * `rulesFingerprint` viaja en cada `AuditEvaluation`. Si dos auditorías usan la
 * misma versión de política pero producen huellas distintas, significa que
 * el registro de reglas cambió sin cambiar la versión: eso es un
 * `POLICY_ENGINE_DECIDES` roto y debe ser visible, no silencioso.
 *
 * ## Cómo se calcula
 *
 * FNV-1a de 32 bits sobre una serialización canónica y estable. No es un hash
 * criptográfico: es una suma de verificación rápida y reproducible, suficiente
 * para detectar deriva entre procesos. La integridad real de las fuentes la
 * garantiza el SHA-256 de `sources.ts`, no esta huella.
 *
 * La serialización ordena por `ruleId` y por clave de propiedad, de modo que
 * reordenar el archivo no cambia la huella.
 */

import type { Condition } from '../conditions';
import type { Rule } from '../rules/types';

/** Huella de 8 dígitos hexadecimales. */
export type Fingerprint = string;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Acumulador FNV-1a de 32 bits. */
class Hasher {
  private hash = FNV_OFFSET_BASIS;

  push(text: string): this {
    for (let index = 0; index < text.length; index += 1) {
      this.hash ^= text.charCodeAt(index);
      // >>> 0 mantiene el resultado en uint32 sin perdidas de signo.
      this.hash = Math.imul(this.hash, FNV_PRIME) >>> 0;
    }
    return this;
  }

  digest(): Fingerprint {
    return this.hash.toString(16).padStart(8, '0');
  }
}

/** Huella de una lista de reglas. Orden estable por `ruleId`. */
export function rulesFingerprint(rules: readonly Rule[]): Fingerprint {
  const hasher = new Hasher();
  const sorted = [...rules].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  for (const rule of sorted) {
    hasher.push(rule.ruleId).push('|');
    hasher.push(rule.nodeId).push('|');
    hasher.push(rule.kind).push('|');
    hasher.push(rule.description.trim()).push('|');
    hasher.push(stableStringify(rule.onMatch)).push('|');
    hasher.push(stableStringify(rule.condition)).push('|');
    hasher.push((rule.declaredPrecedenceOver ?? []).join(',')).push('|');
    // La prevalencia por categoría cambia decisiones igual que la por regla: si
    // no entrara en la huella, cambiar quién queda desplazado sería invisible.
    hasher.push((rule.declaredPrecedenceOverOutcomes ?? []).join(',')).push('|');
    hasher.push((rule.blocksRuleIds ?? []).join(',')).push('|');
    hasher.push((rule.conflictIds ?? []).join(',')).push('|');
    // Las citas son un conjunto, no una secuencia: reordenarlas en el archivo no
    // cambia la política. Sin ordenar, un refactor cosmético haría Saltar la
    // huella y reportaría deriva donde no la hay.
    hasher.push(
      rule.sourceRefs
        .map((ref) => `${ref.sourceLockId}#${ref.page}#${ref.section}#${ref.statementId}`)
        .sort()
        .join(','),
    );
    hasher.push('\n');
  }
  return hasher.digest();
}

/**
 * Huella de un valor arbitrario, con la misma semántica de «cambió».
 *
 * Compartida por la huella de reglas, la de condiciones y la de la traza, para
 * que las tres respondan idénticamente a «¿esto es lo mismo que antes?».
 */
export function stableHash(value: unknown): Fingerprint {
  return new Hasher().push(stableStringify(value)).digest();
}

/** Huella de una condición, para la traza de reglas. */
export function conditionFingerprint(condition: Condition): Fingerprint {
  return stableHash(condition);
}

/**
 * Serialización canónica: claves ordenadas, `undefined` eliminado.
 *
 * Sin esto, dos objetos con las mismas propiedades en distinto orden producirían
 * huellas distintas y el determinismo quedaría pendiente de cómo se escribió
 * el literal.
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}
