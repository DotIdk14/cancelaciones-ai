/**
 * Hechos derivados que el evaluador sintetiza antes de evaluar reglas.
 *
 * ## Por qué existen
 *
 * El catálogo declara cuatro hechos de actividad —uno por nivel— con
 * polaridad opuesta (`AMB-LOG-02`). La regla de ilocalizable necesita saber
 * «¿hay actividad?», que es una pregunta de **sentido positivo** común a los
 * cuatro niveles. Si cada regla invirtiera manualmente el hecho de su nivel,
 * la inversión quedaría en el `if` del evaluador, que es exactamente donde un
 * error pasaría desapercibido.
 *
 * Aquí se resuelve una sola vez, leyendo `activityPolarity` del catálogo:
 *
 * - polaridad `POSITIVE` → derivado = valor del hecho de actividad
 * - polaridad `NEGATIVE` → derivado = negación del valor del hecho
 *
 * Quien llama no sabe la polaridad: la lee. Ése es el mecanismo que preserva
 * `AMB-LOG-02` sin hardcodear la inversión.
 *
 * ## Propagación de estados no determinables
 *
 * `CONTRADICTED` y los estados no determinables se propagan **sin invertir**:
 * negar «no lo sé» sigue siendo «no lo sé» (`UNKNOWN_IS_NOT_FALSE`).
 */

import type { EvidenceContext, Fact, NivelAcademico } from '../contracts';
import { activityFactForLevel } from './catalog';

/**
 * Identidad del extractor determinista del motor.
 *
 * Los hechos derivados no provienen de la IA ni de una persona: provienen de
 * esta función pura. Nombrarla permite que la traza distinga un hecho
 * derivado de uno extraído, sin adivinar por la forma del dato.
 */
export const ENGINE_EXTRACTOR_ID = 'rule-engine-v2:derive-facts';
export const ENGINE_EXTRACTOR_VERSION = 'policy-v2.0.0';

/** `factId` del derivado que significa «no hay actividad». */
export const SIN_ACTIVIDAD_NIVEL = 'F-sin-actividad-nivel';

/** `factId` del derivado que significa «hay actividad». */
export const CON_ACTIVIDAD_NIVEL = 'F-con-actividad-nivel';

/**
 * `factId` del derivado que expone el nivel como hecho evaluable.
 *
 * El nivel llega en `EvidenceContext.nivelAcademico`, no como hecho, porque es
 * parte del encuadre del caso y no una afirmación extraída de evidencia. Sin
 * este derivado, cualquier regla que discrimine por nivel quedaría
 * permanentemente en `UNKNOWN` — y una regla que nunca puede coincidir es
 * normativa muerta que nadie detecta.
 */
export const NIVEL_ACADEMICO = 'F-nivel-academico';

/** Niveles que el motor acepta, en orden canónico. */
export const NIVELES: readonly NivelAcademico[] = [
  'LICENCIATURA',
  'POSGRADO',
  'EJECUTIVA',
  'ALIANZA',
  'DIPLOMADO',
] as const;

/**
 * Deriva los hechos contextuales del caso.
 *
 * Puro: mismos hechos y mismo contexto ⇒ mismo arreglo derivado. No usa estado
 * mutable ni accede a `Date`.
 */
export function deriveFacts(
  facts: readonly Fact[],
  context: EvidenceContext,
): readonly Fact[] {
  const byId = new Map(facts.map((fact) => [fact.factId, fact]));

  // Un hecho ya provisto por el llamador gana: es evidencia explícita y el
  // `FactIndex` rechaza duplicados. Derivar encima no sería "sobrescribir", sería
  // fallar.
  const provided = (factId: string): boolean => byId.has(factId);
  const derived: Fact[] = [];

  if (context.nivelAcademico) {
    if (!provided(NIVEL_ACADEMICO)) {
      derived.push(levelFact(context.nivelAcademico, context));
    }
    derived.push(...deriveActivity(context.nivelAcademico, byId, context));
  }

  return derived;
}

/**
 * Expone el nivel del caso como hecho `KNOWN`.
 *
 * Si el llamador ya proveró el nivel como hecho, ese hecho gana: es evidencia
 * explícita y no debe ser sobreescrito por el encuadre.
 */
function levelFact(nivel: NivelAcademico, context: EvidenceContext): Fact {
  const detail = `Nivel académico del encuadre del caso: ${nivel}.`;
  return {
    factId: NIVEL_ACADEMICO,
    value: nivel,
    state: 'KNOWN',
    evidenceRefs: [],
    provenance: [
      {
        derivation: 'DERIVED',
        detail,
        extractionState: 'INFERRED',
        extractionMethod: 'DERIVED',
        extractorId: ENGINE_EXTRACTOR_ID,
        extractorVersion: ENGINE_EXTRACTOR_VERSION,
      },
    ],
    extractionMethod: 'DERIVED',
    relevantTimestamp: context.temporal.fechaSolicitud,
    notes: 'Derivado de EvidenceContext.nivelAcademico, no de evidencia.',
  };
}

/** Deriva los dos hechos de actividad normalizados del nivel. */
function deriveActivity(
  nivel: NivelAcademico,
  byId: ReadonlyMap<string, Fact>,
  context: EvidenceContext,
): readonly Fact[] {
  const definition = activityFactForLevel(nivel);
  const source = byId.get(definition.factId);

  // Sin el hecho de actividad del nivel no hay nada que invertir: los
  // derivados quedan UNKNOWN con explicación, nunca FALSE.
  if (!source) {
    const reason =
      `No se proveyó el hecho ${definition.factId} del nivel ${nivel}: ` +
      'no puede derivarse la actividad.';
    return [
      ...(byId.has(SIN_ACTIVIDAD_NIVEL) ? [] : [undetermined(SIN_ACTIVIDAD_NIVEL, reason, context)]),
      ...(byId.has(CON_ACTIVIDAD_NIVEL) ? [] : [undetermined(CON_ACTIVIDAD_NIVEL, reason, context)]),
    ];
  }

  if (source.state === 'CONTRADICTED') {
    const reason = `El hecho ${definition.factId} es CONTRADICTED.`;
    return [
      ...(byId.has(SIN_ACTIVIDAD_NIVEL) ? [] : [propagated(SIN_ACTIVIDAD_NIVEL, reason, context)]),
      ...(byId.has(CON_ACTIVIDAD_NIVEL) ? [] : [propagated(CON_ACTIVIDAD_NIVEL, reason, context)]),
    ];
  }

  if (source.state !== 'KNOWN') {
    const reason =
      `El hecho ${definition.factId} está en ${source.state}: ` +
      'la actividad no es determinable.';
    return [
      ...(byId.has(SIN_ACTIVIDAD_NIVEL) ? [] : [undetermined(SIN_ACTIVIDAD_NIVEL, reason, context)]),
      ...(byId.has(CON_ACTIVIDAD_NIVEL) ? [] : [undetermined(CON_ACTIVIDAD_NIVEL, reason, context)]),
    ];
  }

  const raw = source.value === true;
  // La polaridad se lee del catálogo; el evaluador no la conoce.
  const polarity = definition.activityPolarity ?? 'POSITIVE';
  const hayActividad = polarity === 'POSITIVE' ? raw : !raw;

  const detail =
    `Derivado de ${definition.factId} (polaridad ${polarity}, valor bruto ${raw}) ` +
    `para el nivel ${nivel}.`;

  return [
    ...(byId.has(SIN_ACTIVIDAD_NIVEL) ? [] : [known(SIN_ACTIVIDAD_NIVEL, !hayActividad, definition.factId, detail, context)]),
    ...(byId.has(CON_ACTIVIDAD_NIVEL) ? [] : [known(CON_ACTIVIDAD_NIVEL, hayActividad, definition.factId, detail, context)]),
  ];
}

/** Hecho derivado con valor `KNOWN`. */
function known(
  factId: string,
  value: boolean,
  fromFactId: string,
  detail: string,
  context: EvidenceContext,
): Fact {
  return {
    factId,
    value,
    state: 'KNOWN',
    evidenceRefs: [],
    provenance: [
      {
        factId: fromFactId,
        derivation: 'DERIVED',
        detail,
        extractionState: 'INFERRED',
        extractionMethod: 'DERIVED',
        extractorId: ENGINE_EXTRACTOR_ID,
        extractorVersion: ENGINE_EXTRACTOR_VERSION,
      },
    ],
    extractionMethod: 'DERIVED',
    relevantTimestamp: context.temporal.fechaSolicitud,
    notes:
      'Derivado por el motor. La polaridad la declara el catálogo, no el evaluador.',
  };
}

/** Hecho derivado no determinable, con la razón explícita. */
function undetermined(factId: string, reason: string, context: EvidenceContext): Fact {
  return {
    factId,
    value: null,
    state: 'UNKNOWN',
    evidenceRefs: [],
    provenance: [],
    extractionMethod: 'DERIVED',
    relevantTimestamp: context.temporal.fechaSolicitud,
    unknownReason: reason,
    notes: 'Derivado no determinable. UNKNOWN nunca se colapsa a FALSE.',
  };
}

/** Hecho derivado que propaga un `CONTRADICTED` sin invertirlo. */
function propagated(factId: string, reason: string, context: EvidenceContext): Fact {
  return {
    factId,
    value: null,
    state: 'CONTRADICTED',
    evidenceRefs: [],
    provenance: [],
    extractionMethod: 'DERIVED',
    relevantTimestamp: context.temporal.fechaSolicitud,
    notes: reason,
  };
}
