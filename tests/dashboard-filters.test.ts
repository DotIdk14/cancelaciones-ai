import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/server/http';
import { defaultDateRange } from '../src/lib/dashboard';
import {
  MAX_RANGE_DAYS,
  parseDashboardFilters,
  rangeDays,
} from '../src/server/dashboard-filters';

/** Ejecuta el parseo y devuelve el ApiError que lanzó. */
function failure(query: Record<string, string | string[] | undefined>): ApiError {
  try {
    parseDashboardFilters(query);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('parseDashboardFilters debería haber fallado');
}

describe('parseDashboardFilters (validación)', () => {
  it('rechaza `from` mal formado con 400 y mensaje en español', () => {
    const error = failure({ from: 'basura' });
    expect(error.status).toBe(400);
    expect(error.category).toBe('VALIDATION_ERROR');
    expect(error.message).toMatch(/from/);
    expect(error.message).toMatch(/YYYY-MM-DD/);
  });

  it('rechaza fechas que no existen en el calendario', () => {
    expect(failure({ from: '2026-02-31' }).status).toBe(400);
    expect(failure({ to: '2026-13-01' }).status).toBe(400);
  });

  it('rechaza un rango invertido (to anterior a from)', () => {
    const error = failure({ from: '2026-09-20', to: '2026-09-01' });
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/anterior/i);
  });

  it('rechaza un rango mayor a MAX_RANGE_DAYS', () => {
    const from = '2024-01-01';
    const to = '2025-06-01';
    expect(rangeDays(from, to)).toBeGreaterThan(MAX_RANGE_DAYS);
    const error = failure({ from, to });
    expect(error.status).toBe(400);
    expect(error.message).toContain(String(MAX_RANGE_DAYS));
  });

  it('acepta exactamente MAX_RANGE_DAYS', () => {
    const from = '2025-01-01';
    const to = '2026-01-01';
    expect(rangeDays(from, to)).toBe(MAX_RANGE_DAYS);
    expect(parseDashboardFilters({ from, to })).toMatchObject({ from, to });
  });

  it('rechaza `result` fuera del vocabulario cerrado', () => {
    const error = failure({ result: 'CANCELACION_INVENTADA' });
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/Resultado no válido/);
  });

  it('rechaza `status` fuera del vocabulario cerrado', () => {
    const error = failure({ status: 'CERRADO' });
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/Estado no válido/);
  });

  it('acepta los 7 resultados y los 5 estados oficiales', () => {
    for (const result of ['CANCELACION_VENTA', 'CANCELACION_VENTA_PETICION_CLIENTE', 'BAJA', 'CANCELACION_VENTA_OPERATIVA', 'CANCELACION_MATRICULA', 'DICTAMINACION', 'EVIDENCIA_INSUFICIENTE']) {
      expect(parseDashboardFilters({ result }).result).toBe(result);
    }
    for (const status of ['DRAFT', 'READY', 'AUDITING', 'COMPLETED', 'ERROR']) {
      expect(parseDashboardFilters({ status }).status).toBe(status);
    }
  });

  it('rechaza un array como valor de parámetro', () => {
    for (const key of ['from', 'to', 'result', 'status']) {
      const error = failure({ [key]: ['a', 'b'] });
      expect(error.status).toBe(400);
      expect(error.message).toContain(key);
    }
  });

  it('nunca expone el error crudo de Zod (ni en inglés)', () => {
    const message = failure({ from: 'basura' }).message;
    expect(message).not.toMatch(/invalid_type|ZodError|Expected|received/i);
  });
});

describe('parseDashboardFilters (valores válidos)', () => {
  it('devuelve el rango solicitado sin filtros de grupo', () => {
    const filters = parseDashboardFilters({ from: '2026-09-01', to: '2026-09-29' });
    expect(filters).toEqual({ from: '2026-09-01', to: '2026-09-29', result: null, status: null });
  });

  it('sin query params aplica el rango por defecto de defaultDateRange()', () => {
    const defaults = defaultDateRange();
    expect(parseDashboardFilters({})).toEqual({
      from: defaults.from,
      to: defaults.to,
      result: null,
      status: null,
    });
  });

  it('rellena solo el extremo que falta con el default del otro lado', () => {
    const defaults = defaultDateRange();
    const filters = parseDashboardFilters({ to: defaults.from });
    expect(filters.to).toBe(defaults.from);
    expect(filters.from).toBe(defaults.from);
  });

  it('un rango de más de 90 días avisa por consola, sin datos de usuario', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const from = '2025-01-01';
    const to = '2026-01-01';

    parseDashboardFilters({ from, to });

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('365');
    expect(message).not.toContain(from);
    expect(message).not.toContain(to);
  });

  it('un rango corto no avisa', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    parseDashboardFilters({ from: '2026-09-01', to: '2026-09-29' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('rechaza filtros por dimensión que aún no existen en la vista', () => {
    const error = failure({ from: '2026-09-01', to: '2026-09-29', country: 'MX' });
    expect(error.status).toBe(400);
    expect(error.category).toBe('VALIDATION_ERROR');
    expect(error.message).toContain('country');
    expect(error.message).toContain('from, to, result y status');
  });
});
