import type { Assessment } from '@cancelaciones/shared';

function completed(classification: NonNullable<Assessment['classification']>, summary: string): Assessment {
  return {
    status: 'COMPLETED',
    classification,
    summary,
    findings: [{ title: summary, detail: summary, evidence: [{ evidenceId: 'ev-1', snippet: summary }] }],
    evidenceReferences: [{ evidenceId: 'ev-1', snippet: summary }],
    policyReferences: [{ procedureVersion: '5', section: '5.2', quote: 'Intentos de contacto mínimos al estudiante' }],
    contradictions: [],
    missingEvidence: [],
    procedureVersion: '5',
  };
}

function needs(summary: string): Assessment {
  return {
    status: 'NEEDS_INPUT',
    summary,
    findings: [],
    evidenceReferences: [],
    policyReferences: [],
    contradictions: [],
    missingEvidence: [{ description: summary, reason: 'La evidencia disponible no permite sostener el dictamen.', suggestedEvidence: 'Agregar evidencia fuente verificable.' }],
    procedureVersion: '5',
  };
}

export const evalDataset = [
  { audit: { id: 'A', externalCaseId: 'A-CV', displayName: 'Audio y PDF cancelacion venta' }, evidence: [{ id: 'ev-1', text: 'Audio con solicitud de cancelacion y PDF de soporte.' }], timeline: [], expected: completed('CANCELACION_VENTA', 'Cancelacion de venta soportada por audio y PDF.') },
  { audit: { id: 'B', externalCaseId: 'B-BAJA', displayName: 'Baja posterior' }, evidence: [{ id: 'ev-1', text: 'Solicitud de baja posterior al inicio.' }], timeline: [], expected: completed('BAJA', 'Baja con evidencia suficiente.') },
  { audit: { id: 'C', externalCaseId: 'C-OPER', displayName: 'Operativa' }, evidence: [{ id: 'ev-1', text: 'Cancelacion operativa por error interno.' }], timeline: [], expected: completed('CANCELACION_VENTA_OPERATIVA', 'Cancelacion operativa documentada.') },
  { audit: { id: 'D', externalCaseId: 'D-DICT', displayName: 'Dictaminacion' }, evidence: [{ id: 'ev-1', text: 'Caso requiere dictaminacion por excepcion.' }], timeline: [], expected: completed('DICTAMINACION', 'Dictaminacion requerida por el expediente.') },
  { audit: { id: 'E', externalCaseId: 'E-NEEDS', displayName: 'Insuficiente' }, evidence: [], timeline: [], expected: needs('No hay evidencia suficiente.') },
  { audit: { id: 'F', externalCaseId: 'F-CONTRA', displayName: 'Contradiccion' }, evidence: [{ id: 'ev-1', text: 'PDF contradice audio.' }], timeline: [], expected: needs('Existe contradiccion entre evidencias.') },
  { audit: { id: 'G', externalCaseId: 'G-AUDIO', displayName: 'Audio pendiente' }, evidence: [{ id: 'ev-1', text: 'Audio no transcrito.' }], timeline: [], expected: needs('Falta transcripcion de audio.') },
  { audit: { id: 'H', externalCaseId: 'H-PDF', displayName: 'PDF incompleto' }, evidence: [{ id: 'ev-1', text: 'PDF ilegible.' }], timeline: [], expected: needs('PDF insuficiente o ilegible.') },
] as const;
