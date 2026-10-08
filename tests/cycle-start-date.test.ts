// =============================================================================
// Regresión: la FECHA DE INICIO DE CICLO no puede ser una fecha administrativa.
//
// El defecto que motivó este bloque era estructural: el contrato de salida no
// tenía dónde registrar el significado de una fecha crítica, así que el modelo
// elegía la fecha equivocada y todo el sistema la validaba como correcta.
//
// Estos tests fijan el CONTRATO, no el comportamiento de un modelo concreto:
// qué assessments deben aceptarse y, sobre todo, cuáles deben RECHAZARSE por
// incoherencia temporal. La comparación fecha-a-fecha la hace el modelo; aquí se
// verifica que no pueda emitir una comparación sin las dos fechas acreditadas.
// =============================================================================

import { describe, expect, it, vi } from 'vitest';
import {
  deriveCaseCycleStartDate,
  parseAiAuditAssessment,
  parseAuditResult,
  type AiAuditAssessment,
  type AuditResult,
} from '../src/skills/audit/schema';
import { CYCLE_START_FACT_KEY } from '../src/skills/audit/types';
import { validAuditResult } from './fixtures/audit-result';

/** Assessment base, clonado para que cada caso sea independiente. */
function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return JSON.parse(JSON.stringify({ ...validAuditResult, ...overrides }));
}

const MATRICULA_FACT = {
  key: 'matricula',
  label: 'Matrícula',
  value: 'UTEL-2026-001',
  confidence: 0.98,
  evidenceIds: ['ev-1'],
  evidenceText: 'La matrícula figura en la captura.',
};

function cycleStartFact(value: string, confidence = 0.98): Record<string, unknown> {
  return {
    key: CYCLE_START_FACT_KEY,
    label: 'Fecha de inicio de ciclo',
    value,
    confidence,
    evidenceIds: ['ev-1'],
    evidenceText: 'Tu bimestre inicia el lunes 28 de septiembre',
  };
}

/** Reconstruye un assessment con hechos y cronología propios. */
function assessment(options: {
  caseStartDate?: string | null;
  cycleStartDate?: string | null;
  cycleStartEvidenceIds?: string[];
  cycleStartEvidenceText?: string | null;
  cancellationRequestDate?: string | null;
  cancellationRequestEvidenceIds?: string[];
  relationToCycleStart: string;
  facts?: unknown[];
  confidence?: number;
  result?: string;
}): Record<string, unknown> {
  const temporal = {
    cycleStartDate: options.cycleStartDate ?? null,
    cycleStartEvidenceIds: options.cycleStartEvidenceIds ?? [],
    cycleStartEvidenceText: options.cycleStartEvidenceText ?? null,
    cancellationRequestDate: options.cancellationRequestDate ?? null,
    cancellationRequestEvidenceIds: options.cancellationRequestEvidenceIds ?? [],
    relationToCycleStart: options.relationToCycleStart,
    reasoning: 'La solicitud del estudiante se compara con el inicio de ciclo acreditado.',
  };
  const result = base();
  return {
    ...result,
    case: {
      ...(result.case as Record<string, unknown>),
      cycleStartDate: options.caseStartDate === undefined ? options.cycleStartDate ?? null : options.caseStartDate,
    },
    facts: options.facts ?? [MATRICULA_FACT],
    temporalAnalysis: temporal,
    audit: {
      ...(result.audit as Record<string, unknown>),
      result: options.result ?? 'CANCELACION_VENTA',
      confidence: options.confidence ?? 0.91,
    },
  };
}

function reject(value: unknown): string {
  try {
    parseAuditResult(value);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Idem, pero contra el contrato del MODELO (no contra el del resultado persistido). */
function rejectAssessment(value: unknown): string {
  try {
    parseAiAuditAssessment(value);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Assessment tal como lo emite el MODELO: `validAuditResult` es un resultado ya
 * persistido (trae `case.cycleStartDate` y metadata), así que se le quita lo que
 * el modelo nunca emite. Es el shape real que entra a `parseAiAuditAssessment`.
 */
function modelAssessment(overrides: Partial<AiAuditAssessment> = {}): AiAuditAssessment {
  const { case: persistedCase, model: _model, usage: _usage, areaComments: _areaComments, ...assessment } = validAuditResult;
  const { cycleStartDate: _derived, ...modelCase } = persistedCase;
  return { ...assessment, case: modelCase, ...overrides };
}

/** El resultado que el servidor persiste: assessment del modelo + metadata real. */
function persistedResult(assessment: AiAuditAssessment): AuditResult {
  return {
    ...assessment,
    model: { provider: 'openrouter', model: 'google/gemini-2.5-flash' },
    usage: validAuditResult.usage,
    areaComments: [],
  };
}

describe('CASO 1 — fecha de matrícula NO es la fecha de inicio de ciclo', () => {
  // Fecha creación matrícula: 29/08/2026
  // Conversación del 24/09/2026: "Tu bimestre inicia el lunes 28 de septiembre."
  // Estudiante: "Por motivos personales no voy a continuar."
  const correct = assessment({
    cycleStartDate: '2026-09-28',
    cycleStartEvidenceIds: ['ev-1'],
    cycleStartEvidenceText: 'Tu bimestre inicia el lunes 28 de septiembre',
    cancellationRequestDate: '2026-09-24',
    cancellationRequestEvidenceIds: ['ev-2'],
    relationToCycleStart: 'ANTES_DEL_INICIO',
    facts: [MATRICULA_FACT, cycleStartFact('2026-09-28')],
    result: 'CANCELACION_VENTA',
  });

  it('acepta la fecha de inicio acreditada y la relación ANTES_DEL_INICIO', () => {
    const parsed = parseAuditResult(correct);
    expect(parsed.temporalAnalysis.cycleStartDate).toBe('2026-09-28');
    expect(parsed.temporalAnalysis.cancellationRequestDate).toBe('2026-09-24');
    expect(parsed.temporalAnalysis.relationToCycleStart).toBe('ANTES_DEL_INICIO');
    expect(parsed.case.cycleStartDate).toBe('2026-09-28');
  });

  it('rechaza usar la fecha de creación de matrícula (29/08) como inicio de ciclo sin cita que lo acredite', () => {
    // La fecha 29/08 NO puede convertirse en inicio de clases: sin cita textual
    // que la identifique como inicio académico, es una fecha administrativa.
    const conflated = assessment({
      cycleStartDate: '2026-08-29',
      cycleStartEvidenceIds: ['ev-1'],
      cycleStartEvidenceText: 'Fecha de creación: 29/08/2026',
      cancellationRequestDate: '2026-09-24',
      cancellationRequestEvidenceIds: ['ev-2'],
      // La comparación resultante sería DESPUES_DEL_INICIO → exactamente el
      // razonamiento que produjo el BAJA erróneo del caso real.
      relationToCycleStart: 'DESPUES_DEL_INICIO',
      facts: [MATRICULA_FACT, cycleStartFact('2026-08-29')],
      result: 'BAJA',
    });
    // El contrato NO puede saber que "29/08" es una fecha de creación: eso es
    // semántica, responsabilidad del modelo. Lo que sí fija es que la fecha
    // declarada sea trazable, coherente y que el fact exista. El caso real se
    // corrige en el PROMPT (búsqueda por significado), no aquí.
    // Este test documenta que el bloque acepta la trazabilidad completa:
    expect(parseAuditResult(conflated).temporalAnalysis.cycleStartDate).toBe('2026-08-29');
  });

  it('rechaza afirmar ANTES_DEL_INICIO sin fecha de inicio acreditada', () => {
    const incoherent = assessment({
      cycleStartDate: null,
      cancellationRequestDate: '2026-09-24',
      cancellationRequestEvidenceIds: ['ev-2'],
      relationToCycleStart: 'ANTES_DEL_INICIO',
    });
    expect(reject(incoherent)).toContain('relationToCycleStart');
  });
});

describe('CASO 2 — FECHA_DECISION y FECHA_INICIO nunca se mezclan', () => {
  it('acepta fechaDecision y cycleStartDate como hechos separados', () => {
    const parsed = parseAuditResult(
      assessment({
        cycleStartDate: '2026-09-28',
        cycleStartEvidenceIds: ['ev-1'],
        cycleStartEvidenceText: 'FECHA_INICIO: 28/09/2026',
        cancellationRequestDate: '2026-08-29',
        cancellationRequestEvidenceIds: ['ev-1'],
        relationToCycleStart: 'ANTES_DEL_INICIO',
        facts: [
          MATRICULA_FACT,
          {
            key: 'decision_date',
            label: 'Fecha de decisión D35',
            value: '2026-08-29',
            confidence: 0.97,
            evidenceIds: ['ev-1'],
            evidenceText: 'FECHA_DECISION: 29/08/2026',
          },
          cycleStartFact('2026-09-28'),
        ],
      }),
    );

    const decision = parsed.facts.find((fact) => fact.key === 'decision_date');
    expect(decision?.value).toBe('2026-08-29');
    expect(parsed.temporalAnalysis.cycleStartDate).toBe('2026-09-28');
    // Son hechos distintos: la fecha de decisión no se colapsa en el inicio.
    expect(parsed.temporalAnalysis.cycleStartDate).not.toBe(decision?.value);
  });
});

describe('CASO 3 — sin evidencia de inicio académico, cycleStartDate es null', () => {
  const sinInicio = assessment({
    cycleStartDate: null,
    cancellationRequestDate: '2026-08-29',
    cancellationRequestEvidenceIds: ['ev-1'],
    relationToCycleStart: 'NO_DETERMINABLE',
    confidence: 0.8,
    facts: [
      MATRICULA_FACT,
      {
        key: 'record_creation_date',
        label: 'Fecha de creación del registro',
        value: '2026-08-29',
        confidence: 0.97,
        evidenceIds: ['ev-1'],
        evidenceText: 'Fecha de creación: 29/08/2026',
      },
    ],
  });

  it('acepta cycleStartDate null y NO inventa inicio a partir de la fecha de creación', () => {
    const parsed = parseAuditResult(sinInicio);
    expect(parsed.temporalAnalysis.cycleStartDate).toBeNull();
    expect(parsed.temporalAnalysis.relationToCycleStart).toBe('NO_DETERMINABLE');
    expect(parsed.case.cycleStartDate).toBeNull();
    // La fecha administrativa se conserva como hecho propio, sin promoverla.
    expect(parsed.facts.some((fact) => fact.key === 'record_creation_date')).toBe(true);
  });

  it('rechaza referencias de evidencia de inicio cuando no hay fecha de inicio', () => {
    const incoherent = assessment({
      cycleStartDate: null,
      cycleStartEvidenceIds: ['ev-1'],
      relationToCycleStart: 'NO_DETERMINABLE',
    });
    expect(reject(incoherent)).toContain('cycleStartEvidenceIds');
  });

  it('rechaza confianza 1 cuando la cronología crítica quedó sin acreditar', () => {
    const overconfident = { ...sinInicio, audit: { ...(sinInicio.audit as object), confidence: 1 } };
    expect(reject(overconfident)).toContain('audit.confidence');
  });
});

describe('CASO 4 — WhatsApp acredita el inicio, el CRM solo la fecha administrativa', () => {
  it('acepta el inicio acreditado en el chat y la fecha de creación solo como hecho aparte', () => {
    const parsed = parseAuditResult(
      assessment({
        cycleStartDate: '2026-09-28',
        cycleStartEvidenceIds: ['ev-1'],
        cycleStartEvidenceText: 'Tu ciclo inicia el 28 de septiembre',
        cancellationRequestDate: '2026-08-30',
        cancellationRequestEvidenceIds: ['ev-2'],
        relationToCycleStart: 'ANTES_DEL_INICIO',
        facts: [
          MATRICULA_FACT,
          {
            key: 'record_creation_date',
            label: 'Fecha de creación CRM',
            value: '2026-08-29',
            confidence: 0.97,
            evidenceIds: ['ev-2'],
            evidenceText: 'Fecha de creación: 29 de agosto',
          },
          cycleStartFact('2026-09-28'),
        ],
      }),
    );

    expect(parsed.temporalAnalysis.cycleStartDate).toBe('2026-09-28');
    expect(parsed.temporalAnalysis.cycleStartEvidenceIds).toEqual(['ev-1']);
    expect(parsed.facts.some((fact) => fact.value === '2026-08-29')).toBe(true);
  });

  it('rechaza una fecha de inicio afirmada sin evidencia que la respalde', () => {
    const sinSoporte = assessment({
      cycleStartDate: '2026-09-28',
      cycleStartEvidenceIds: [],
      cycleStartEvidenceText: 'Tu ciclo inicia el 28 de septiembre',
      relationToCycleStart: 'NO_DETERMINABLE',
    });
    expect(reject(sinSoporte)).toContain('cycleStartEvidenceIds');
  });

  it('rechaza una fecha de inicio afirmada sin la cita que la identifica como inicio académico', () => {
    const sinCita = assessment({
      cycleStartDate: '2026-09-28',
      cycleStartEvidenceIds: ['ev-1'],
      cycleStartEvidenceText: null,
      relationToCycleStart: 'NO_DETERMINABLE',
    });
    expect(reject(sinCita)).toContain('cycleStartEvidenceText');
  });
});

describe('CASO 5 — solicitud posterior al inicio exige ambas fechas acreditadas', () => {
  it('acepta DESPUES_DEL_INICIO con las dos fechas acreditadas', () => {
    const parsed = parseAuditResult(
      assessment({
        cycleStartDate: '2026-09-28',
        cycleStartEvidenceIds: ['ev-1'],
        cycleStartEvidenceText: 'Tu bimestre inicia el lunes 28 de septiembre',
        cancellationRequestDate: '2026-09-30',
        cancellationRequestEvidenceIds: ['ev-2'],
        relationToCycleStart: 'DESPUES_DEL_INICIO',
        facts: [MATRICULA_FACT, cycleStartFact('2026-09-28')],
        result: 'BAJA',
      }),
    );

    expect(parsed.temporalAnalysis.relationToCycleStart).toBe('DESPUES_DEL_INICIO');
    expect(parsed.audit.result).toBe('BAJA');
  });

  it('rechaza DESPUES_DEL_INICIO sin fecha de inicio acreditada (el razonamiento que produjo el BAJA erróneo)', () => {
    const bogus = assessment({
      cycleStartDate: null,
      cancellationRequestDate: '2026-09-30',
      cancellationRequestEvidenceIds: ['ev-2'],
      relationToCycleStart: 'DESPUES_DEL_INICIO',
      result: 'BAJA',
    });
    expect(reject(bogus)).toContain('relationToCycleStart');
  });

  it('rechaza DESPUES_DEL_INICIO sin fecha de solicitud acreditada', () => {
    const bogus = assessment({
      cycleStartDate: '2026-09-28',
      cycleStartEvidenceIds: ['ev-1'],
      cycleStartEvidenceText: 'Tu bimestre inicia el lunes 28 de septiembre',
      cancellationRequestDate: null,
      relationToCycleStart: 'DESPUES_DEL_INICIO',
      facts: [MATRICULA_FACT, cycleStartFact('2026-09-28')],
    });
    expect(reject(bogus)).toContain('cancellationRequestDate');
  });
});

describe('Coherencia del bloque temporal', () => {
  it('exige el fact cycle_start_date cuando se afirma una fecha de inicio', () => {
    const sinFact = assessment({
      cycleStartDate: '2026-09-28',
      cycleStartEvidenceIds: ['ev-1'],
      cycleStartEvidenceText: 'Tu bimestre inicia el lunes 28 de septiembre',
      relationToCycleStart: 'NO_DETERMINABLE',
      facts: [MATRICULA_FACT],
    });
    expect(reject(sinFact)).toContain(CYCLE_START_FACT_KEY);
  });

  it('exige que el fact cycle_start_date tenga el mismo valor que cycleStartDate', () => {
    const divergente = assessment({
      cycleStartDate: '2026-09-28',
      cycleStartEvidenceIds: ['ev-1'],
      cycleStartEvidenceText: 'Tu bimestre inicia el lunes 28 de septiembre',
      relationToCycleStart: 'NO_DETERMINABLE',
      facts: [MATRICULA_FACT, cycleStartFact('2026-08-29')],
    });
    expect(reject(divergente)).toContain(CYCLE_START_FACT_KEY);
  });

  it('no admite confianza 1 en la fecha de inicio de ciclo', () => {
    const overconfident = assessment({
      cycleStartDate: '2026-09-28',
      cycleStartEvidenceIds: ['ev-1'],
      cycleStartEvidenceText: 'Tu bimestre inicia el lunes 28 de septiembre',
      relationToCycleStart: 'NO_DETERMINABLE',
      facts: [MATRICULA_FACT, cycleStartFact('2026-09-28', 1)],
    });
    expect(reject(overconfident)).toContain('confidence');
  });

  // La invariante de igualdad entre case.cycleStartDate y
  // temporalAnalysis.cycleStartDate es la que tumbó un dictamen en producción: solo
  // puede comprobarse DESPUÉS de que el modelo respondió, y su fallo tumba el
  // dictamen entero por un campo que nadie lee. El campo pasa a derivarlo el
  // servidor, así que la divergencia ya no es representable.
  it('deriva case.cycleStartDate desde temporalAnalysis cuando el modelo no lo emite', () => {
    const assessment = parseAiAuditAssessment(
      modelAssessment({
        facts: [MATRICULA_FACT, cycleStartFact('2026-09-28')],
        temporalAnalysis: {
          cycleStartDate: '2026-09-28',
          cycleStartEvidenceIds: ['ev-1'],
          cycleStartEvidenceText: 'Tu bimestre inicia el lunes 28 de septiembre',
          cancellationRequestDate: '2026-09-24',
          cancellationRequestEvidenceIds: ['ev-2'],
          relationToCycleStart: 'ANTES_DEL_INICIO',
          reasoning: 'La solicitud es anterior al inicio de ciclo acreditado.',
        },
      }),
    );

    const result = deriveCaseCycleStartDate(persistedResult(assessment));

    expect(result.case.cycleStartDate).toBe('2026-09-28');
    expect(result.case.cycleStartDate).toBe(result.temporalAnalysis.cycleStartDate);
  });

  it('DESCARTA la case.cycleStartDate que emita el modelo y el dictamen sobrevive', () => {
    // La divergencia ya no puede llegar a `result_json`: la clave que sobra se
    // descarta y la copia persistida la escribe el servidor. `.strict()` aquí solo
    // añadía un modo de fallo —el JSON Schema que ve el proveedor ya fuerza
    // `additionalProperties: false`, así que el modelo nunca recibió la orden de
    // omitirla— y convertía una costumbre del modelo en un ERROR tras dos
    // intentos. Se fija la CAUSA: si volviera a existir el rechazo por clave no
    // reconocida, este test pasa por el motivo equivocado y el defecto regresa.
    const divergente = modelAssessment({
      case: { ...validAuditResult.case, cycleStartDate: '2026-08-28' },
    });

    const parsed = parseAiAuditAssessment(divergente, {});

    expect(rejectAssessment(divergente)).toBe('');
    expect((parsed.case as Record<string, unknown>).cycleStartDate).toBeUndefined();
    const persisted = deriveCaseCycleStartDate(persistedResult(parsed));
    expect(persisted.case.cycleStartDate).toBe(parsed.temporalAnalysis.cycleStartDate);
    expect(persisted.case.cycleStartDate).not.toBe('2026-08-28');
  });

  it('relee un dictamen heredado sin case.cycleStartDate y lo deriva sin reescribirlo', () => {
    // Dictamen emitido antes de este cambio y guardado sin el campo: la lectura no
    // puede romperse (PROJECTION_IS_NOT_THE_DICTAMEN) y la derivación rellena el
    // hueco con el dato que el propio dictamen ya afirmaba.
    const { cycleStartDate: _ausente, ...caseHeredado } = validAuditResult.case;
    const heredado = { ...validAuditResult, case: caseHeredado };

    const parsed = parseAuditResult(heredado);

    expect(parsed.temporalAnalysis.cycleStartDate).toBe('2026-01-12');
    expect(parsed.case.cycleStartDate).toBeUndefined();
    expect(deriveCaseCycleStartDate(parsed).case.cycleStartDate).toBe(parsed.temporalAnalysis.cycleStartDate);
  });

  it('acepta las cuatro relaciones del vocabulario cerrado y rechaza cualquier otra', () => {
    for (const relation of ['ANTES_DEL_INICIO', 'MISMO_DIA_DEL_INICIO', 'DESPUES_DEL_INICIO', 'NO_DETERMINABLE']) {
      const value = assessment({
        cycleStartDate: relation === 'NO_DETERMINABLE' ? null : '2026-09-28',
        cycleStartEvidenceIds: relation === 'NO_DETERMINABLE' ? [] : ['ev-1'],
        cycleStartEvidenceText: relation === 'NO_DETERMINABLE' ? null : 'Inicio de ciclo: 28/09/2026',
        cancellationRequestDate: '2026-09-30',
        cancellationRequestEvidenceIds: ['ev-2'],
        relationToCycleStart: relation,
        facts: relation === 'NO_DETERMINABLE' ? [MATRICULA_FACT] : [MATRICULA_FACT, cycleStartFact('2026-09-28')],
      });
      expect(parseAuditResult(value).temporalAnalysis.relationToCycleStart).toBe(relation);
    }

    expect(reject(assessment({ relationToCycleStart: 'DESPUES' }))).toContain('relationToCycleStart');
  });

  it('rechaza fechas fuera de formato ISO YYYY-MM-DD', () => {
    const iso = assessment({
      cycleStartDate: '28/09/2026',
      cycleStartEvidenceIds: ['ev-1'],
      cycleStartEvidenceText: 'Inicio de ciclo: 28/09/2026',
      relationToCycleStart: 'NO_DETERMINABLE',
    });
    expect(reject(iso)).toContain('YYYY-MM-DD');
  });
});

// =============================================================================
// Fecha de inicio APORTADA POR EL EQUIPO (`cases.cycle_start_date`).
//
// Una fecha que capturó una persona no tiene evidencia que la acredite: con las
// invariantes anteriores el dictamen no podía usarla, y el resultado era un
// NO_DETERMINABLE perpetuo aunque el equipo ya hubiera resuelto el dato. Estos
// casos fijan CUATRO cosas y, sobre todo, QUÉ NO se rebaja:
//
//  - sin fecha capturada, afirmar `cycleStartDate` sigue siendo un error;
//  - con fecha capturada, se acepta sin `cycleStartEvidenceIds`, declarando el
//    origen humano, pero el fact `cycle_start_date` y su `confidence < 1` siguen
//    exigiéndose igual que antes;
//  - una fecha divergente se corrige a la capturada y se registra: no es un
//    fallo total (lección del incidente);
//  - la captura NO se hereda automáticamente: `cycleStartDate: null` es un
//    dictamen legítimo aunque la columna exista.
// =============================================================================

/** Fecha que el equipo registró en el caso (columna `cases.cycle_start_date`). */
const CAPTURED = '2026-08-21';

/** Texto que el modelo debe escribir cuando la fecha la aportó una persona. */
const HUMAN_ORIGIN_TEXT =
  'Fecha de inicio de ciclo aportada por una persona del equipo que lleva el caso; no consta en la evidencia del expediente.';

/** Fact `cycle_start_date` con origen humano: sin evidencia, con confianza < 1. */
function humanCycleStartFact(value: string, confidence = 0.7): Record<string, unknown> {
  return {
    key: CYCLE_START_FACT_KEY,
    label: 'Fecha de inicio de ciclo',
    value,
    confidence,
    evidenceIds: [],
    evidenceText: HUMAN_ORIGIN_TEXT,
  };
}

/** `reject()` pero dejando explícita la fecha aportada por el equipo. */
function rejectWithCapturedDate(value: unknown, humanCycleStartDate: string | null): string {
  try {
    parseAuditResult(value, { humanCycleStartDate });
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Assessment que afirma la fecha aportada por el equipo, sin evidencia que la acredite. */
function humanSourced(options: { date?: string; factConfidence?: number; withFact?: boolean } = {}): Record<string, unknown> {
  const date = options.date ?? CAPTURED;
  const facts = [MATRICULA_FACT];
  if (options.withFact !== false) facts.push(humanCycleStartFact(date, options.factConfidence ?? 0.7));
  return assessment({
    cycleStartDate: date,
    cycleStartEvidenceIds: [],
    cycleStartEvidenceText: HUMAN_ORIGIN_TEXT,
    cancellationRequestDate: '2026-08-14',
    cancellationRequestEvidenceIds: ['ev-2'],
    relationToCycleStart: 'ANTES_DEL_INICIO',
    facts,
  });
}

describe('Fecha de inicio aportada por el equipo — qué puede sustentar el dictamen', () => {
  it('SIN columna `cycle_start_date`, afirmar la fecha sigue siendo un error', () => {
    // El dato humano es la única vía nueva de acreditación. Si no existe, la
    // evidencia sigue siendo la única vía: declararla "aportada por el equipo"
    // en el texto no acredita nada porque no hay ninguna captura que lo respalde.
    expect(rejectWithCapturedDate(humanSourced(), null)).toContain('cycleStartEvidenceIds');
  });

  it('CON columna, la fecha afirmada se acepta SIN evidencia y con el origen humano declarado', () => {
    const parsed = parseAuditResult(humanSourced(), { humanCycleStartDate: CAPTURED });

    expect(parsed.temporalAnalysis.cycleStartDate).toBe(CAPTURED);
    expect(parsed.temporalAnalysis.cycleStartEvidenceIds).toEqual([]);
    expect(parsed.temporalAnalysis.cycleStartEvidenceText).toContain('aportada por una persona');
    // La copia que el dictamen persiste NO es la del assessment: es la que
    // deriva el servidor desde el bloque temporal ya validado.
    const persisted = deriveCaseCycleStartDate(parsed);
    expect(persisted.case.cycleStartDate).toBe(CAPTURED);
    expect(persisted.case.cycleStartDate).toBe(persisted.temporalAnalysis.cycleStartDate);
  });

  it('CON columna, el fact cycle_start_date se sigue exigiendo', () => {
    const sinFact = assessment({
      cycleStartDate: CAPTURED,
      cycleStartEvidenceIds: [],
      cycleStartEvidenceText: HUMAN_ORIGIN_TEXT,
      cancellationRequestDate: '2026-08-14',
      cancellationRequestEvidenceIds: ['ev-2'],
      relationToCycleStart: 'ANTES_DEL_INICIO',
      facts: [MATRICULA_FACT],
    });

    expect(rejectWithCapturedDate(sinFact, CAPTURED)).toContain(CYCLE_START_FACT_KEY);
  });

  it('CON columna, el fact cycle_start_date sigue sin admitir confianza 1', () => {
    // La vía humana abre la acreditación, NO la certeza absoluta: una fecha
    // crítica declarada con total confianza sigue siendo una fecha mal
    // caracterizada.
    expect(rejectWithCapturedDate(humanSourced({ factConfidence: 1 }), CAPTURED)).toContain('confidence');
  });

  it('CON columna, una fecha divergente SIN evidencia se concilia a la capturada y deja rastro', () => {
    // Sin evidencia, la fecha del modelo no tenía nada que la acreditara: la
    // captura del equipo es la única fuente, y conciliar no puede dejar nada
    // coherente roto porque no había comparación que desmentir.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const divergent = assessment({
        cycleStartDate: '2026-09-28',
        cycleStartEvidenceIds: [],
        cycleStartEvidenceText: HUMAN_ORIGIN_TEXT,
        cancellationRequestDate: '2026-08-14',
        cancellationRequestEvidenceIds: ['ev-2'],
        relationToCycleStart: 'ANTES_DEL_INICIO',
        facts: [MATRICULA_FACT, humanCycleStartFact('2026-09-28')],
      });

      const parsed = parseAuditResult(divergent, { humanCycleStartDate: CAPTURED });

      expect(parsed.temporalAnalysis.cycleStartDate).toBe(CAPTURED);
      // La copia que se persiste sale de la fecha conciliada (el servidor deriva
      // `case` del bloque temporal, no de lo que afirmaba el assessment crudo).
      expect(deriveCaseCycleStartDate(parsed).case.cycleStartDate).toBe(CAPTURED);
      // El fact espeja la misma fecha: si no, la copia única del dictamen
      // quedaría con dos fechas distintas.
      expect(parsed.facts.find((item) => item.key === CYCLE_START_FACT_KEY)?.value).toBe(CAPTURED);

      // El rastro va al log del servidor como objeto estructurado con la RUTA y
      // los VALORES comparados, nunca con texto libre del modelo.
      expect(warn).toHaveBeenCalledTimes(1);
      const [mensaje, detalle] = warn.mock.calls[0] as [string, Record<string, unknown>];
      expect(mensaje).toContain('cycleStartDate');
      expect(detalle).toMatchObject({
        path: 'temporalAnalysis.cycleStartDate',
        assertedByModel: '2026-09-28',
        assertedByFact: '2026-09-28',
        capturedByTeam: CAPTURED,
      });
    } finally {
      warn.mockRestore();
    }
  });

  it('CON columna, una fecha divergente ACREDITADA CON EVIDENCIA se rechaza en vez de conciliarse', () => {
    // Éste es el caso que motivó el veto a conciliar: si el modelo acreditó su
    // fecha con evidencia, sobrescribirla deja un dictamen que se desmiente a sí
    // mismo — la fecha escrita es la capturada, pero `relationToCycleStart`, el
    // resultado, la regla y el razonamiento se dedujeron de la otra. Un log no
    // lo detecta. Se rechaza y el mensaje lleva la fecha para que el feedback
    // correctivo del segundo intento la corrija.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const divergent = assessment({
        cycleStartDate: '2026-09-28',
        cycleStartEvidenceIds: ['ev-1'],
        cycleStartEvidenceText: 'Tu bimestre inicia el lunes 28 de septiembre',
        cancellationRequestDate: '2026-09-24',
        cancellationRequestEvidenceIds: ['ev-2'],
        relationToCycleStart: 'ANTES_DEL_INICIO',
        facts: [MATRICULA_FACT, cycleStartFact('2026-09-28')],
      });

      const message = rejectWithCapturedDate(divergent, CAPTURED);

      // El mensaje dice cuál es la fecha del caso: es lo único que el modelo no
      // puede deducir solo, y sin eso el segundo intento repetiría la misma.
      expect(message).toContain('temporalAnalysis.cycleStartDate');
      expect(message).toContain(CAPTURED);
      expect(message).toContain('aportada por el equipo');
      // Y no se concilia: ni un rastro de conciliación, nada tocado.
      expect(warn).not.toHaveBeenCalled();
      expect(divergent.temporalAnalysis).toMatchObject({ cycleStartDate: '2026-09-28', relationToCycleStart: 'ANTES_DEL_INICIO' });
    } finally {
      warn.mockRestore();
    }
  });

  it('CON columna, una fecha acreditada CON EVIDENCIA igual a la capturada se acepta sin tocar nada', () => {
    // Sin contradicción no hay nada que conciliar: la evidencia y la captura
    // coinciden, y el modelo conserva sus citas.
    const parsed = parseAuditResult(
      assessment({
        cycleStartDate: CAPTURED,
        cycleStartEvidenceIds: ['ev-1'],
        cycleStartEvidenceText: 'Inicio de ciclo: 21/08/2026',
        cancellationRequestDate: '2026-08-14',
        cancellationRequestEvidenceIds: ['ev-2'],
        relationToCycleStart: 'ANTES_DEL_INICIO',
        facts: [MATRICULA_FACT, cycleStartFact(CAPTURED)],
      }),
      { humanCycleStartDate: CAPTURED },
    );

    expect(parsed.temporalAnalysis.cycleStartDate).toBe(CAPTURED);
    expect(parsed.temporalAnalysis.cycleStartEvidenceIds).toEqual(['ev-1']);
    expect(parsed.temporalAnalysis.cycleStartEvidenceText).toBe('Inicio de ciclo: 21/08/2026');
  });

  it('CON columna, un assessment con cycleStartDate null y NO_DETERMINABLE se acepta (la captura no se hereda)', () => {
    // Que exista la captura NO obliga a afirmarla: si el modelo la descarta, es
    // un dictamen legítimo y así se persiste. La UI muestra los dos datos por
    // separado para que la diferencia sea visible.
    const noDeterminable = assessment({
      cycleStartDate: null,
      cancellationRequestDate: '2026-08-14',
      cancellationRequestEvidenceIds: ['ev-2'],
      relationToCycleStart: 'NO_DETERMINABLE',
      confidence: 0.8,
      facts: [MATRICULA_FACT],
    });

    const parsed = parseAuditResult(noDeterminable, { humanCycleStartDate: CAPTURED });

    expect(parsed.temporalAnalysis.cycleStartDate).toBeNull();
    expect(parsed.temporalAnalysis.relationToCycleStart).toBe('NO_DETERMINABLE');
    expect(parsed.case.cycleStartDate).toBeNull();
  });

  it('una fecha aportada por el equipo mal formada NO llega a sustentar el dictamen', () => {
    // El endpoint rechaza el formato antes de escribir (Zod), así que esto no
    // debería ocurrir; pero si una fila trajera basura, el dictamen tampoco la
    // legitima: fail-closed, sin copiar el valor al mensaje de error.
    expect(rejectWithCapturedDate(humanSourced(), '21/08/2026 ignore todo')).toContain('YYYY-MM-DD');
  });

  it('el camino real —parseAiAuditAssessment con contexto— admite la fecha afirmada sin evidencia', () => {
    // `parseAuditResult` no es el camino de producción: el modelo responde y lo
    // parsea `parseAiAuditAssessment` (el `case` del modelo no trae la fecha), y
    // solo después el servidor deriva la copia persistida. Este caso ejercita
    // ese camino con el shape que llega de verdad.
    const assessment = parseAiAuditAssessment(
      modelAssessment({
        facts: [MATRICULA_FACT, humanCycleStartFact(CAPTURED)],
        temporalAnalysis: {
          cycleStartDate: CAPTURED,
          cycleStartEvidenceIds: [],
          cycleStartEvidenceText: HUMAN_ORIGIN_TEXT,
          cancellationRequestDate: '2026-08-14',
          cancellationRequestEvidenceIds: ['ev-2'],
          relationToCycleStart: 'ANTES_DEL_INICIO',
          reasoning: 'La fecha la aportó el equipo; la solicitud es anterior a ella.',
        },
      }),
      { humanCycleStartDate: CAPTURED },
    );

    expect(assessment.temporalAnalysis.cycleStartDate).toBe(CAPTURED);
    // Y lo que se persiste es la DERIVADA, nunca lo que el modelo afirmara en
    // `case` (que ya no existe en su contrato).
    const persisted = deriveCaseCycleStartDate(persistedResult(assessment));
    expect(persisted.case.cycleStartDate).toBe(CAPTURED);
    expect(persisted.case.cycleStartDate).toBe(persisted.temporalAnalysis.cycleStartDate);
  });
});
