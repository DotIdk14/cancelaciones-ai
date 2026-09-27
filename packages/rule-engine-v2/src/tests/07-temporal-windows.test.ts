/**
 * Test 7/20 — Ventanas temporales contra la fuente congelada.
 *
 * ## Reglas del test
 *
 * El motor es puro: no lee el reloj. Todas las fechas entran por
 * `TemporalContext`, así que cada ventana se puede probar en sus bordes exactos
 * (día 20 y 21, día 14 y 15) sin esperas ni reloj.
 *
 * Las ventanas del documento son **distintas** aunque se solapen: 20 días
 * (`N-35`, p.5) gobierna el ajuste administrativo; 2 semanas (`N-15`, p.3)
 * gobierna la solicitud de CV. Que una esté dentro de la otra no las convierte
 * en la misma ventana, y este test lo fija.
 */

import { describe, expect, it } from 'vitest';
import { POLICY_VERSION, evaluateAudit, temporal } from '../index';
import type { EvidenceContext, TemporalContext } from '../index';

// La superficie pública expone `temporal` como espacio de nombres. El test la
// usa tal cual: ampliar la API pública para acomodar un test sería cambiar el
// contrato del paquete, no probarlo.
const {
  afterWeekThreeIrreversibility,
  beforeStart,
  beforeSundayOfWeekTwo,
  daysBetween,
  firstSundayOnOrAfter,
  isSunday,
  parseIsoDate,
  sundayOfWeek,
  withinTwentyDaysOfStart,
  withinTwoWeeksAfterStart,
} = temporal;
import { bool, evidencia } from '../testing/fixtures';

const INICIO = '2026-01-05'; // lunes
const SOLICITUD = '2026-01-15';

function ctx(temporal: Partial<TemporalContext>): EvidenceContext {
  return {
    evidences: [evidencia('EV-1')],
    temporal: {
      cicloFechaInicio: INICIO,
      fechaSolicitud: SOLICITUD,
      fechaIngreso: INICIO,
      inicioPrimerCiclo: '2024-08-05',
      avanceCurricularPercent: 10,
      ...temporal,
    },
    nivelAcademico: 'LICENCIATURA',
    campus: 'MEXICO',
  };
}

describe('ventanas temporales', () => {
  describe('N-35, 20 días desde el inicio (p.5)', () => {
    it('día 0 es el borde inferior inclusivo', () => {
      const r = withinTwentyDaysOfStart(ctx({ fechaSolicitud: INICIO }).temporal);
      expect(r.value).toBe('TRUE');
    });

    it('día 20 todavía está dentro', () => {
      const r = withinTwentyDaysOfStart(ctx({ fechaSolicitud: '2026-01-25' }).temporal);
      expect(r.value).toBe('TRUE');
    });

    it('día 21 ya está fuera: el plazo es de 20 días, no de 3 semanas', () => {
      const r = withinTwentyDaysOfStart(ctx({ fechaSolicitud: '2026-01-26' }).temporal);
      expect(r.value).toBe('FALSE');
    });

    it('sin fecha de solicitud es UNKNOWN, no FALSE', () => {
      const r = withinTwentyDaysOfStart(ctx({ fechaSolicitud: null }).temporal);
      expect(r.value).toBe('UNKNOWN');
    });
  });

  describe('N-15, 2 semanas post-inicio (p.3)', () => {
    it('día 14 está dentro', () => {
      const r = withinTwoWeeksAfterStart(ctx({ fechaSolicitud: '2026-01-19' }).temporal);
      expect(r.value).toBe('TRUE');
    });

    it('día 15 ya está fuera', () => {
      const r = withinTwoWeeksAfterStart(ctx({ fechaSolicitud: '2026-01-20' }).temporal);
      expect(r.value).toBe('FALSE');
    });

    it('una solicitud posterior al inicio no cuenta como «antes del inicio»', () => {
      expect(beforeStart(ctx({ fechaSolicitud: SOLICITUD }).temporal).value).toBe('FALSE');
    });

    it('una solicitud previa al inicio sí lo es', () => {
      const r = beforeStart(ctx({ fechaSolicitud: '2026-01-01' }).temporal);
      expect(r.value).toBe('TRUE');
    });
  });

  describe('las dos ventanas son distintas', () => {
    it('hay días que están dentro de 20 días y fuera de 2 semanas', () => {
      // Día 18: dentro de la ventana de 20 días, fuera de la de 2 semanas.
      const temporal = ctx({ fechaSolicitud: '2026-01-23' }).temporal;
      expect(withinTwentyDaysOfStart(temporal).value).toBe('TRUE');
      expect(withinTwoWeeksAfterStart(temporal).value).toBe('FALSE');
    });
  });

  describe('domingos y semanas del ciclo', () => {
    it('isSunday reconoce sólo el domingo', () => {
      expect(isSunday('2026-01-04')).toBe(true); // domingo
      expect(isSunday('2026-01-05')).toBe(false); // lunes
    });

    it('firstSundayOnOrAfter devuelve el propio día si ya es domingo', () => {
      expect(firstSundayOnOrAfter('2026-01-04')).toBe('2026-01-04');
    });

    it('firstSundayOnOrAfter avanza hasta el domingo siguiente', () => {
      expect(firstSundayOnOrAfter('2026-01-05')).toBe('2026-01-11');
    });

    it('sundayOfWeek(2) cae en el segundo domingo del ciclo', () => {
      expect(sundayOfWeek(INICIO, 2)).toBe('2026-01-18');
    });

    it('el domingo de la semana 2 es el límite de la solicitud de CV', () => {
      const dentro = beforeSundayOfWeekTwo(ctx({ fechaSolicitud: '2026-01-17' }).temporal);
      const fuera = beforeSundayOfWeekTwo(ctx({ fechaSolicitud: '2026-01-19' }).temporal);
      expect(dentro.value).toBe('TRUE');
      expect(fuera.value).toBe('FALSE');
    });
  });

  describe('irreversibilidad de la semana 3', () => {
    it('antes del domingo de la semana 3 el cambio de opinión sigue abierto', () => {
      const r = afterWeekThreeIrreversibility(ctx({ fechaSolicitud: '2026-01-19' }).temporal);
      expect(r.value).toBe('FALSE');
    });

    it('el último día de la semana 3 sigue dentro del plazo', () => {
      // `N-103` da plazo «hasta la semana 3»: el día 21 (2026-01-26) es el
      // último día con plazo, y `N-104` sólo cierra «una vez concluido».
      const r = afterWeekThreeIrreversibility(ctx({ fechaSolicitud: '2026-01-26' }).temporal);
      expect(r.value).toBe('FALSE');
    });

    it('al concluir la semana 3 el cambio de opinión ya no aplica', () => {
      const r = afterWeekThreeIrreversibility(ctx({ fechaSolicitud: '2026-01-27' }).temporal);
      expect(r.value).toBe('TRUE');
    });
  });

  describe('aritmética de fechas', () => {
    it('daysBetween cuenta días naturales', () => {
      expect(daysBetween('2026-01-05', '2026-01-25')).toBe(20);
      expect(daysBetween('2026-01-25', '2026-01-05')).toBe(-20);
    });

    it('parseIsoDate rechaza formatos no ISO', () => {
      expect(() => parseIsoDate('05/01/2026')).toThrow();
    });

    it('parseIsoDate rechaza fechas imposibles', () => {
      expect(() => parseIsoDate('2026-02-30')).toThrow();
    });
  });

  describe('el reloj no se lee dentro del motor', () => {
    it('la misma entrada temporal da el mismo veredicto en cualquier momento', () => {
      const temporal = ctx({ fechaSolicitud: '2026-01-25' }).temporal;
      const a = withinTwentyDaysOfStart(temporal);
      const b = withinTwentyDaysOfStart(temporal);
      expect(a).toEqual(b);
    });

    it('una fecha de solicitud futura no altera la ventana ya decidida', () => {
      // El motor no puede "adelantarse": sólo lee lo que el llamador le da.
      const evaluacion = evaluateAudit({
        facts: [bool('F-calificaciones_bimestre_1', true)],
        evidenceContext: ctx({ fechaSolicitud: '2030-01-01' }),
        policyVersion: POLICY_VERSION,
      });
      expect(evaluacion.normativeOutcome).toBe('BAJA');
    });
  });
});
