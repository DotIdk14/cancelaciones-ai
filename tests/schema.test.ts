import { describe, expect, it } from 'vitest';
import { AuditResultSchema, parseAuditResult } from '../src/skills/audit/schema';

/** Resultado VÁLIDO mínimo (todas las claves obligatorias). */
const validResult = {
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
      evidenceText: 'UTEL-2026-001',
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
    reasoning: 'La evidencia acredita la solicitud dentro del plazo de venta.',
    confidence: 0.91,
    supportingEvidenceIds: ['ev-1'],
    missingEvidence: [],
    observations: ['Sin observaciones.'],
  },
  model: { provider: 'openrouter', model: 'google/gemini-2.5-flash' },
  usage: {
    promptTokens: 1200,
    completionTokens: 300,
    totalTokens: 1500,
    estimatedCostUSD: 0.00045,
  },
} as const;

describe('parseAuditResult (schema único)', () => {
  it('acepta un AuditResult válido', () => {
    const parsed = parseAuditResult(validResult);
    expect(parsed.audit.result).toBe('CANCELACION_VENTA');
    expect(parsed.facts[0]?.evidenceIds).toContain('ev-1');
  });

  it('rechaza una clasificación desconocida', () => {
    const invalid = { ...validResult, audit: { ...validResult.audit, result: 'RESULTADO_INVENTADO' } };
    const error = parseInvalid(invalid);
    expect(error).toMatch(/^INVALID_AI_RESPONSE:/);
    expect(error).toContain('audit.result');
  });

  it('rechaza claves extra (schema strict)', () => {
    const invalid = { ...validResult, auditoriaExtra: true };
    const error = parseInvalid(invalid);
    expect(error).toMatch(/^INVALID_AI_RESPONSE:/);
    expect(error).toContain('auditoriaExtra');
  });

  it('rechaza confianza fuera de rango', () => {
    const invalid = { ...validResult, audit: { ...validResult.audit, confidence: 1.5 } };
    const error = parseInvalid(invalid);
    expect(error).toContain('confidence');
  });

  it('acepta usage con campos null (coste no disponible)', () => {
    const parsed = parseAuditResult({ ...validResult, usage: { promptTokens: null, completionTokens: null, totalTokens: null, estimatedCostUSD: null } });
    expect(parsed.usage.estimatedCostUSD).toBeNull();
  });
});

/** Devuelve el mensaje del error, o '' si no lanzó. */
function parseInvalid(value: unknown): string {
  try {
    parseAuditResult(value);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('AuditResultSchema (serialización)', () => {
  it('sobrevive al round-trip JSON (result_json → JSONB → result_json)', () => {
    // Simula el ciclo: Zod valida en el servidor → se guarda en JSONB →
    // PostgREST lo devuelve serializado → el cliente lo re-valida.
    const serialized = JSON.stringify(validResult);
    const deserialized = JSON.parse(serialized);
    const reparsed = AuditResultSchema.safeParse(deserialized);
    expect(reparsed.success).toBe(true);
    if (reparsed.success) {
      expect(reparsed.data.audit.result).toBe('CANCELACION_VENTA');
    }
    expect(JSON.stringify(reparsed.success ? reparsed.data : null)).toBe(serialized);
  });
});