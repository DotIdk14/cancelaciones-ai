/**
 * Identidad de las 3 fuentes normativas selladas.
 *
 * Cada referencia de enunciado que el motor produce incluye el **SHA-256 del
 * archivo**, de modo que una regla queda ligada al binario exacto del que se
 * extrajo. Si el hash cambia, la trazabilidad se rompe de forma visible
 * (`PRESERVE_EVIDENCE_PROVENANCE`).
 *
 * Los valores provienen de `docs/policy-v2/source-lock.md` y no pueden
 * editarse sin cambiar la versión de política.
 */

import type { SourceLockId, SourceRef } from './contracts';

/**
 * Rol normativo de una fuente.
 *
 * ## Por qué el rol es parte del dato y no un comentario
 *
 * `AUXILIARY_SOURCE_CANNOT_DEFINE_TOP_LEVEL_OUTCOME` no puede dejarse en la
 * prosa: si sólo se documentara, nada impediría que una reglaAuxiliary emitiera
 * un desenlace de primer nivel. Al ser un campo del dato, el registro puede
 * verificarlo y `evaluateAudit()` puede negarse a promoverlo.
 *
 * ## Los tres roles
 *
 * - `PRIMARY_NORMATIVE_DECISION_SOURCE` — única fuente que puede determinar el
 *   desenlace final de una auditoría. Para este procedimiento es
 *   `GDM_GAM_PRD_MLG_003`.
 * - `AUXILIARY_REFERENCED_SOURCE` — procedimiento citado por el primario. Aporta
 *   hechos, plazos y condiciones, y participa en el razonamiento porque el
 *   primario lo invoca, pero no define desenlaces por sí mismo.
 * - `AUXILIARY_DEFINITION_SOURCE` — glosario: define vocabulario. No decide
 *   desenlaces ni plazos.
 */
export type SourceRole =
  | 'PRIMARY_NORMATIVE_DECISION_SOURCE'
  | 'AUXILIARY_REFERENCED_SOURCE'
  | 'AUXILIARY_DEFINITION_SOURCE';

interface SourceIdentity {
  readonly sourceLockId: SourceLockId;
  readonly documentCode: string;
  readonly title: string;
  readonly documentVersion: string;
  readonly sha256: string;
  readonly pages: number;
  /** Rol normativo. Determina qué puede la fuente decidir. */
  readonly role: SourceRole;
}

export const SOURCE_01 = {
  sourceLockId: 'SOURCE-01',
  documentCode: 'GDM_GAM_PRD_MLG_003',
  title: 'PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES',
  documentVersion: '5',
  sha256: '71faf64634805b1b4820132cdfcc1304d740ff00d1e9573dd850222c9496c7d2',
  pages: 26,
  role: 'PRIMARY_NORMATIVE_DECISION_SOURCE',
} as const satisfies SourceIdentity;

export const SOURCE_02 = {
  sourceLockId: 'SOURCE-02',
  documentCode: 'GDM_GAM_PRD_MXL_008',
  title: 'Procedimiento D53',
  documentVersion: '1',
  sha256: '49c30482571ebce425d5ff217584c1b390d7c0986f4e93ce033c98df4ee7c383',
  pages: 8,
  role: 'AUXILIARY_REFERENCED_SOURCE',
} as const satisfies SourceIdentity;

export const SOURCE_03 = {
  sourceLockId: 'SOURCE-03',
  documentCode: 'GLOSARIO_OPERACION_ESCOLAR',
  title: 'Glosario de operación escolar',
  documentVersion: 's/version',
  sha256: 'de15e50b4faa6919fb4b7de25cf9bb5e6ee538348b8657ba38d8a48e9463e9f5',
  pages: 30,
  role: 'AUXILIARY_DEFINITION_SOURCE',
} as const satisfies SourceIdentity;

/**
 * `true` si la fuente puede determinar por sí sola un desenlace de primer nivel.
 *
 * Única puerta que hace cumplir `AUXILIARY_SOURCE_CANNOT_DEFINE_TOP_LEVEL_OUTCOME`
 * a nivel de dato, sin depender de la disciplina de quien escriba una regla.
 */
export function isPrimaryNormativeSource(sourceLockId: SourceLockId): boolean {
  return sourceById(sourceLockId).role === 'PRIMARY_NORMATIVE_DECISION_SOURCE';
}

/** Las 3 fuentes, en orden estable. */
export const SOURCES: readonly SourceIdentity[] = [SOURCE_01, SOURCE_02, SOURCE_03] as const;

/** Identidad de fuente por su `sourceLockId`. */
export function sourceById(sourceLockId: SourceLockId): SourceIdentity {
  const found = SOURCES.find((source) => source.sourceLockId === sourceLockId);
  if (!found) throw new RangeError(`Fuente desconocida: ${sourceLockId}.`);
  return found;
}

/** Atajo para el documento rector (GDM_GAM_PRD_MLG_003). */
export function primary(page: number, section: string, statementId: string): SourceRef {
  return {
    sourceLockId: SOURCE_01.sourceLockId,
    documentCode: SOURCE_01.documentCode,
    documentVersion: SOURCE_01.documentVersion,
    sha256: SOURCE_01.sha256,
    page,
    section,
    statementId,
  };
}

/** Atajo para el Procedimiento D53 (GDM_GAM_PRD_MXL_008). */
export function d53(page: number, section: string, statementId: string): SourceRef {
  return {
    sourceLockId: SOURCE_02.sourceLockId,
    documentCode: SOURCE_02.documentCode,
    documentVersion: SOURCE_02.documentVersion,
    sha256: SOURCE_02.sha256,
    page,
    section,
    statementId,
  };
}

/** Atajo para el Glosario de operación escolar. */
export function glossary(page: number, section: string, statementId: string): SourceRef {
  return {
    sourceLockId: SOURCE_03.sourceLockId,
    documentCode: SOURCE_03.documentCode,
    documentVersion: SOURCE_03.documentVersion,
    sha256: SOURCE_03.sha256,
    page,
    section,
    statementId,
  };
}
