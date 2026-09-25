import type { StoredFact } from '@cancelaciones/db';
import type { Fact } from '@cancelaciones/policy-engine';
import type { JobArtifact } from '@cancelaciones/db';
import { POLICY_FACT_INVENTORY } from '@cancelaciones/policy-engine';

/** Extrae texto observable de un artifact JobArtifact usando extractedFacts o texto. */
function extractObservedTextFromArtifact(artifact: { result: unknown }, factType: string): string | null {
  const result = artifact.result;
  if (!result) return null;

  // Usar extractedFacts si están disponibles
  if (typeof result === 'object' && result !== null && 'extractedFacts' in result) {
    const facts = result as { extractedFacts?: Array<{ factType?: string; value?: unknown }> };
    if (facts.extractedFacts && Array.isArray(facts.extractedFacts)) {
      for (const ext of facts.extractedFacts) {
        if (ext.factType === factType && ext.value !== undefined) {
          const v = String(ext.value);
          return v.length > 200 ? v.substring(0, 200) + '...' : v;
        }
      }
    }
  }

  // Fallback: buscar en el texto textual
  let text = '';
  if (typeof result === 'string') {
    text = result;
  } else if (typeof result === 'object' && result !== null) {
    const r = result as { text?: string; transcript?: string };
    text = r.text ?? r.transcript ?? '';
  }
  text = String(text);
  if (!text) return null;

  // Buscar patrones relevantes por fact_type
  switch (factType) {
    case 'student.name': {
      const nm = text.match(/(?:NOMBRE|ESTUDIANTE)\s*[:=-]\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .'-]{3,})/i);
      return nm ? nm[0] : null;
    }
    case 'student.level': {
      const lv = text.match(/NIVEL\s*[:=-]\s*(LICENCIATURA|POSGRADO|BACHILLERATO)/i);
      return lv ? lv[0] : null;
    }
    case 'contact.effectiveContact': {
      const ct = text.toLowerCase();
      if (/contacto\s+efectiv/.test(ct)) return 'Contacto efectivo detectado';
      if (/no\s+contacto\s+efectiv|sin\s+contacto\s+efectiv|sin\s+contacto\s+efectivo/.test(ct)) return 'Sin contacto efectivo';
      return null;
    }
    case 'classroom.hasActivities': {
      const ha = text.toLowerCase();
      if (/con\s+actividad/.test(ha)) return 'Presencia de actividades';
      if (/sin\s+actividad|no hay actividad/.test(ha)) return 'Sin actividades registradas';
      return null;
    }
    case 'classroom.hasGrades': {
      const hg = text.toLowerCase();
      if (/calificaciones?\s+en\s+el\s+bimestre/.test(hg) || /califications?\s+in\s+the\s+bimester/.test(hg)) return 'Calificaciones en bimestre inicial';
      if (/no\s+calificaciones|sin\s+calificaciones/.test(hg)) return 'Sin calificaciones en bimestre inicial';
      return null;
    }
    default: return null;
  }
}

/** FactCandidate: resultado del Evidence Interpreter. */
export interface FactCandidate {
  factType: string;
  value: unknown;
  confidence: number;
  evidenceRefs: { evidenceId: string; artifactId?: string; page?: number }[];
  artifactRefs: { artifactId: string; sha256: string; page?: number }[];
  extractionMethod: 'deterministic' | 'artifact_fallback' | 'regex';
  observedText: string;
  occurredAt?: string;
  warnings: string[];
}

/** Resultado del Evidence Interpreter IA. */
export interface EvidenceInterpreterResult {
  candidates: FactCandidate[];
  fallbacks: Array<{ factType: string; reason: string; artifactId: string }>;
  coverage: Record<string, number>;
  warnings: string[];
}

/** Evidence Interpreter IA: interpreta job_artifacts raw y produce FactCandidate. */
export async function runEvidenceInterpreter(input: {
  auditId: string;
  artifacts: JobArtifact[];
  storedFacts?: StoredFact[];
  complete?: () => Promise<{ content: string; provider: string; model: string }>;
}): Promise<EvidenceInterpreterResult> {
  const { artifacts, storedFacts } = input;
  const candidates: FactCandidate[] = [];
  const fallbacks: Array<{ factType: string; reason: string; artifactId: string }> = [];
  const warnings: string[] = [];
  const coverage: Record<string, number> = {};

  // 1. Intento determinista desde storedFacts
  if (storedFacts && storedFacts.length > 0) {
    for (const fact of storedFacts) {
      if (!fact.factType) continue;
      coverage[fact.factType] = (coverage[fact.factType] ?? 0) + 1;

      let obsText = '';
      if (fact.value !== null && fact.value !== undefined) {
        obsText = typeof fact.value === 'string' ? fact.value : String(fact.value);
        if (obsText.length > 200) obsText = obsText.substring(0, 200) + '...';
      }

      candidates.push({
        factType: fact.factType,
        value: fact.value,
        confidence: fact.confidence ?? 0.5,
        evidenceRefs: fact.sourceRef.evidenceId ? [{ evidenceId: String(fact.sourceRef.evidenceId) }] : [],
        artifactRefs: [],
        extractionMethod: 'deterministic',
        observedText: obsText,
        warnings: [],
      });
    }
  }

  // 2. Extraer candidatos de artifacts raw
  if (artifacts && artifacts.length > 0) {
    const artifactMap = new Map<string, JobArtifact>();
    for (const artifact of artifacts) artifactMap.set(artifact.id, artifact);

    const neededFactTypes = POLICY_FACT_INVENTORY.filter(
      type => !candidates.some(c => c.factType === type)
    );

    for (const factType of neededFactTypes) {
      let foundInArtifact = false;
      for (const [artId, artifact] of artifactMap) {
        const observed = extractObservedTextFromArtifact(artifact, factType);
        if (observed) {
          foundInArtifact = true;

          let confidence = 0.7;
          if (artifact.result && typeof artifact.result === 'object') {
            const r = artifact.result as Record<string, unknown>;
            if (r.confidence !== undefined) confidence = Number(r.confidence);
          }

          const sha256 = artifact.contentSha256 ?? '';
          const evidenceId = artifact.evidenceId ?? `artifact_${artId}`;

          candidates.push({
            factType,
            value: observed,
            confidence,
            evidenceRefs: [{ evidenceId, artifactId: artId }],
            artifactRefs: [{ artifactId: artId, sha256 }],
            extractionMethod: 'artifact_fallback',
            observedText: observed,
            warnings: [],
          });
          fallbacks.push({ factType, reason: 'Hecho obtenido por fallback de artifact', artifactId: artId });
          break;
        }
      }

      if (!foundInArtifact) {
        warnings.push(`No se encontró evidencia para ${factType} en ningún artifact`);
        coverage[factType] = 0;
      } else {
        coverage[factType] = (coverage[factType] ?? 0) + 1;
      }
    }
  }

  // 3. A partir de storedFacts restantes
  if (storedFacts) {
    for (const fact of storedFacts) {
      if (!fact.factType || candidates.some(c => c.factType === fact.factType)) continue;

      let obsText = '';
      if (typeof fact.value === 'string') {
        obsText = fact.value.length > 200 ? fact.value.substring(0, 200) + '...' : fact.value;
      } else if (typeof fact.value === 'object') {
        obsText = JSON.stringify(fact.value).substring(0, 200) + '...';
      }

      candidates.push({
        factType: fact.factType,
        value: fact.value,
        confidence: fact.confidence ?? 0.5,
        evidenceRefs: fact.sourceRef.evidenceId ? [{ evidenceId: String(fact.sourceRef.evidenceId) }] : [],
        artifactRefs: [],
        extractionMethod: 'deterministic',
        observedText: obsText,
        warnings: [],
      });
      coverage[fact.factType] = (coverage[fact.factType] ?? 0) + 1;
    }
  }

  // 4. Warnings globales
  const finalWarnings: string[] = [];
  if (candidates.length === 0) {
    finalWarnings.push('No se pudieron extraer hechos candidatos de los artifacts proporcionados.');
  }
  for (const ft of POLICY_FACT_INVENTORY) {
    if (!(ft in coverage) || coverage[ft] === 0) {
      finalWarnings.push(`Gap de evidencia: fact_type ${ft} no detectado en artifacts ni storedFacts.`);
    }
  }

  // Ordenar: deterministas primero, luego artifact_fallback
  const orderMap: Record<string, number> = { deterministic: 4, artifact_fallback: 0 };
  const sortedCandidates = candidates.sort((a, b) => (orderMap[a.extractionMethod ?? ''] ?? 0) - (orderMap[b.extractionMethod ?? ''] ?? 0));

  return {
    candidates: sortedCandidates,
    fallbacks,
    coverage,
    warnings: finalWarnings,
  };
}

/** Construye PolicyFacts a partir de FactCandidate[], conservando provenance. */
export function candidatesToPolicyFacts(candidates: FactCandidate[]): Fact[] {
  return candidates.map((c) => {
    const sourceRef = c.evidenceRefs[0] ? { evidenceId: c.evidenceRefs[0].evidenceId } : { evidenceId: '' };
    let value = c.value;
    if (typeof value !== 'string' || value.length < 5) {
      value = c.observedText || String(c.value || '');
    }
    return {
      id: crypto.randomUUID(),
      type: c.factType,
      value,
      source: sourceRef,
      extractionConfidence: c.confidence,
    };
  });
}
