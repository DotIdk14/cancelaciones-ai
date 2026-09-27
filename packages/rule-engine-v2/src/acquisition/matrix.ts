import type { FactDefinition } from '../facts/catalog';
import { FACT_DEFINITIONS } from '../facts/catalog';
import type { AcquisitionCategory, CanonicalFactAcquisitionEntry } from './types';

const DERIVED_FACT_IDS = new Set([
  'F-nivel-academico',
  'F-sin-actividad-nivel',
  'F-con-actividad-nivel',
]);

const AUDIT_METADATA_PATTERNS = [
  /ciclo/i,
  /campus/i,
  /nivel/i,
  /tipo[_-]?ingreso/i,
];

const TEMPORAL_PATTERNS = [
  /fecha/i,
  /periodo/i,
  /plazo/i,
  /d[ií]a/i,
  /mes/i,
  /bimestre/i,
  /inicio/i,
  /ingreso/i,
];

export function buildCanonicalFactAcquisitionMatrix(): readonly CanonicalFactAcquisitionEntry[] {
  return FACT_DEFINITIONS.map(toEntry).sort((a, b) => a.factId.localeCompare(b.factId));
}

function toEntry(definition: FactDefinition): CanonicalFactAcquisitionEntry {
  const acquisitionCategory = classify(definition);
  const deterministicValidationPossible = canValidateDeterministically(definition);
  const aiExtractionPermitted = canUseAi(definition, acquisitionCategory);

  return {
    factId: definition.factId,
    name: definition.name,
    meaning: definition.description,
    dataType: definition.dataType,
    expectedValueState: expectedValueState(definition),
    sourceRuleIds: definition.requiredBy,
    possibleEvidenceSources: definition.satisfiableBy,
    extractionStrategy: extractionStrategy(definition, acquisitionCategory),
    derivationStrategy: derivationStrategy(definition, acquisitionCategory),
    aiExtractionPermitted,
    deterministicValidationPossible,
    criticalToDecisionBranch: definition.requiredBy.length > 0,
    provenanceRequirements: provenanceRequirements(definition, acquisitionCategory),
    acquisitionCategory,
    normativeInvariant: definition.normativeInvariant ?? false,
    undeclaredThreshold: definition.undeclaredThreshold ?? false,
    sourceRefs: definition.sourceRefs,
  };
}

function classify(definition: FactDefinition): AcquisitionCategory {
  if (definition.normativeInvariant) return 'AUXILIARY_REFERENCE';
  if (DERIVED_FACT_IDS.has(definition.factId)) return 'DERIVED';
  if (definition.undeclaredThreshold) return 'OWNER_MAPPING_REQUIRED';
  if (definition.dataType === 'DATE' || matchesAny(definition, TEMPORAL_PATTERNS)) {
    return 'TEMPORAL_DERIVATION';
  }
  if (matchesAny(definition, AUDIT_METADATA_PATTERNS)) return 'AUDIT_METADATA';
  if (definition.satisfiableBy.length > 0) return 'DIRECT_EXTRACTION';
  return 'NOT_CURRENTLY_ACQUIRABLE';
}

function matchesAny(definition: FactDefinition, patterns: readonly RegExp[]): boolean {
  const haystack = `${definition.factId} ${definition.name} ${definition.description}`;
  return patterns.some((pattern) => pattern.test(haystack));
}

function canValidateDeterministically(definition: FactDefinition): boolean {
  if (definition.dataType === 'BOOLEAN') return true;
  if (definition.dataType === 'DATE') return true;
  if (definition.dataType === 'NUMBER') return true;
  return Array.isArray(definition.domain) && definition.domain.length > 0;
}

function canUseAi(
  definition: FactDefinition,
  category: AcquisitionCategory,
): boolean {
  if (definition.normativeInvariant) return false;
  if (category === 'DERIVED') return false;
  if (category === 'AUDIT_METADATA') return false;
  if (category === 'TEMPORAL_DERIVATION') return false;
  return definition.satisfiableBy.some((kind) => kind === 'PDF' || kind === 'IMAGE' || kind === 'AUDIO' || kind === 'TEXT' || kind === 'WRITTEN_INTERACTION' || kind === 'STUDENT_STATEMENT');
}

function expectedValueState(definition: FactDefinition): string {
  const state = 'KNOWN si una evidencia o derivación defendible sostiene el valor; UNKNOWN si se buscó y no se pudo determinar; CONTRADICTED si evidencia equivalente discrepa; NOT_APPLICABLE sólo cuando la norma excluye el caso.';
  if (definition.domain?.length) return `${state} Dominio permitido: ${definition.domain.join(', ')}.`;
  return `${state} Tipo esperado: ${definition.dataType}.`;
}

function extractionStrategy(
  definition: FactDefinition,
  category: AcquisitionCategory,
): string {
  switch (category) {
    case 'DIRECT_EXTRACTION':
      return `Extraer de evidencia ${definition.satisfiableBy.join(', ')} y validar contra tipo ${definition.dataType}.`;
    case 'DERIVED':
      return 'No se extrae directamente: se deriva de hechos/contexto canónico ya aceptado.';
    case 'AUDIT_METADATA':
      return 'Leer del metadata de auditoría o prellenar desde evidencia si aparece en documentos.';
    case 'TEMPORAL_DERIVATION':
      return 'Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema.';
    case 'AUXILIARY_REFERENCE':
      return 'No pedir al usuario: es referencia/invariante normativo declarado por fuente auxiliar.';
    case 'OWNER_MAPPING_REQUIRED':
      return 'No automatizar como verdad hasta que el Owner defina el umbral o equivalencia semántica.';
    case 'NOT_CURRENTLY_ACQUIRABLE':
      return 'No hay estrategia segura con el catálogo actual; documentar como limitación.';
  }
}

function derivationStrategy(
  definition: FactDefinition,
  category: AcquisitionCategory,
): string | null {
  if (category === 'DERIVED') return 'Usar derivaciones puras del motor, preservando UNKNOWN y CONTRADICTED.';
  if (category === 'TEMPORAL_DERIVATION') return 'Calcular ventanas/plazos desde TemporalContext con fechas ISO validadas.';
  if (definition.undeclaredThreshold) return 'Requiere decisión del Owner antes de derivar un estado KNOWN.';
  return null;
}

function provenanceRequirements(
  definition: FactDefinition,
  category: AcquisitionCategory,
): string {
  if (category === 'AUXILIARY_REFERENCE') {
    return 'Cita de fuente sellada y regla que consume el invariante; no evidencia de caso.';
  }
  if (category === 'DERIVED') {
    return 'FactProvenance con derivation=DERIVED y factId fuente; extractorId/version determinista.';
  }
  if (category === 'AUDIT_METADATA' || category === 'TEMPORAL_DERIVATION') {
    return 'Origen del metadata o evidencia que prellenó la fecha/campo, con timestamp normativo reconstruible.';
  }
  return 'EvidenceRef, artifact hash, extractorId/version, método de extracción, texto fuente redactado y ubicación cuando exista.';
}
