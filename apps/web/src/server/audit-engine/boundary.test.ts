import { describe, expect, it } from 'vitest';

import {
  AUDIT_ENGINE_NOT_IMPLEMENTED,
  AUDIT_ENGINE_CAPABILITIES,
  AuditEngineNotImplementedError,
  NORMATIVE_EVALUATION_PRECONDITIONS,
  NORMATIVE_SOURCE_CODE,
  assertAuditEngineOperational,
  isAuditEngineNotImplemented,
  isCapabilityAvailable,
  unmetPreconditions,
} from './boundary';

describe('frontera del motor de auditoria', () => {
  it('expone el codigo de error normative correcto', () => {
    expect(AUDIT_ENGINE_NOT_IMPLEMENTED).toBe('AUDIT_ENGINE_NOT_IMPLEMENTED');
    expect(AUDIT_ENGINE_NOT_IMPLEMENTED).toBe('AUDIT_ENGINE_NOT_IMPLEMENTED');
  });

  it('apunta a la fuente normativa del propietario', () => {
    expect(NORMATIVE_SOURCE_CODE).toBe('GDM_GAM_PRD_MLG_003');
  });

  it('declara las capacidades que requeriran el motor en la V2', () => {
    expect(AUDIT_ENGINE_CAPABILITIES).toContain('normative-evaluation');
    expect(AUDIT_ENGINE_CAPABILITIES).toContain('dictamen-generation');
    expect(AUDIT_ENGINE_CAPABILITIES).toContain('report-snapshot');
  });

  it('lanza siempre, sin ruta alternativa', () => {
    for (const capability of AUDIT_ENGINE_CAPABILITIES) {
      expect(() => assertAuditEngineOperational(capability)).toThrowError(
        AuditEngineNotImplementedError,
      );
    }
  });

  it('no degrada a false ni a resultado vacio', () => {
    let caught: unknown;
    try {
      assertAuditEngineOperational('normative-evaluation');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AuditEngineNotImplementedError);
    const error = caught as AuditEngineNotImplementedError;
    expect(error.code).toBe('AUDIT_ENGINE_NOT_IMPLEMENTED');
    expect(error.status).toBe(501);
    expect(error.capability).toBe('normative-evaluation');
    expect(error.normativeSource).toBe('GDM_GAM_PRD_MLG_003');
    // No puede interpretarse como una condicion normativa falsa.
    expect(error).not.toHaveProperty('outcome');
    expect(error).not.toHaveProperty('decisionStatus');
    expect(error).not.toHaveProperty('suggestedOutcome');
  });

  it('identifica sus propios errores y no los ajenos', () => {
    expect(isAuditEngineNotImplemented(new AuditEngineNotImplementedError('dictamen-generation'))).toBe(true);
    expect(isAuditEngineNotImplemented(new Error('fallo de red'))).toBe(false);
    expect(isAuditEngineNotImplemented(undefined)).toBe(false);
  });
});

describe('el bloqueo es accionable, no un misterio', () => {
  it('la evaluacion normativa declara sus precondiciones pendientes', () => {
    const conditions = unmetPreconditions('normative-evaluation');
    expect(conditions).toEqual(NORMATIVE_EVALUATION_PRECONDITIONS);
    expect(conditions.length).toBeGreaterThan(0);
  });

  it('cada precondicion nombra la falta y lo que desbloquea', () => {
    for (const precondition of unmetPreconditions('normative-evaluation')) {
      expect(precondition.code.length).toBeGreaterThan(0);
      expect(precondition.detail.length).toBeGreaterThan(0);
      expect(precondition.unblocks).toBe('normative-evaluation');
    }
  });

  it('los codigos de precondicion son estables y unicos', () => {
    const codes = unmetPreconditions('normative-evaluation').map((item) => item.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('el error expone las precondiciones pendientes', () => {
    const error = new AuditEngineNotImplementedError('normative-evaluation');
    expect(error.unmetPreconditions.map((item) => item.code)).toEqual(
      NORMATIVE_EVALUATION_PRECONDITIONS.map((item) => item.code),
    );
  });

  it('el mensaje del error enumera los codigos de precondicion', () => {
    const error = new AuditEngineNotImplementedError('normative-evaluation');
    for (const precondition of NORMATIVE_EVALUATION_PRECONDITIONS) {
      expect(error.message).toContain(precondition.code);
    }
  });

  it('las capacidades no construidas se distinguen de las bloqueadas por datos', () => {
    // Un dictamen no esta construido; la evaluacion si, pero le faltan datos.
    // Confundir ambos llevaria a "construyamos mas motor", que es la accion
    // equivocada para la evaluacion.
    const dictamen = unmetPreconditions('dictamen-generation');
    expect(dictamen.map((item) => item.code)).toEqual(['CAPABILITY_NOT_IMPLEMENTED']);
    expect(unmetPreconditions('normative-evaluation').map((item) => item.code)).not.toContain(
      'CAPABILITY_NOT_IMPLEMENTED',
    );
  });

  it('ninguna capacidad esta disponible todavia', () => {
    for (const capability of AUDIT_ENGINE_CAPABILITIES) {
      expect(isCapabilityAvailable(capability), capability).toBe(false);
    }
  });

  it('toDetails conserva las precondiciones para el cliente HTTP', () => {
    const details = new AuditEngineNotImplementedError('normative-evaluation').toDetails();
    expect(details.unmetPreconditions.length).toBe(NORMATIVE_EVALUATION_PRECONDITIONS.length);
  });

  it('la evaluacion normativa sigue fallando aunque el motor exista', () => {
    // La V2 del arbol esta verificada, pero sin hechos canonicos ejecutarla
    // produciria INSUFFICIENT_EVIDENCE sobre el caso, que es una conclusion
    // falsa. Fallar aqui es lo correcto.
    expect(() => assertAuditEngineOperational('normative-evaluation')).toThrowError(
      AuditEngineNotImplementedError,
    );
  });
});
