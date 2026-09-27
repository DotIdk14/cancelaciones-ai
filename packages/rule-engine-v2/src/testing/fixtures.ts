/**
 * Fixtures de prueba del Rule Engine V2.
 *
 * ## Por qué un archivo compartido
 *
 * Las 20 categorías de test necesitan el mismo caso base con variaciones
 * mínimas. Si cada test construyera su propio caso, un cambio en el catálogo
 * rompería tests por razones que no tienen que ver con lo que prueban. Aquí el
 * caso se declara una vez y los tests expresan **la diferencia** que les
 * importa.
 *
 * Todos los hechos son sintéticos: no contienen PII ni provienen de
 * auditorías reales (`NO_PII_IN_GIT`).
 */

import type {
  EvidenceContext,
  EvidenceRef,
  Fact,
  NivelAcademico,
  TemporalContext,
} from '../contracts';
import { knownFact } from '../contracts';

/** Fecha de inicio del ciclo usada por defecto en los tests. */
export const CICLO_INICIO = '2026-01-05';

/** Contexto temporal por defecto: 10 días después del inicio del ciclo. */
export const TEMPORAL_DEFECTO: TemporalContext = {
  cicloFechaInicio: CICLO_INICIO,
  fechaSolicitud: '2026-01-15',
  fechaIngreso: '2026-01-05',
  inicioPrimerCiclo: '2024-08-05',
  avanceCurricularPercent: 10,
};

export function evidencia(id: string, label = id): EvidenceRef {
  return { evidenceId: id, kind: 'TEXT', label };
}

export function contexto(
  nivel: NivelAcademico = 'LICENCIATURA',
  temporal: TemporalContext = TEMPORAL_DEFECTO,
  evidences: readonly EvidenceRef[] = [evidencia('EV-1')],
): EvidenceContext {
  return { evidences, temporal, nivelAcademico: nivel, campus: 'MEXICO' };
}

/** Hecho booleano `KNOWN` con valor explícito. */
export function bool(factId: string, value: boolean, evidenceId = 'EV-1'): Fact {
  return knownFact(factId, value, { evidenceRefs: [evidencia(evidenceId)] });
}

/** Hecho `KNOWN` con valor arbitrario. */
export function val(factId: string, value: unknown, evidenceId = 'EV-1'): Fact {
  return knownFact(factId, value, { evidenceRefs: [evidencia(evidenceId)] });
}

/** Hecho explícitamente no determinable. */
export function unknown(
  factId: string,
  reason = 'No se encontró evidencia que lo acredite.',
): Fact {
  return {
    factId,
    value: null,
    state: 'UNKNOWN',
    evidenceRefs: [],
    provenance: [],
    extractionMethod: 'DETERMINISTIC',
    relevantTimestamp: null,
    unknownReason: reason,
  };
}

/**
 * Hecho declarado no aplicable a este caso.
 *
 * No es lo mismo que `UNKNOWN`: aquí se afirma que la regla no aplica (el
 * estudiante no está en el supuesto), no que falte información. Ninguno de los
 * dos permite cerrar el caso por negación.
 */
export function notApplicable(factId: string, reason = 'La regla no aplica a este caso.'): Fact {
  return {
    factId,
    value: null,
    state: 'NOT_APPLICABLE',
    evidenceRefs: [],
    provenance: [],
    extractionMethod: 'DETERMINISTIC',
    relevantTimestamp: null,
    unknownReason: reason,
  };
}

/** Hecho con evidencia en conflicto. */
export function contradicted(factId: string, evidenceIds: readonly string[] = ['EV-1', 'EV-2']): Fact {
  return {
    factId,
    value: null,
    state: 'CONTRADICTED',
    evidenceRefs: evidenceIds.map((id) => evidencia(id)),
    provenance: [],
    extractionMethod: 'DETERMINISTIC',
    relevantTimestamp: null,
    notes: 'Dos evidencias oficiales se contradicen.',
  };
}
