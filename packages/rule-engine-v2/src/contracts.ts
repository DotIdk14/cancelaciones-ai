/**
 * Rule Engine V2 — Contratos del núcleo puro.
 *
 * ## Qué es y qué no es
 *
 * Este archivo define **tipos**, no lógica. Toda la lógica normativa vive en
 * `rules/`, `nodes/`, `temporal.ts` y `ranking/`.
 *
 * La normativa se deriva exclusivamente de las 3 fuentes selladas en
 * `docs/policy-v2/source-lock.md`. El código legacy no es autoridad
 * (`LEGACY_IS_NOT_POLICY`) y ninguna regla de este paquete puede originarse en
 * él.
 *
 * ## Invariantes que el contrato hace expresivas
 *
 * - `FactState` mantiene `UNKNOWN`, `NOT_APPLICABLE` y `CONTRADICTED` como
 *   estados **distintos de `KNOWN`**. Ninguno se colapsa a `FALSE`
 *   (`UNKNOWN_IS_NOT_FALSE`).
 * - `NormativeStatus` y `NormativeOutcome` son campos separados. Un caso puede
 *   tener `closestOutcome` sin tener `normativeOutcome`, y eso es correcto.
 * - `PolicyConflict` se materializa **solo** si el camino de evaluación alcanza
 *   la regla en conflicto. Los conflictos no bloquean auditorías ajenas.
 */

// ---------------------------------------------------------------------------
// Identidad de la política
// ---------------------------------------------------------------------------

/** Código del documento normativo rector. */
export const POLICY_CODE = 'GDM_GAM_PRD_MLG_003' as const;

/** Versión del documento rector. */
export const POLICY_DOCUMENT_VERSION = '5' as const;

/**
 * Versión del modelo normativo compuesto (rector + 2 fuentes de apoyo).
 * Cambia cuando cambia el conjunto sellado, no cuando cambia el código.
 */
export const POLICY_VERSION = 'policy-v2.0.0' as const;

/** Versiones de política que este motor puede evaluar. */
export const SUPPORTED_POLICY_VERSIONS = [POLICY_VERSION] as const;

// ---------------------------------------------------------------------------
// Estados de hecho
// ---------------------------------------------------------------------------

/**
 * Estado epistémico de un hecho **ya evaluado** por el motor.
 *
 * Deliberadamente distinto de `FactState` de `@cancelaciones/domain`
 * (`OBSERVED | INFERRED | UNKNOWN | CONTRADICTORY`), que describe **cómo se
 * extrajo** el hecho. Estas dos taxonomías son ortogonales:
 *
 * - `domain.FactState`  → procedencia de la extracción (OBSERVED por IA, HUMAN…)
 * - `engine.FactState`   → si el motor puede sostener el valor (KNOWN, etc.)
 *
 * La extracción (`ExtractedFactV1.state`) se preserva en
 * `Fact.provenance[].extractionState`, de modo que ningún dato se pierde.
 */
export type FactState =
  /** El motor tiene un valor defendible para este hecho. */
  | 'KNOWN'
  /** Se buscó y no se pudo determinar. NO es `FALSE`. */
  | 'UNKNOWN'
  /** La norma excluye el caso: el hecho no aplica. NO es `FALSE`. */
  | 'NOT_APPLICABLE'
  /** Evidencia en conflicto interno. NO es `FALSE`. */
  | 'CONTRADICTED';

/** Estado de un hecho durante la extracción (procedencia, no evaluación). */
export type ExtractionState = 'OBSERVED' | 'INFERRED' | 'UNKNOWN' | 'CONTRADICTORY';

/** Método por el que se obtuvo el valor de un hecho. */
export type ExtractionMethod = 'DETERMINISTIC' | 'LLM' | 'HUMAN' | 'IMPORTED' | 'DERIVED';

// ---------------------------------------------------------------------------
// Evidencia
// ---------------------------------------------------------------------------

export type EvidenceKind =
  | 'PDF'
  | 'IMAGE'
  | 'AUDIO'
  | 'TEXT'
  | 'TICKET'
  | 'SIU'
  | 'ACADEMIC_RECORD'
  | 'WRITTEN_INTERACTION'
  | 'STUDENT_STATEMENT'
  | 'DATABASE'
  | 'OTHER';

/**
 * Referencia a evidencia del caso. La evidencia puede **acreditar hechos**;
 * nunca define política (`EVIDENCE_NEVER_DEFINES_POLICY`).
 */
export interface EvidenceRef {
  readonly evidenceId: string;
  readonly kind: EvidenceKind;
  /** Etiqueta legible. No debe contener PII: usar referencias o alias. */
  readonly label: string;
  readonly hash?: string;
  readonly capturedAt?: string;
}

// ---------------------------------------------------------------------------
// Hechos
// ---------------------------------------------------------------------------

/** Procedencia verificable de un hecho. */
export interface FactProvenance {
  /**
   * Hecho del que se derivó este valor, cuando `derivation === 'DERIVED'`.
   *
   * Conserva la cadena de derivación: sin este campo no se puede reconstruir
   * por qué el motor obtuvo el valor, y `TRACE_EVERY_DECISION` se rompería.
   */
  readonly factId?: string;
  readonly derivation?: 'EXTRACTED' | 'DERIVED';
  readonly detail?: string;
  readonly evidenceId?: string;
  readonly artifactId?: string;
  readonly artifactHash?: string;
  readonly page?: number;
  /** Estado de la extracción que originó el hecho. */
  readonly extractionState: ExtractionState;
  readonly extractionMethod: ExtractionMethod;
  readonly extractorId: string;
  readonly extractorVersion: string;
  /** Confianza de extracción 0..1. No es soporte normativo ni probabilidad de desenlace. */
  readonly extractionConfidence?: number;
  /** Texto fuente. Debe ir redactado si contiene PII. */
  readonly sourceText?: string;
}

/**
 * Hecho canónico de entrada al motor.
 *
 * Invariantes de construcción (validados en `facts/catalog.ts`):
 * - `state === 'KNOWN'` ⇒ `value !== null`
 * - `state !== 'KNOWN'` ⇒ `value === null`
 * - `state === 'UNKNOWN'` ⇒ `unknownReason` presente
 */
export interface Fact {
  readonly factId: string;
  readonly value: unknown;
  readonly state: FactState;
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly provenance: readonly FactProvenance[];
  readonly extractionMethod: ExtractionMethod;
  /** Fecha ISO `YYYY-MM-DD` relevante para el hecho, si existe. */
  readonly relevantTimestamp: string | null;
  readonly unknownReason?: string;
  readonly notes?: string;
}

/** Constructor acotado para un hecho `KNOWN`. */
export function knownFact(
  factId: string,
  value: unknown,
  options: {
    evidenceRefs?: readonly EvidenceRef[];
    provenance?: readonly FactProvenance[];
    extractionMethod?: ExtractionMethod;
    relevantTimestamp?: string | null;
    notes?: string;
  } = {},
): Fact {
  return {
    factId,
    value,
    state: 'KNOWN',
    evidenceRefs: options.evidenceRefs ?? [],
    provenance: options.provenance ?? [],
    extractionMethod: options.extractionMethod ?? 'IMPORTED',
    relevantTimestamp: options.relevantTimestamp ?? null,
    ...(options.notes === undefined ? {} : { notes: options.notes }),
  };
}

/** Constructor acotado para un hecho `UNKNOWN`. Nunca `FALSE`. */
export function unknownFact(
  factId: string,
  unknownReason: string,
  options: {
    evidenceRefs?: readonly EvidenceRef[];
    provenance?: readonly FactProvenance[];
    extractionMethod?: ExtractionMethod;
    relevantTimestamp?: string | null;
  } = {},
): Fact {
  return {
    factId,
    value: null,
    state: 'UNKNOWN',
    evidenceRefs: options.evidenceRefs ?? [],
    provenance: options.provenance ?? [],
    extractionMethod: options.extractionMethod ?? 'IMPORTED',
    relevantTimestamp: options.relevantTimestamp ?? null,
    unknownReason,
  };
}

/** Constructor acotado para un hecho `NOT_APPLICABLE`. Nunca `FALSE`. */
export function notApplicableFact(
  factId: string,
  notes: string,
  options: { provenance?: readonly FactProvenance[]; extractionMethod?: ExtractionMethod } = {},
): Fact {
  return {
    factId,
    value: null,
    state: 'NOT_APPLICABLE',
    evidenceRefs: [],
    provenance: options.provenance ?? [],
    extractionMethod: options.extractionMethod ?? 'DETERMINISTIC',
    relevantTimestamp: null,
    notes,
  };
}

/** Constructor acotado para un hecho `CONTRADICTED`. Nunca `FALSE`. */
export function contradictedFact(
  factId: string,
  options: {
    evidenceRefs?: readonly EvidenceRef[];
    provenance?: readonly FactProvenance[];
    extractionMethod?: ExtractionMethod;
    relevantTimestamp?: string | null;
    notes?: string;
  } = {},
): Fact {
  return {
    factId,
    value: null,
    state: 'CONTRADICTED',
    evidenceRefs: options.evidenceRefs ?? [],
    provenance: options.provenance ?? [],
    extractionMethod: options.extractionMethod ?? 'IMPORTED',
    relevantTimestamp: options.relevantTimestamp ?? null,
    ...(options.notes === undefined ? {} : { notes: options.notes }),
  };
}

// ---------------------------------------------------------------------------
// Trazabilidad de fuente
// ---------------------------------------------------------------------------

/** Identificador del documento sellado en `source-lock.md`. */
export type SourceLockId = 'SOURCE-01' | 'SOURCE-02' | 'SOURCE-03';

/**
 * Referencia a un enunciado normativo concreto: documento, página, sección e
 * identificador de enunciado (`N-xx`, `G-xx`, `D53-xx`).
 */
export interface SourceRef {
  readonly sourceLockId: SourceLockId;
  readonly documentCode: string;
  readonly documentVersion: string;
  /** SHA-256 del archivo sellado. Vincula la regla al binario exacto. */
  readonly sha256: string;
  readonly page: number;
  readonly section: string;
  /** Identificador del enunciado en el inventario normativo. */
  readonly statementId: string;
}

// ---------------------------------------------------------------------------
// Niveles y categorías
// ---------------------------------------------------------------------------

/**
 * Nivel académico. Determina la **polaridad** de los hechos de actividad.
 *
 * `AMB-LOG-02` / Phase 1.5 §17.1: cuatro niveles usan la misma estructura
 * sintáctica con polaridad opuesta. El nivel es parte de la *definición* del
 * hecho, nunca del `if` del evaluador.
 */
export type NivelAcademico = 'LICENCIATURA' | 'POSGRADO' | 'EJECUTIVA' | 'ALIANZA' | 'DIPLOMADO';

/** Polaridad de un hecho de actividad, declarada por la fuente. */
export type ActivityPolarity = 'POSITIVE' | 'NEGATIVE';

/** Campus del alumno. `G-20` (p.24) prueba que existe diferenciación. */
export type Campus = 'MEXICO' | 'LATAM';

/** Tipo de ingreso según `G-22` (p.28). NO es lo mismo que estatus regular. */
export type TipoIngreso = 'REGULAR' | 'DICTAMEN_TECNICO' | 'REINGRESO' | 'EQUIVALENCIA' | 'REVALIDACION';

// ---------------------------------------------------------------------------
// Desenlaces
// ---------------------------------------------------------------------------

/**
 * Desenlaces terminales **derivados de la fuente** (decision-tree §0).
 *
 * Deliberadamente NO es el contrato de desenlaces legacy. `NON_LICENCIATURA`,
 * `CANCELACION_MATRICULA` como valor único y otros valores del motor retirado no
 * se restauran.
 */
export type Outcome =
  | 'CANCELACION_VENTA'
  | 'BAJA'
  | 'CANCELACION_VENTA_OPERATIVA'
  | 'CANCELACION_MATRICULA'
  | 'RETENCION'
  | 'DICTAMINACION';

/** Los 6 desenlaces, en orden estable y determinista. */
export const OUTCOMES: readonly Outcome[] = [
  'CANCELACION_VENTA',
  'BAJA',
  'CANCELACION_VENTA_OPERATIVA',
  'CANCELACION_MATRICULA',
  'RETENCION',
  'DICTAMINACION',
] as const;

// ---------------------------------------------------------------------------
// Contexto temporal
// ---------------------------------------------------------------------------

/**
 * Contexto temporal determinista. **No contiene `Date.now()`**: el evaluador
 * es puro y reproducible, el tiempo lo fija el llamador.
 */
export interface TemporalContext {
  /** Inicio del ciclo académico. Ancla de casi todas las ventanas. */
  readonly cicloFechaInicio: string | null;
  /** Fecha de la solicitud del alumno. Base de `N-15`, `N-35`. */
  readonly fechaSolicitud: string | null;
  /** Fecha de ingestión de D53. Base de `D53-06`. */
  readonly fechaIngreso: string | null;
  /** Inicio del primer ciclo académico. Base de `G-08` (XDC-03). */
  readonly inicioPrimerCiclo: string | null;
  /** Avance curricular en porcentaje entero 0..100. Base de `D53-04`/`D53-05`. */
  readonly avanceCurricularPercent: number | null;
}

// ---------------------------------------------------------------------------
// Contexto de entrada
// ---------------------------------------------------------------------------

/** Contexto del caso más allá de los hechos. */
export interface EvidenceContext {
  readonly evidences: readonly EvidenceRef[];
  readonly temporal: TemporalContext;
  readonly nivelAcademico: NivelAcademico | null;
  readonly campus: Campus | null;
}

/** Entrada de `evaluateAudit`. */
export interface EvaluateAuditInput {
  readonly facts: readonly Fact[];
  readonly evidenceContext: EvidenceContext;
  readonly policyVersion: string;
}

// ---------------------------------------------------------------------------
// Estado normativo y resultado
// ---------------------------------------------------------------------------

/**
 * Estado normativo del caso.
 *
 * - `DETERMINATE` — la fuente cierra el caso; `normativeOutcome` es obligatorio.
 * - `INSUFFICIENT_EVIDENCE` — la política es clara pero faltan hechos.
 * - `REQUIRES_HUMAN_REVIEW` — el caso alcanza un conflicto normativo no resuelto.
 */
export type NormativeStatus = 'DETERMINATE' | 'INSUFFICIENT_EVIDENCE' | 'REQUIRES_HUMAN_REVIEW';

/** Requisito de evidencia no satisfecho. */
export interface FactRequirement {
  readonly requirementId: string;
  readonly factId: string;
  readonly name: string;
  readonly description: string;
  /** Reglas que requieren este hecho. */
  readonly requiredForRuleIds: readonly string[];
  /**
   * Tipos de evidencia que podrían acreditarlo.
   *
   * Vacío **sólo** cuando `normativeInvariant` es `true`: hay hechos que la
   * fuente no acredita con evidencia sino que fija como invariante de
   * interpretación (D53-08, p.3). Confundir «no acreditable con evidencia» con
   * «faltó rellenar el catálogo» haría que un consumidor pidiera documentos
   * imposibles de conseguir.
   */
  readonly satisfiableBy: readonly EvidenceKind[];
  /** `true` si es un invariante normativo y no un hecho a acreditar. */
  readonly normativeInvariant?: boolean;
  /** Por qué la ausencia de este dato cambia el resultado. */
  readonly whyItMatters: string;
  readonly sourceRefs: readonly SourceRef[];
}

/** Una lectura incompatible de la norma, con su consecuencia. */
export interface Interpretation {
  readonly reading: string;
  readonly sourceRef: SourceRef;
  /** Desenlace que produciría esta lectura, si se adoptara. */
  readonly resultingOutcome: Outcome | null;
}

export type PolicyConflictKind =
  | 'CROSS_DOCUMENT_CONFLICT'
  | 'OWNER_DECISION_REQUIRED'
  | 'UNAVAILABLE_SOURCE';

/**
 * Conflicto normativo explícito.
 *
 * Solo se materializa si el camino de evaluación alcanza la(s) regla(s)
 * afectada(s). Un conflicto en una rama no visitada no aparece.
 */
export interface PolicyConflict {
  readonly conflictId: string;
  readonly kind: PolicyConflictKind;
  readonly title: string;
  readonly affectedRuleIds: readonly string[];
  readonly sourceRefs: readonly SourceRef[];
  /** Todas las lecturas se preservan. Ninguna se descarta por plausibilidad. */
  readonly conflictingInterpretations: readonly Interpretation[];
  readonly candidateOutcomes: readonly Outcome[];
  readonly explanation: string;
  /** Un conflicto nunca se resuelve automáticamente. */
  readonly status: 'REQUIRES_HUMAN_REVIEW';
}

/** Evaluación provisional que sustenta el `closestOutcome`. */
export interface ProvisionalAssessment {
  readonly supportingEvidence: readonly EvidenceRef[];
  readonly conflictingEvidence: readonly EvidenceRef[];
  readonly supportingRuleIds: readonly string[];
  readonly unresolvedFactors: readonly string[];
  readonly explanation: string;
  /** Conflicto(s) que impiden el cierre normativo. */
  readonly blockingConflictIds: readonly string[];
}

/**
 * Regla que propone un desenlace pero no tiene autoridad para fundar el desenlace
 * final de la auditoría.
 *
 * ## Por qué existe este tipo
 *
 * `AUXILIARY_SOURCE_CANNOT_DEFINE_TOP_LEVEL_OUTCOME`. D53 y el glosario pueden
 * aportar hechos, plazos y vocabulario, y sus reglas pueden *calificar*: lo que
 * no pueden es cerrar un caso de deserción, porque el desenlace final pertenece
 * a la estructura de decisión de `GDM_GAM_PRD_MLG_003`.
 *
 * En el registro actual son cuatro reglas de D53, cuyas ambigüedades asociadas
 * (`XDC-02`, `XDC-03`, `XDC-04`, `XDC-05`, `AMB-TEM-07`, `AMB-CON-02`) siguen sin
 * respuesta del Owner. El motor no las borra ni contesta por el Owner: las
 * representa, las traza, las escala y sigue ofreciendo al auditor un desenlace
 * provisional concreto.
 */
export interface ProvisionalOnlyRule {
  readonly ruleId: string;
  /** Desenlace propuesto por la regla. Pertenece al catálogo de desenlaces. */
  readonly outcome: string;
  /**
   * Ambigüedades del Owner cuya respuesta haría autoritativa la regla.
   *
   * Estructurado a propósito: la UI necesita decir *qué* espera revisar, no
   * parsear un texto para extraer un identificador.
   */
  readonly awaitsAmbiguityIds: readonly string[];
  /** Citas auxiliares que sí respaldan la proposición. */
  readonly sourceRefs: readonly {
    readonly sourceLockId: string;
    readonly statementId: string;
  }[];
}

/**
 * Rastro de ranking por desenlace candidato.
 *
 * `supportScore` es un **conteo entero** de reglas de apoyo menos reglas que
 * bloquean. No es una probabilidad y no se renderiza como porcentaje
 * (`NO_FAKE_PROBABILITIES`).
 */
export interface CandidateOutcomeTrace {
  readonly outcome: Outcome;
  readonly rank: number;
  readonly supportScore: number;
  readonly supportingRuleIds: readonly string[];
  readonly supportingFactIds: readonly string[];
  readonly blockingRuleIds: readonly string[];
  readonly contradictoryFactIds: readonly string[];
  readonly unresolvedFactIds: readonly string[];
  readonly conflictIds: readonly string[];
  /** Explicación legible de por qué este candidato obtuvo su posición. */
  readonly rationale: string;
}

// ---------------------------------------------------------------------------
// Traza
// ---------------------------------------------------------------------------

export type TraceStepKind =
  | 'EVIDENCE'
  | 'FACT'
  | 'RULE'
  | 'NODE'
  | 'BRANCH'
  | 'CANDIDATE'
  | 'CONFLICT'
  | 'MISSING_FACT'
  | 'STATUS'
  | 'SHORT_CIRCUIT'
  /**
   * Decisión de autoridad: si una regla que propone desenlace puede fijarlo
   * normativamente o sólo lo propone. Es la decisión que separa lo
   * normativo de lo provisional, y por eso tiene paso propio: sin él, un
   * `closestOutcome` aparecería sin explicación de por qué no llegó a ser
   * `normativeOutcome`.
   */
  | 'AUTHORITY'
  /** Resumen de las reglas provisional-only alcanzadas y lo que falta por cerrar. */
  | 'PROVISIONAL_ONLY'
  | 'RESULT';

/** Un paso de la traza. La traza completa es la explicación del resultado. */
export interface TraceEntry {
  readonly step: number;
  readonly kind: TraceStepKind;
  /** Identificador del objeto evaluado (regla, nodo, hecho, desenlace). */
  readonly ref: string;
  readonly detail: string;
  readonly factId?: string;
  readonly ruleId?: string;
  readonly sourceRefs?: readonly SourceRef[];
  readonly value?: unknown;
}

/**
 * Registro del cortocircuito de prevalencia.
 *
 * ## Por qué existe como campo propio
 *
 * Un cortocircuito hace que reglas **no se evalúen**. Una traza que sólo listara
 * lo evaluado dejaría al revisor sin forma de saber que hubo un camino entero
 * que la fuente cerró por anticipado: parecería que la baja salió de un
 * razonamiento causal cuando en realidad vino de un filtro de raíz. Este campo
 * dice qué regla cortó, qué desenlaces excluyó y qué nodos quedaron sin
 * recorrer.
 */
export interface ShortCircuitTrace {
  /** Filtro de prevalencia que declaró la exclusión. */
  readonly ruleId: string;
  readonly nodeId: string;
  /** Categorías de desenlace que la fuente excluye. */
  readonly excludedOutcomes: readonly Outcome[];
  /** Nodos del árbol que no se recorrieron por el cortocircuito. */
  readonly skippedNodes: readonly string[];
  readonly sourceRefs: readonly SourceRef[];
  readonly reason: string;
}

export interface DecisionTrace {
  readonly entries: readonly TraceEntry[];
  /** Huella determinista de la traza. Cambia si cambia cualquier paso. */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

/** Modelo de resultado completo del motor. */
export interface AuditEvaluation {
  readonly policyVersion: string;
  readonly rulesFingerprint: string;

  readonly normativeStatus: NormativeStatus;

  /**
   * Resultado NORMATIVO. Presente **solo** si `normativeStatus ===
   * 'DETERMINATE'`. Nunca se rellena con un resultado provisional.
   */
  readonly normativeOutcome: Outcome | null;

  /**
   * Resultado MÁS COMPATIBLE con la evidencia disponible.
   *
   * Puede existir con `normativeStatus` `INSUFFICIENT_EVIDENCE` o
   * `REQUIRES_HUMAN_REVIEW`. **No es** un resultado normativo: la UI y los
   * reportes deben etiquetarlo como provisional. `null` cuando el soporte no
   * favorece claramente ningún desenlace (nunca forzado).
   */
  readonly closestOutcome: Outcome | null;

  /** Desenlaces alternativos aún posibles, en orden de ranking. */
  readonly alternativeOutcomes: readonly Outcome[];

  /** Sólo existe cuando hay `closestOutcome`. */
  readonly provisionalAssessment: ProvisionalAssessment | null;

  readonly missingFacts: readonly FactRequirement[];

  readonly policyConflicts: readonly PolicyConflict[];

  /** Ranking completo: por qué se eligió o no se eligió el `closestOutcome`. */
  readonly candidateTrace: readonly CandidateOutcomeTrace[];

  /**
   * Reglas que calificaron y **no** pueden fundamentar un desenlace normativo.
   *
   * Vacío cuando todo lo que coincidió tiene grounding en
   * `GDM_GAM_PRD_MLG_003`. Cuando no está vacío, la evaluación está en
   * `REQUIRES_HUMAN_REVIEW` con `normativeOutcome: null`, pero `closestOutcome`
   * sigue poblado: la fuente auxiliar aportó la respuesta, sólo no tiene
   * autoridad para confirmarla.
   *
   * Es el puente entre el motor y la UI: permite decir «falta la decisión sobre
   * XDC-02» en vez de un «se requiere revisión» sin contenido.
   */
  readonly provisionalOnly: readonly ProvisionalOnlyRule[];

  readonly trace: DecisionTrace;

  /**
   * Cortocircuito de prevalencia aplicado, si lo hubo. `null` cuando se
   * recorrió el árbol completo.
   */
  readonly shortCircuit: ShortCircuitTrace | null;

  /** Fuentes normativas tocadas por esta evaluación. */
  readonly sourceRefs: readonly SourceRef[];
}
