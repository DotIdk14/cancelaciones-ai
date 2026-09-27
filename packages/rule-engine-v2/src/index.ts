/**
 * Rule Engine V2 — superficie pública del paquete.
 *
 * ## Reglas de consumo
 *
 * 1. La única entrada es `evaluateAudit`. Todo lo demás es apoyo tipado para consumidores.
 * 2. El motor es **puro**: no lee reloj, red, disco ni base de datos. El
 *    llamador fija el contexto temporal.
 * 3. `normativeOutcome` y `closestOutcome` son campos distintos. Un consumidor
 *    que los mezcle estáIntroduciendo un resultado provisional como si fuera
 *    normativo.
 * 4. Toda evaluación devuelve `trace` con al menos un paso por regla evaluada
 *    y `rulesFingerprint` para detectar deriva del registro de reglas.
 */

// Contratos y estado
export type {
  ActivityPolarity,
  AuditEvaluation,
  Campus,
  CandidateOutcomeTrace,
  DecisionTrace,
  EvaluateAuditInput,
  EvidenceContext,
  EvidenceKind,
  EvidenceRef,
  ExtractionMethod,
  ExtractionState,
  Fact,
  FactProvenance,
  FactRequirement,
  FactState,
  Interpretation,
  NormativeStatus,
  Outcome,
  PolicyConflict,
  PolicyConflictKind,
  ProvisionalAssessment,
  ProvisionalOnlyRule,
  ShortCircuitTrace,
  SourceLockId,
  SourceRef,
  TemporalContext,
  TraceEntry,
  TraceStepKind,
  TipoIngreso,
  NivelAcademico,
} from './contracts';
export {
  contradictedFact,
  knownFact,
  notApplicableFact,
  OUTCOMES,
  POLICY_CODE,
  POLICY_DOCUMENT_VERSION,
  POLICY_VERSION,
  SUPPORTED_POLICY_VERSIONS,
  unknownFact,
} from './contracts';

// Fuentes selladas
export {
  d53,
  glossary,
  isPrimaryNormativeSource,
  primary,
  SOURCES,
  SOURCE_01,
  SOURCE_02,
  SOURCE_03,
  sourceById,
  type SourceRole,
} from './sources';

// Condiciones
export { all, any, equals, fact as hasFact, isIn, not, when } from './conditions';
export { evaluateCondition, FactIndex, foldAnd, foldOr, isBlocking, isMatch } from './conditions';
export type { ConditionValue } from './conditions';

// Temporales
export * as temporal from './temporal';

// Hechos
export { FACT_DEFINITIONS, activityFactForLevel, allFactIds, factDefinition, isKnownFact } from './facts/catalog';
export { CON_ACTIVIDAD_NIVEL, deriveFacts, SIN_ACTIVIDAD_NIVEL } from './facts/derive';

// Adquisición canónica de hechos
export {
  ACQUISITION_CATEGORIES,
  LEGACY_MAPPING_CLASSIFICATIONS,
} from './acquisition/types';
export type {
  AcquisitionCategory,
  CanonicalFactAcquisitionEntry,
  CanonicalFactCandidate,
  LegacyMappingClassification,
} from './acquisition/types';
export { buildCanonicalFactAcquisitionMatrix } from './acquisition/matrix';
export { candidateToFact, validateCanonicalFactCandidate } from './acquisition/validate';
export type { ValidatedCanonicalFactCandidate } from './acquisition/validate';
export { mergeCanonicalFacts } from './acquisition/merge';
export { buildCanonicalEvaluateAuditInput, validateTemporalContext } from './acquisition/context';
export type { BuildCanonicalEvaluateAuditInputParams } from './acquisition/context';
export { relevantMissingFactsForEvaluation } from './acquisition/relevant-missing';
export type { RelevantMissingFact } from './acquisition/relevant-missing';

// Reglas y nodos
export { RULES, ruleById, rulesForNode } from './rules/policy';
export type { DecisionTarget, Rule, RuleKind } from './rules/types';
export { NODES, NODE_ORDER, ENTRY_NODES, RULE_INDEX, blockersOf, nodeRules } from './nodes/graph';
export type { DecisionNode, NodeId } from './nodes/graph';

// Conflictos
export { allConflicts, allConflictsForReachedRules, conflictById, internalConflict } from './conflicts/xdc';
export {
  isNormativeAuthority,
  pendingAmbiguityIds,
  provisionalOnlyRules,
} from './rules/authority';

// Evaluador
export { evaluateAudit } from './evaluator/evaluate-audit';
export { rulesFingerprint, stableHash } from './evaluator/fingerprint';
export { computeDeclaredPrecedence, outcomeOfRule, survivingOutcomes } from './evaluator/precedence';
export type { DeclaredPrecedence } from './evaluator/precedence';
export type { RuleApplication } from './evaluator/application';
