import type { HumanClaim, HumanClaimClassification } from '@cancelaciones/domain';

/**
 * Modulo puro de extraccion del dictamen humano:
 *  - construye el prompt estructurado (sin cadena de pensamiento),
 *  - valida la respuesta LLM,
 *  - clasifica afirmaciones contra las evidencias reales del expediente.
 * No conoce React, Next.js, insforge ni HTTP.
 */

export const HUMAN_DECISION_PROMPT_VERSION = 'human-decision-extractor-v1';
export const HUMAN_DECISION_EXTRACTOR_VERSION = 'human-decision-extract-v1';

export interface HumanDecisionStructured {
  resolution: string | null;
  decisionDate: string | null;
  motives: string[];
  conditionsConsidered: string[];
  datesConsidered: string[];
  facts: HumanClaim[];
  evidenceMentioned: string[];
  rulesMentioned: string[];
  observations: string[];
  areasInvolved: string[];
  externalInformation: string[];
}

export interface RawHumanDecision {
  resolution?: unknown;
  decisionDate?: unknown;
  motives?: unknown;
  conditionsConsidered?: unknown;
  datesConsidered?: unknown;
  facts?: unknown;
  evidenceMentioned?: unknown;
  rulesMentioned?: unknown;
  observations?: unknown;
  areasInvolved?: unknown;
  externalInformation?: unknown;
  summary?: unknown;
}

const RESOLUTION_CANDIDATES = ['PROCEDE', 'NO PROCEDE', 'BAJA', 'RETENCION', 'NO_APLICA', 'CANCELACION'];

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter((item): item is string => item !== null);
}

function asClaims(value: unknown): HumanClaim[] {
  if (!Array.isArray(value)) return [];
  const claims: HumanClaim[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as { statement?: unknown; assertion?: unknown; text?: unknown; classification?: unknown; source?: unknown; type?: unknown };
    const statement = asString(candidate.statement ?? candidate.assertion ?? candidate.text);
    if (!statement) continue;
    const classificationRaw = asString(candidate.classification ?? candidate.type);
    claims.push({
      id: `human-claim-${claims.length + 1}`,
      statement,
      classification: normalizeClaimClassification(classificationRaw),
      ...(asString(candidate.source) ? { source: asString(candidate.source)! } : {}),
    });
  }
  return claims;
}

export function normalizeClaimClassification(value: string | null | undefined): HumanClaimClassification {
  switch ((value ?? '').toUpperCase()) {
    case 'VERIFIED_FACT': return 'VERIFIED_FACT';
    case 'MENTIONED_IN_HUMAN_DECISION':
    case 'MENTIONED_BUT_UNVERIFIED':
    case 'UNVERIFIED':
    case 'NO_VERIFICADO':
    case 'SOLO_MENCIONADO':
      return 'MENTIONED_IN_HUMAN_DECISION';
    case 'INFERENCE': return 'INFERENCE';
    case 'MISSING_EVIDENCE': return 'MISSING_EVIDENCE';
    case 'UNKNOWN': return 'UNKNOWN';
    default: return 'UNKNOWN';
  }
}

export function normalizeHumanStructured(input: RawHumanDecision | null | undefined): HumanDecisionStructured {
  if (!input) return emptyHumanDecision();
  const resolution = asString(input.resolution);
  const resolved = pickResolution(resolution);
  const dates = asStringArray(input.datesConsidered);
  const facts = asClaims(input.facts);
  return {
    resolution: resolved,
    decisionDate: asString(input.decisionDate),
    motives: asStringArray(input.motives),
    conditionsConsidered: asStringArray(input.conditionsConsidered),
    datesConsidered: dates,
    facts,
    evidenceMentioned: asStringArray(input.evidenceMentioned),
    rulesMentioned: asStringArray(input.rulesMentioned),
    observations: asStringArray(input.observations),
    areasInvolved: asStringArray(input.areasInvolved),
    externalInformation: asStringArray(input.externalInformation),
  };
}

function pickResolution(resolution: string | null): string | null {
  if (!resolution) return null;
  const upper = resolution.toUpperCase().replace(/\s+/g, ' ');
  for (const candidate of RESOLUTION_CANDIDATES) {
    if (upper.includes(candidate)) return candidate;
  }
  return resolution;
}

export function emptyHumanDecision(): HumanDecisionStructured {
  return {
    resolution: null,
    decisionDate: null,
    motives: [],
    conditionsConsidered: [],
    datesConsidered: [],
    facts: [],
    evidenceMentioned: [],
    rulesMentioned: [],
    observations: [],
    areasInvolved: [],
    externalInformation: [],
  };
}

export function buildHumanDecisionPrompt(input: { filename: string; mode: 'TEXT' | 'VISION' }): { system: string; user: string } {
  const system = [
    'Eres un extractor de dictamenes humanos para auditoria QA en espanol.',
    'NO eres un motor normativo: no cambias ni cuestionas la politica GDM_GAM_PRD_MLG_003.',
    'Solo lees y estructuras lo que resolvio la persona.',
    'No almacenas cadena de pensamiento: respondes unicamente con el JSON solicitado.',
  ].join(' ');
  const user = [
    `Lee el dictamen humano del archivo "${input.filename}" y estructura su contenido.`,
    'Responde SOLO con JSON valido con esta forma:',
    '{"resolution":"PROCEDE|NO PROCEDE|BAJA|RETENCION|NO_APLICA o texto literal","decisionDate":"YYYY-MM-DD si aparece","motives":["motivo 1"],"conditionsConsidered":["condicion"],"datesConsidered":["YYYY-MM-DD"],"facts":[{"statement":"afirmacion literal","classification":"VERIFIED_FACT|MENTIONED_IN_HUMAN_DECISION|INFERENCE|MISSING_EVIDENCE|UNKNOWN","source":"nivel o evidencia si la menciona"}],"evidenceMentioned":["evidencia mencionada"],"rulesMentioned":["clave/regla mencionada"],"observations":["observacion"],"areasInvolved":["area"],"externalInformation":["informacion ajena al expediente si cita alguna"]}',
    'Reglas de clasificacion de afirmaciones:',
    '- VERIFIED_FACT: la afirmacion se apoya en una evidencia citada y observable del expediente.',
    '- MENTIONED_IN_HUMAN_DECISION: el hecho solo esta mencionado en el dictamen sin respaldo documental → quedara como "mencionado pero NO verificado".',
    '- INFERENCE: es una inferencia explicita de la persona.',
    '- MISSING_EVIDENCE: el dictamen senala que falta evidencia.',
    '- UNKNOWN: no es posible clasificar.',
    'No inventes fechas, nombres ni numeros que no aparezcan.',
  ].join(' ');
  return { system, user };
}

// ---------------------------------------------------------------------------
// Verificacion determinista de afirmaciones contra evidencias reales.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(['de', 'la', 'el', 'en', 'y', 'a', 'los', 'las', 'que', 'del', 'al', 'se', 'por', 'con', 'para', 'un', 'una', 'su', 'sus', 'no', 'si', 'lo', 'le', 'es', 'fue', 'ser', 'mas', 'pero', 'entre']);

function meaningfulTokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

/** Una afirmacion se considera respaldada si al menos 2 terminos significativos aparecen en alguna evidencia. */
export function claimIsBackedByEvidence(statement: string, evidenceTexts: string[]): boolean {
  const tokens = meaningfulTokens(statement);
  if (tokens.length === 0) return false;
  const corpus = evidenceTexts.map((text) => text.toLowerCase()).join(' \n ');
  const matches = tokens.filter((token) => corpus.includes(token)).length;
  return matches >= 2;
}

/**
 * Nunca auto-promueve una afirmacion a VERIFIED_FACT: el LLM puede marcarla,
 * pero sin respaldo documental la deja como MENTIONED_IN_HUMAN_DECISION.
 * (UNKNOWN_IS_NOT_FALSE y PRESERVE_EVIDENCE_PROVENANCE.)
 */
export function verifyClaimsAgainstEvidence(claims: HumanClaim[], evidenceTexts: string[]): HumanClaim[] {
  if (evidenceTexts.length === 0) {
    return claims.map((claim) => (claim.classification === 'VERIFIED_FACT' ? { ...claim, classification: 'MENTIONED_IN_HUMAN_DECISION' as const } : claim));
  }
  return claims.map((claim) => {
    if (claim.classification === 'VERIFIED_FACT' && !claimIsBackedByEvidence(claim.statement, evidenceTexts)) {
      return { ...claim, classification: 'MENTIONED_IN_HUMAN_DECISION' as const };
    }
    return claim;
  });
}

/** Concatena el texto relevante de los artifacts EVIDENCE de la auditoria. */
export function evidenceCorpusFromArtifacts(artifacts: Array<{ result: Record<string, unknown> }>): string[] {
  return artifacts
    .map((artifact) => String(artifact.result.text ?? artifact.result.transcript ?? ''))
    .filter((text) => text.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Fallback determinista (sin LLM) para entornos sin OPENROUTER_API_KEY o ante
// fallos de red. Produce la misma forma estructurada; facts quedan UNKNOWN.
// ---------------------------------------------------------------------------

const RESOLUTION_REGEX = /(?:se resuelve|resolución|resolucion|resolve|procede|no procede|improb\w*|baja|retenci\w*|denegad\w*)/gi;
const DATE_REGEX = /\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/g;

export function extractHumanDecisionDeterministic(text: string): HumanDecisionStructured {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  const resolutionMatch = RESOLUTION_REGEX.exec(normalized);
  const resolution = pickResolution(resolutionMatch ? resolutionMatch[0] : null);
  const dates: string[] = [];
  for (const match of normalized.matchAll(DATE_REGEX)) {
    const candidate = match[1];
    if (!dates.includes(candidate)) dates.push(candidate);
  }
  return {
    resolution,
    decisionDate: dates[0] ?? null,
    motives: [],
    conditionsConsidered: [],
    datesConsidered: dates,
    facts: [],
    evidenceMentioned: [],
    rulesMentioned: [],
    observations: ['Extracción determinista de respaldo (sin LLM); afirmaciones sin clasificar.'],
    areasInvolved: [],
    externalInformation: [],
  };
}