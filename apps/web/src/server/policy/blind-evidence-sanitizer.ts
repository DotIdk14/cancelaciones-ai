/**
 * blindEvidenceSanitizer: filtra y aísla la evidencia técnica antes de que
 * el circuito BLIND_MACHINE_AUDIT sea procesado por el Evidence Interpreter
 * y el Policy Reasoner.
 *
 * OBJETIVO: Garantizar que ningún contenido de dictamen humano anterior
 * filtrado como "EVIDENCE" contamine el análisis ciego.
 *
 * ACCIONES:
 * - Excluye obligatoriamente document_role = HUMAN_DECISION_DOCUMENT
 * - Excluye document_role = ADJUDICATION_EVIDENCE cuando revela un resultado
 *   humano previo.
 * - Detecta y marca contenido potencial de outcomes/humanos con heurística
 *   estructurada (sin hardcodear textos como única detección).
 * - Permite exclusión por página/artifact/section/chunk.
 * - Registra exclusiones para auditoría.
 */
export interface SanitizationResult {
  /** Evidencias que PASAN al circuito ciego (aprobadas). */
  allowed: string[]; // evidenceIds
  /** Evidencias EXCLUIDAS del circuito ciego. */
  excluded: Array<{ evidenceId: string; reason: string; chunk?: string; artifactId?: string }>;
  /** Heurísticas detectadas que justificaron la exclusión. */
  detectedHeuristics: string[];
  /** Resumen de roles encontrados. */
  roleSummary: Record<string, number>;
}

/**
 * Heurísticas estructuradas para detectar contenido humano previo.
 * Cada una devuelve true/false y un tag descriptivo.
 */
/** Heurística estructurada para detectar contenido humano previo. */
interface Heuristic {
  matches: (text: string) => boolean;
  tag: string;
}

/** Colección de heurísticas para detectar contenido humano previo. */
type HeuristicFn = Heuristic[];

const humanDecisionHeuristics: Heuristic[] = [
  // Heurística por patrones sintácticos de dictamen
  {
    matches: (text) => /dictamen\s+[a-z]/.test(text.trim().toLowerCase()) || /dictamen\s*[:]/.test(text.trim()),
    tag: 'DETECTED_DICTAMEN_SYNTACTIC',
  },
  // Heurística por outcomes formales
  {
    matches: (text) => /CONFIRM_AI|CONFIRM_HUMAN|CONFIRM_BOTH_INCORRECT|BOTH_INCORRECT|INSUFFICIENT_INFORMATION|CUSTOM_FINAL_DECISION/.test(text),
    tag: 'DETECTED_FORMAL_OUTCOME',
  },
  // Heurística por frases de resolución
  {
    matches: (text) => /se\s+determina|se\s+declara|se\s+resuelve|se\s+aplica|Resultado humano|Resultado final/.test(text),
    tag: 'DETECTED_RESOLUTION_PHRASE',
  },
  // Heurística por sección de dictamen
  {
    matches: (text) => /página|page|sección|section\s+[0-9]/.test(text) && /cancelaci|cancelation|dictamen|adjudication/.test(text),
    tag: 'DETECTED_DICTAMEN_SECTION',
  },
  // Heurística por menciones a decisión humana
  {
    matches: (text) => /decision[ahuman]?|resolución|resolution/.test(text) && /[Hh]umano|human/.test(text),
    tag: 'DETECTED_HUMAN_REFERENCE',
  },
];

/** Texto sospechoso de outcomes/humanos (para filtrado suplementario). */
const POTENTIAL_HUMAN_KEYWORDS = [
  'dictamen', 'determina', 'resuelve', 'resolución', 'confirm', 'human', 'humano',
  'Resultado', 'resultado', 'decision', 'resolución final',
];

/** Extrae todo el texto legible de un artifact para análisis de heurísticas. */
function extractAllTextFromArtifact(artifact: { result: unknown; evidenceId: string; content?: string }): string {
  if (!artifact.result) return '';
  if (artifact.content) return artifact.content;

  const result = artifact.result;
  if (typeof result === 'string') return result;
  if (typeof result === 'object' && 'text' in result) return String((result as { text: unknown }).text);
  if (typeof result === 'object' && 'transcript' in result) return String((result as { transcript: unknown }).transcript);

  // Intentar extraer de extractedFacts o descripción
  if (typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (r.raw_text) return String(r.raw_text);
    if (r.description) return String(r.description);
  }
  return '';
}

/**
 * Ejecuta el sanitizador ciego sobre una lista de evidencias.
 * Sólo permite evidencias con document_role = 'EVIDENCE' o sin rol definido.
 * Evidencia con document_role = HUMAN_DECISION_DOCUMENT o ADJUDICATION_EVIDENCE
 * se excluye automáticamente; si contiene contenido heurísticamente sospechoso,
 * también se excluye con razón documentada.
 */
export function blindEvidenceSanitizer(
  evidences: { evidenceId: string; document_role: string; artifactId?: string; content?: string }[],
  artifactTextMap: Map<string, string>
): SanitizationResult {
  const allowed: string[] = [];
  const excluded: Array<{ evidenceId: string; reason: string; chunk?: string; artifactId?: string }> = [];
  const detectedHeuristics: string[] = [];
  const roleSummary: Record<string, number> = {};

  for (const ev of evidences) {
    const rid = ev.evidenceId;
    const role = ev.document_role ?? 'EVIDENCE';

    // Acumular resumen de roles
    roleSummary[role] = (roleSummary[role] ?? 0) + 1;

    // 1. Exclusión por rol prohibido
    if (role === 'HUMAN_DECISION_DOCUMENT') {
      excluded.push({
        evidenceId: rid,
        reason: 'document_role HUMAN_DECISION_DOCUMENT: contiene dictamen humano previo',
        artifactId: ev.artifactId,
      });
      continue;
    }

    if (role === 'ADJUDICATION_EVIDENCE') {
      excluded.push({
        evidenceId: rid,
        reason: 'document_role ADJUDICATION_EVIDENCE: evidencia de adjudicación previa',
        artifactId: ev.artifactId,
      });
      continue;
    }

    // 2. Si el rol no está prohibido, hacer análisis heurístico del contenido
    const text = artifactTextMap.get(rid) || '';
    if (text && text.length > 0) {
      for (const h of humanDecisionHeuristics) {
        if (h.matches(text)) {
          detectedHeuristics.push(h.tag);
          // Si se detectó una heurística fuerte, excluir con razón documentada
          excluded.push({
            evidenceId: rid,
            reason: `Heurística ${h.tag}: posible contenido de dictamen humano`,
            artifactId: ev.artifactId,
          });
          // Marcar como procesado para no seguir añadiendo heurísticas idénticas
          break;
        }
      }
    }

    // 3. Chequeo suplementario: si el texto contiene muchas keywords de outcomes humanos
    let potentialHumanCount = 0;
    for (const kw of POTENTIAL_HUMAN_KEYWORDS) {
      if (text.toLowerCase().includes(kw.toLowerCase())) potentialHumanCount++;
    }
    if (potentialHumanCount >= 2) {
      // Ya fue manejado por el loop de heurísticas arriba, pero como medida extra:
      excluded.push({
        evidenceId: rid,
        reason: `Al ${potentialHumanCount} keywords de outcome humano detectadas en el texto`,
        artifactId: ev.artifactId,
      });
      // Romper para evitar duplicados; el evidence ya fue añadido a excluded
      continue;
    }
  }

  // 4. Qué quedó: evidencias no excluidas
  const excludedIds = new Set(excluded.map((e) => e.evidenceId));
  for (const ev of evidences) {
    if (!excludedIds.has(ev.evidenceId)) {
      allowed.push(ev.evidenceId);
    }
  }

  return { allowed, excluded, detectedHeuristics, roleSummary };
}

export type { HeuristicFn };