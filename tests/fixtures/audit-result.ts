import type { AuditResult } from '../../src/skills/audit/schema';

/** AuditResult válido de referencia para tests (cubre todas las claves). */
export const validAuditResult: AuditResult = {
  case: {
    matricula: 'UTEL-2026-001',
    studentName: 'María Pérez',
    program: 'Licenciatura en Administración',
    cycle: '2026-A',
    cycleStartDate: '2026-01-12',
  },
  evidenceSummary: [
    {
      evidenceId: 'ev-1',
      filename: 'captura.png',
      detectedType: 'captura de pantalla',
      description: 'Muestra el perfil del estudiante.',
      relevant: true,
    },
  ],
  facts: [
    {
      key: 'matricula',
      label: 'Matrícula',
      value: 'UTEL-2026-001',
      confidence: 0.98,
      evidenceIds: ['ev-1'],
      evidenceText: 'La matrícula figura en la captura.',
    },
  ],
  timeline: [
    { date: '2026-02-01', event: 'El estudiante solicita la cancelación.', evidenceIds: ['ev-1'] },
  ],
  conflicts: [],
  audit: {
    result: 'CANCELACION_VENTA',
    rule: 'GDM_GAM_PRD_MLG_003 v5 — Fase de venta',
    procedureSection: '3, páginas 4-5',
    auditPath: {
      hypothesis: 'solicitud del estudiante',
      procedureSections: ['3', '5.2'],
      reasoning: 'Se evalúa la ruta de solicitud del estudiante porque la evidencia converge hacia la misma intención de no continuar.',
    },
    provisionalResolution: null,
    reasoning: 'La evidencia acredita la solicitud dentro del plazo de venta.',
    confidence: 0.91,
    supportingEvidenceIds: ['ev-1'],
    missingEvidence: [],
    procedureChecks: [
      {
        procedureSection: '5.2',
        criterion: 'Intentos mínimos de contacto',
        status: 'ACREDITADO',
        reasoning: 'Se observa que la solicitud quedó acreditada por la evidencia disponible.',
        evidenceIds: ['ev-1'],
        observedValues: [{ label: 'solicitud identificada', value: 'Sí' }],
      },
    ],
    observations: ['Sin observaciones.'],
  },
  model: { provider: 'openrouter', model: 'google/gemini-2.5-flash' },
  usage: {
    promptTokens: 1200,
    completionTokens: 300,
    totalTokens: 1500,
    estimatedCostUSD: 0.00045,
  },
};