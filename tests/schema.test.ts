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
    {
      key: 'cycle_start_date',
      label: 'Fecha de inicio de ciclo',
      value: '2026-01-12',
      confidence: 0.95,
      evidenceIds: ['ev-1'],
      evidenceText: 'Inicio de ciclo: 12/01/2026',
    },
  ],
  timeline: [
    { date: '2026-02-01', event: 'El estudiante solicita la cancelación.', evidenceIds: ['ev-1'] },
  ],
  conflicts: [],
  temporalAnalysis: {
    cycleStartDate: '2026-01-12',
    cycleStartEvidenceIds: ['ev-1'],
    cycleStartEvidenceText: 'Inicio de ciclo: 12/01/2026',
    cancellationRequestDate: '2026-02-01',
    cancellationRequestEvidenceIds: ['ev-1'],
    relationToCycleStart: 'DESPUES_DEL_INICIO',
    reasoning: 'La solicitud es posterior al inicio de ciclo acreditado.',
  },
  audit: {
    result: 'CANCELACION_VENTA',
    rule: 'GDM_GAM_PRD_MLG_003 v5 — Fase de venta',
    procedureSection: '3, páginas 4-5',
    auditPath: {
      hypothesis: 'solicitud del estudiante',
      procedureSections: ['3', '5.2'],
      reasoning: 'Se evalúa la hipótesis de solicitud del estudiante porque la evidencia convergente acreditada coincide en la intención de no continuar.',
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
        reasoning: 'Se observa una solicitud válida y la evidencia disponible la acredita.',
        evidenceIds: ['ev-1'],
        observedValues: [
          { label: 'llamadas requeridas', value: '16' },
          { label: 'llamadas acreditadas', value: '16' },
          { label: 'interacciones escritas requeridas', value: '6' },
          { label: 'interacciones escritas acreditadas', value: '6' },
        ],
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
} as const;

describe('parseAuditResult (schema único)', () => {
  it('acepta un AuditResult válido', () => {
    const parsed = parseAuditResult(validResult);
    expect(parsed.audit.result).toBe('CANCELACION_VENTA');
    expect(parsed.facts[0]?.evidenceIds).toContain('ev-1');
  });

  it('acepta el dictamen de cancelación de venta por petición del cliente', () => {
    const result = parseAuditResult({
      ...validResult,
      audit: { ...validResult.audit, result: 'CANCELACION_VENTA_PETICION_CLIENTE' },
    });

    expect(result.audit.result).toBe('CANCELACION_VENTA_PETICION_CLIENTE');
  });

  it('rechaza una clasificación desconocida', () => {
    const invalid = { ...validResult, audit: { ...validResult.audit, result: 'RESULTADO_INVENTADO' } };
    const error = parseInvalid(invalid);
    expect(error).toMatch(/^INVALID_AI_RESPONSE:/);
    expect(error).toContain('audit.result');
  });

  it('rechaza provisionalResolution en un resultado distinto de EVIDENCIA_INSUFICIENTE', () => {
    const invalid = {
      ...validResult,
      audit: {
        ...validResult.audit,
        provisionalResolution: {
          result: 'BAJA',
          rationale: 'Orientación no aplicable al resultado formal.',
          procedureSection: '5.8',
          evidenceIds: ['ev-1'],
        },
      },
    };
    expect(parseInvalid(invalid)).toContain('provisionalResolution');
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

  it('rechaza reasoning vacío', () => {
    const invalid = { ...validResult, audit: { ...validResult.audit, reasoning: '' } };
    expect(parseInvalid(invalid)).toContain('audit.reasoning');
  });

  it('rechaza missingEvidence estructurado incompleto', () => {
    const invalid = {
      ...validResult,
      audit: {
        ...validResult.audit,
        result: 'EVIDENCIA_INSUFICIENTE',
        provisionalResolution: {
          result: 'CANCELACION_VENTA',
          rationale: 'Los indicios disponibles apuntan a cancelación de venta, pendiente de confirmar la condición de contacto efectivo.',
          procedureSection: '5.8',
          evidenceIds: ['ev-1'],
        },
        missingEvidence: [{ title: 'Evidencia de intentos de contacto' }],
      },
    };
    const error = parseInvalid(invalid);
    expect(error).toMatch(/^INVALID_AI_RESPONSE:/);
  });

  it('rechaza un resultado final con missingEvidence bloqueante pero sin insuficiencia', () => {
    const invalid = {
      ...validResult,
      audit: {
        ...validResult.audit,
        result: 'CANCELACION_VENTA',
        missingEvidence: [
          {
            title: 'Falta contacto efectivo',
            reason: 'No se acredita contacto efectivo.',
            acceptedEvidence: ['Sesión con respuesta del estudiante'],
            relatedProcedureSection: '5.3',
            relatedEvidenceIds: ['ev-1'],
            blocking: true,
          },
        ],
      },
    };
    const error = parseInvalid(invalid);
    expect(error).toMatch(/^INVALID_AI_RESPONSE:/);
  });

  it('acepta usage con campos null (coste no disponible)', () => {
    const parsed = parseAuditResult({ ...validResult, usage: { promptTokens: null, completionTokens: null, totalTokens: null, estimatedCostUSD: null } });
    expect(parsed.usage.estimatedCostUSD).toBeNull();
  });

  it('acepta evidencia insuficiente con relatedEvidenceIds vacío y NO_DETERMINABLE sin datos', () => {
    const assessment = {
      ...validResult,
      // Sin hechos ni evidencia que acredite el inicio, el análisis temporal
      // degrada a NO_DETERMINABLE: afirmar una fecha sin respaldo sería
      // incoherente con el resto del assessment.
      case: { ...validResult.case, cycleStartDate: null },
      temporalAnalysis: {
        cycleStartDate: null,
        cycleStartEvidenceIds: [],
        cycleStartEvidenceText: null,
        cancellationRequestDate: null,
        cancellationRequestEvidenceIds: [],
        relationToCycleStart: 'NO_DETERMINABLE',
        reasoning: 'No hay evidencia que acredite el inicio de ciclo ni la fecha de la solicitud.',
      },
      facts: [],
      timeline: [],
      audit: {
        ...validResult.audit,
        auditPath: { ...validResult.audit.auditPath, procedureSections: ['5.8'] },
        result: 'EVIDENCIA_INSUFICIENTE',
        supportingEvidenceIds: [],
        provisionalResolution: {
          result: 'CANCELACION_VENTA',
          rationale: 'La orientación queda sujeta a recibir evidencia indispensable que falta.',
          procedureSection: '5.8',
          evidenceIds: ['ev-1'],
        },
        missingEvidence: [{
          title: 'Registro de contacto',
          reason: 'No se proporcionó evidencia de contacto.',
          acceptedEvidence: ['Registro de llamada o conversación'],
          relatedProcedureSection: '5.8',
          relatedEvidenceIds: [],
          blocking: true,
        }],
        procedureChecks: [{
          procedureSection: '5.8',
          criterion: 'Contacto efectivo',
          status: 'NO_DETERMINABLE',
          reasoning: 'No se proporcionaron registros que permitan determinarlo.',
          evidenceIds: [],
          observedValues: [],
        }],
      },
    };

    expect(parseAuditResult(assessment).audit.missingEvidence[0]?.relatedEvidenceIds).toEqual([]);
    expect(parseAuditResult(assessment).audit.procedureChecks[0]).toMatchObject({ evidenceIds: [], observedValues: [] });
    const evidenceFree = {
      ...assessment,
      case: { matricula: null, studentName: null, program: null, cycle: null, cycleStartDate: null },
      evidenceSummary: [],
      audit: {
        ...assessment.audit,
        supportingEvidenceIds: [],
        provisionalResolution: { ...assessment.audit.provisionalResolution, evidenceIds: [] },
      },
    };
    expect(parseAuditResult(evidenceFree).audit.provisionalResolution?.evidenceIds).toEqual([]);
  });

  it('exige soporte observado para ACREDITADO y NO_ACREDITADO, pero permite NO_DETERMINABLE parcial', () => {
    const check = validResult.audit.procedureChecks[0]!;
    const genericCheck = { ...check, procedureSection: '5.8', criterion: 'Contacto efectivo' };
    for (const status of ['ACREDITADO', 'NO_ACREDITADO'] as const) {
      const invalid = {
        ...validResult,
        audit: {
          ...validResult.audit,
          auditPath: { ...validResult.audit.auditPath, procedureSections: ['3'] },
          procedureChecks: [{ ...genericCheck, status, evidenceIds: [], observedValues: [] }],
        },
      };
      expect(parseInvalid(invalid)).toContain('procedureChecks.0');
    }

    const partial = { ...genericCheck, status: 'NO_DETERMINABLE' as const, evidenceIds: ['ev-1'], observedValues: [] };
    expect(parseAuditResult({ ...validResult, audit: { ...validResult.audit, auditPath: { ...validResult.audit.auditPath, procedureSections: ['3'] }, procedureChecks: [partial] } }).audit.procedureChecks[0]?.status)
      .toBe('NO_DETERMINABLE');
  });

  it('no permite dictaminar cuando la sección 5.2 muestra menos de 16 llamadas', () => {
    const check = validResult.audit.procedureChecks[0]!;
    const invalid = {
      ...validResult,
      audit: {
        ...validResult.audit,
        procedureChecks: [{
          ...check,
          status: 'NO_ACREDITADO',
          observedValues: [
            { label: 'llamadas requeridas', value: '16' },
            { label: 'llamadas acreditadas', value: '15' },
            { label: 'interacciones escritas requeridas', value: '6' },
            { label: 'interacciones escritas acreditadas', value: '6' },
          ],
        }],
      },
    };

    expect(parseInvalid(invalid)).toContain('no se puede dictaminar mientras 5.2');
  });

  it('acepta evidencia insuficiente cuando reporta exactamente los intentos que faltan en 5.2', () => {
    const check = validResult.audit.procedureChecks[0]!;
    const insufficient = {
      ...validResult,
      audit: {
        ...validResult.audit,
        result: 'EVIDENCIA_INSUFICIENTE',
        provisionalResolution: {
          result: 'CANCELACION_VENTA',
          rationale: 'La ruta apunta provisionalmente a cancelación de venta, pero faltan intentos mínimos de contacto.',
          procedureSection: '5.2',
          evidenceIds: ['ev-1'],
        },
        missingEvidence: [{
          title: 'Intentos mínimos de contacto pendientes',
          reason: 'Se acreditan 15 llamadas; falta 1 llamada para cumplir el mínimo de 5.2.',
          acceptedEvidence: ['Registros de los intentos de llamada adicionales'],
          relatedProcedureSection: '5.2',
          relatedEvidenceIds: ['ev-1'],
          blocking: true,
        }],
        procedureChecks: [{
          ...check,
          status: 'NO_ACREDITADO',
          observedValues: [
            { label: 'llamadas requeridas', value: '16' },
            { label: 'llamadas acreditadas', value: '15' },
            { label: 'interacciones escritas requeridas', value: '6' },
            { label: 'interacciones escritas acreditadas', value: '6' },
          ],
        }],
      },
    };

    expect(parseAuditResult(insufficient).audit.result).toBe('EVIDENCIA_INSUFICIENTE');
  });

  it('requiere provisionalResolution solo cuando el resultado es EVIDENCIA_INSUFICIENTE', () => {
    const insufficient = {
      ...validResult,
      audit: {
        ...validResult.audit,
        result: 'EVIDENCIA_INSUFICIENTE',
        provisionalResolution: null,
        missingEvidence: [{ title: 'X', reason: 'Falta X', acceptedEvidence: ['Documento X'], relatedProcedureSection: '5.8', relatedEvidenceIds: [], blocking: true }],
      },
    };
    expect(parseInvalid(insufficient)).toContain('provisionalResolution');
    expect(parseAuditResult({ ...validResult, audit: { ...validResult.audit, provisionalResolution: null } }).audit.provisionalResolution).toBeNull();
  });

  it('exige orientación provisional trazable cuando la evidencia es insuficiente', () => {
    const provisional = {
      result: 'CANCELACION_VENTA',
      rationale: 'Los hechos observados apuntan a cancelación de venta, pero falta acreditar una condición indispensable.',
      procedureSection: '5.8',
      evidenceIds: ['ev-1'],
    };
    const insufficient = {
      ...validResult,
      audit: {
        ...validResult.audit,
        result: 'EVIDENCIA_INSUFICIENTE',
        provisionalResolution: provisional,
        missingEvidence: [{
          title: 'Contacto efectivo',
          reason: 'Los intentos están acreditados, pero no se acredita una interacción efectiva.',
          acceptedEvidence: ['Registro de conversación con respuesta'],
          relatedProcedureSection: '5.8',
          relatedEvidenceIds: ['ev-1'],
          blocking: true,
        }],
      },
    };
    expect(parseAuditResult(insufficient).audit.provisionalResolution).toEqual(provisional);
    expect(parseInvalid({ ...insufficient, audit: { ...insufficient.audit, provisionalResolution: null } })).toContain('provisionalResolution');
    expect(parseInvalid({ ...insufficient, audit: { ...insufficient.audit, provisionalResolution: { ...provisional, result: 'EVIDENCIA_INSUFICIENTE' } } })).toContain('provisionalResolution');
  });

  it('acepta sintético de ilocalizable sin pedir intentos ya presentes', () => {
    const synthetic = {
      ...validResult,
      case: { ...validResult.case, studentName: 'Estudiante A' },
      audit: {
        ...validResult.audit,
        result: 'CANCELACION_VENTA',
        rule: 'GDM_GAM_PRD_MLG_003 v5 — ilocalizable',
        procedureSection: '5.2 + 5.8 + 5.15',
        auditPath: {
          hypothesis: 'estudiante ilocalizable',
          procedureSections: ['5.2', '5.8', '5.15'],
          reasoning: 'Se acreditan intentos de contacto y se descarta contacto efectivo y actividad académica.',
        },
        reasoning: 'Existen múltiples intentos acreditados; no se observa contacto efectivo ni actividad académica suficiente.',
        missingEvidence: [
          {
            title: 'Contacto efectivo',
            reason: 'Se acreditan intentos de contacto, pero falta evidencia del contacto efectivo.',
            acceptedEvidence: ['Registros de llamadas sin respuesta', 'Mensajes con sin respuesta'],
            relatedProcedureSection: '5.8',
            relatedEvidenceIds: ['ev-1'],
            blocking: false,
          },
        ],
        supportingEvidenceIds: ['ev-1'],
        procedureChecks: [
          {
            procedureSection: '5.2',
            criterion: 'Intentos mínimos de contacto',
            status: 'ACREDITADO',
            reasoning: 'Los registros muestran múltiples intentos con resultados sin respuesta.',
            evidenceIds: ['ev-1'],
            observedValues: [
              { label: 'llamadas requeridas', value: '16' },
              { label: 'llamadas acreditadas', value: '16' },
              { label: 'interacciones escritas requeridas', value: '6' },
              { label: 'interacciones escritas acreditadas', value: '6' },
            ],
          },
          {
            procedureSection: '5.8',
            criterion: 'Contacto efectivo',
            status: 'NO_ACREDITADO',
            reasoning: 'No aparece evidencia de interacción efectiva y contestada por el estudiante.',
            evidenceIds: ['ev-1'],
            observedValues: [{ label: 'respuesta efectiva', value: 'No' }],
          },
        ],
      },
    };
    const parsed = parseAuditResult(synthetic);
    expect(parsed.audit.missingEvidence.some((item) => item.title.toLowerCase().includes('intentos'))).toBe(false);
    expect(parsed.audit.auditPath.hypothesis).toBe('estudiante ilocalizable');
  });

  it('acepta un assessment con route auditPath y corroboración convergente', () => {
    const parsed = parseAuditResult({
      ...validResult,
      audit: {
        ...validResult.audit,
        result: 'CANCELACION_VENTA',
        auditPath: {
          hypothesis: 'estudiante ilocalizable',
          procedureSections: ['5.2', '5.8', '5.15'],
          reasoning: 'Se evalúa la hipótesis de ilocalizable porque los intentos están acreditados, pero no hay contacto efectivo ni actividad académica.',
        },
        missingEvidence: [],
      },
    });

    expect(parsed.audit.auditPath.hypothesis).toBe('estudiante ilocalizable');
    expect(parsed.audit.auditPath.procedureSections).toContain('5.8');
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
