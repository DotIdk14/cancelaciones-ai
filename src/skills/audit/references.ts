import { PROCEDURE_MANIFEST } from './procedure-v5.js';
import { ApiError } from '../../server/errors.js';
import type { AiAuditAssessment } from './schema.js';

/** Índice documental: solo existencia de referencias, sin evaluar criterios ni decidir resultados. */
const outline = new Set<string>();
for (const section of PROCEDURE_MANIFEST.sections) {
  outline.add(section.id.toLowerCase());
  const markers = section.content.split(/\r?\n/).map(line => line.match(/^\s*([a-z]|[ivx]+|[IVX]+|\d+)[.)]\s+(.+)/)).filter((m): m is RegExpMatchArray => m !== null);
  let letter = ''; let roman = '';
  for (let i = 0; i < markers.length; i++) {
    const token = markers[i]![1]!; const next = markers[i + 1]?.[1] ?? '';
    const nestedRoman = /^[IVX]+$/.test(token) || (/^[ivx]+$/.test(token) && (token.length > 1 || next === 'ii' || (roman !== '' && token === 'v')));
    if (nestedRoman && letter) { roman = token.toLowerCase(); outline.add(`${section.id}.${letter}.${roman}`); }
    else if (/^[a-z]$/.test(token)) { letter = token; roman = ''; outline.add(`${section.id}.${letter}`); }
    else if (/^\d+$/.test(token) && letter) outline.add(`${section.id}.${letter}${roman ? '.' + roman : ''}.${token}`);
  }
}
export function assertProcedureReference(value: string): void {
  const references = value.match(/\b\d+(?:\.\d+)+(?:\.[a-z]+|\.\d+)*/gi)
    ?? value.match(/^\s*(\d+)(?=[\s,;:]|$)/)?.slice(1);
  if (!references?.length || references.some(reference => !outline.has(reference.toLowerCase()))) {
    const error = new ApiError(502, 'INVALID_AI_RESPONSE', 'INVALID_AI_RESPONSE: audit.procedureSection: referencia no encontrada en el procedimiento V5.');
    error.failurePath = 'audit.procedureSection'; error.sanitizedDetail = 'Referencia normativa inexistente o no identificable'; throw error;
  }
}
export function validateProcedureReferences(assessment: AiAuditAssessment): void {
  [assessment.audit.procedureSection, ...assessment.audit.auditPath.procedureSections,
   ...assessment.audit.procedureChecks.map(c => c.procedureSection), ...assessment.audit.missingEvidence.map(m => m.relatedProcedureSection),
   ...(assessment.audit.provisionalResolution ? [assessment.audit.provisionalResolution.procedureSection] : [])].forEach(assertProcedureReference);
}

export function validatePolicyQuote(section: string, quote: string): void {
  assertProcedureReference(section);
  const roots: string[] = section.match(/(?<![\w.])\d+(?:\.\d+)?/g) ?? [];
  const sources = PROCEDURE_MANIFEST.sections.filter(item => roots.includes(item.id));
  const normalize=(s:string)=>s.normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
  if(!normalize(quote) || !sources.some(source => normalize(source.content).includes(normalize(quote)))) {
    const error = new ApiError(502,'INVALID_AI_RESPONSE','INVALID_AI_RESPONSE: reliabilityReview: la cita normativa no aparece en la sección oficial indicada');
    error.failurePath = 'reliabilityReview.decisionSupport.policyQuote';
    error.sanitizedDetail = 'La cita normativa no aparece literalmente en la sección oficial indicada';
    throw error;
  }
}
