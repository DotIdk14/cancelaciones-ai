/**
 * Primitivas temporales deterministas.
 *
 * ## Por qué existe este módulo
 *
 * Phase 1 identificó **siete** umbrales temporales en conflicto y Phase 1.5
 * añadió más (`XDC-04`: el «bimestre» no tiene duración declarada). Este módulo
 * NO resuelve ninguno de esos conflictos: calcula ventanas y devuelve
 * `CROSS_DOCUMENT_CONFLICT` cuando dos ventanas declaradas no son
 * reconciliables.
 *
 * ## Pureza
 *
 * No hay `Date.now()`, ni zona horaria implícita, ni `new Date()` sin
 * argumento. Todas las fechas son cadenas ISO `YYYY-MM-DD` y toda aritmética es
 * entera sobre días UTC. Mismo contexto ⇒ mismo resultado, siempre.
 *
 * ## Convención de días
 *
 * `daysBetween(a, b)` devuelve el número de días **de calendario** de `a` a
 * `b` (positivo si `b` es posterior). Un día es un día calendario. La fuente
 * mezcla «días hábiles» (`N-07`, p.2) con «días» (`N-114`, p.18): esa
 * divergencia es `AMB-DEF-01` y se expone como
 * `desercionUnit`, no se resuelve aquí.
 */

import type { TemporalContext } from './contracts';

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Resultado de una comparación temporal. */
export type TemporalValue = 'TRUE' | 'FALSE' | 'UNKNOWN';

/** Excepción de ventana temporal: conflicto entre fuentes. */
export interface TemporalConflict {
  readonly conflictId: string;
  readonly detail: string;
}

/** Resultado de una ventana temporal evaluada. */
export interface TemporalResult {
  readonly value: TemporalValue;
  readonly reason: string;
  /** Detalle numérico para la traza (días, semanas, porcentaje). */
  readonly measured: number | null;
  readonly conflicts: readonly TemporalConflict[];
}

function ok(value: TemporalValue, reason: string, measured: number | null = null): TemporalResult {
  return { value, reason, measured, conflicts: [] };
}

function unknown(reason: string, conflicts: readonly TemporalConflict[] = []): TemporalResult {
  return { value: 'UNKNOWN', reason, measured: null, conflicts };
}

/** Valida y parsea una fecha ISO. Lanza si el formato no es `YYYY-MM-DD`. */
export function parseIsoDate(value: string): number {
  if (!ISO_DATE.test(value)) {
    throw new TypeError(`Fecha inválida: se esperaba YYYY-MM-DD y se recibió "${value}".`);
  }
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(time)) {
    throw new TypeError(`Fecha inválida: "${value}" no es una fecha real.`);
  }
  // `Date.parse` no rechaza las fechas que no existen: `2026-02-30` se convierte
  // en `2026-03-02` sin avisar. Eso desplazaría en silencio todas las ventanas
  // temporales calculadas desde ese día, así que se verifica el viaje redondo.
  const parsed = new Date(time);
  const roundTrip = `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())}`;
  if (roundTrip !== value) {
    throw new RangeError(`Fecha inexistente en el calendario: "${value}" se resolvería a ${roundTrip}.`);
  }
  return time;
}

/** Rellena a dos dígitos para el viaje redondo de `parseIsoDate`. */
function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Normaliza cualquier entrada a `YYYY-MM-DD`, o `null` si no es fecha. */
export function toIsoDate(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (ISO_DATE.test(value)) return value;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}

/** Días de calendario de `from` a `to`. Negativo si `to` es anterior. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseIsoDate(to) - parseIsoDate(from)) / MS_PER_DAY);
}

/** Suma días a una fecha ISO. */
export function addDays(date: string, days: number): string {
  return new Date(parseIsoDate(date) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Suma meses a una fecha ISO conservando el día cuando existe. */
export function addMonths(date: string, months: number): string {
  const base = parseIsoDate(date);
  const target = new Date(base);
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Día de la semana en UTC: 0 = domingo … 6 = sábado. */
export function dayOfWeek(date: string): number {
  return new Date(parseIsoDate(date)).getUTCDay();
}

/** ¿La fecha es domingo? Base de `N-29` (p.4) y `N-68` (p.12). */
export function isSunday(date: string): boolean {
  return dayOfWeek(date) === 0;
}

/**
 * Primer domingo **en o después** de `from`.
 *
 * `N-29` (p.4) «primer domingo del inicio del ciclo» y `N-68` (p.12) «domingo
 * de la semana 2». No son el mismo día: el primero cierra la semana 1, el
 * segundo la semana 2. `AMB-TEM-06` es la falta de orden entre ambos, y este
 * módulo **no** la resuelve.
 */
export function firstSundayOnOrAfter(from: string): string {
  const delta = (7 - dayOfWeek(from)) % 7;
  return addDays(from, delta);
}

/** Domingo que cierra la semana `week` (1-indexada) contada desde `from`. */
export function sundayOfWeek(from: string, week: number): string {
  if (!Number.isInteger(week) || week < 1) {
    throw new RangeError(`La semana debe ser un entero >= 1; se recibió ${week}.`);
  }
  return addDays(firstSundayOnOrAfter(from), (week - 1) * 7);
}

// ---------------------------------------------------------------------------
// Ventanas del primario
// ---------------------------------------------------------------------------

/**
 * `N-35` (p.5): 20 días desde el inicio del ciclo → cualquier solicitud es BAJA.
 * Ventana habilitante para el resto del árbol: `diasDesdeInicio <= 20`.
 */
export function withinTwentyDaysOfStart(context: TemporalContext): TemporalResult {
  if (!context.cicloFechaInicio || !context.fechaSolicitud) {
    return unknown('Requiere inicio de ciclo y fecha de solicitud.');
  }
  const days = daysBetween(context.cicloFechaInicio, context.fechaSolicitud);
  // El día 0 (la fecha de inicio misma) está **dentro** de la ventana: `N-35`
  // cuenta 20 días *transcurridos*, y al inicio no ha transcurrido ninguno.
  // Sólo una solicitud anterior al inicio queda fuera de esta ventana, porque
  // pertenece a `N-26`/`N-27` y no al devengo de servicio.
  return days < 0 || days > 20
    ? ok('FALSE', `Solicitud a día ${days} del inicio: fuera de la ventana de 20 días (N-35, p.5).`, days)
    : ok('TRUE', `Solicitud a día ${days} del inicio: dentro de la ventana de 20 días (N-35, p.5).`, days);
}

/**
 * `N-15` (p.3): 2 semanas **después** de la fecha de inicio.
 * Solo gobierna la *solicitud* de CV.
 */
export function withinTwoWeeksAfterStart(context: TemporalContext): TemporalResult {
  if (!context.cicloFechaInicio || !context.fechaSolicitud) {
    return unknown('Requiere inicio de ciclo y fecha de solicitud.');
  }
  const days = daysBetween(context.cicloFechaInicio, context.fechaSolicitud);
  return days <= 0 || days > 14
    ? ok('FALSE', `Solicitud a día ${days}: fuera de las 2 semanas post-inicio (N-15, p.3).`, days)
    : ok('TRUE', `Solicitud a día ${days}: dentro de las 2 semanas post-inicio (N-15, p.3).`, days);
}

/** `N-27` (p.4) / `N-26` (p.4): solicitud **antes** del inicio. */
export function beforeStart(context: TemporalContext): TemporalResult {
  if (!context.cicloFechaInicio || !context.fechaSolicitud) {
    return unknown('Requiere inicio de ciclo y fecha de solicitud.');
  }
  const days = daysBetween(context.cicloFechaInicio, context.fechaSolicitud);
  return days < 0
    ? ok('TRUE', `Solicitud ${-days} día(s) antes del inicio (N-26, p.4).`, days)
    : ok('FALSE', `La solicitud no es anterior al inicio.`, days);
}

/**
 * `N-68` (p.12): límite de ilocalizable = domingo de la semana 2.
 */
export function beforeSundayOfWeekTwo(context: TemporalContext): TemporalResult {
  if (!context.cicloFechaInicio || !context.fechaSolicitud) {
    return unknown('Requiere inicio de ciclo y fecha de solicitud.');
  }
  const limit = sundayOfWeek(context.cicloFechaInicio, 2);
  const days = daysBetween(context.cicloFechaInicio, context.fechaSolicitud);
  return context.fechaSolicitud <= limit
    ? ok('TRUE', `Día ${days}: dentro del límite del domingo de semana 2 (${limit}, N-68, p.12).`, days)
    : ok('FALSE', `Día ${days}: supera el domingo de semana 2 (${limit}, N-68, p.12).`, days);
}

/**
 * `N-29` (p.4): límite de solicitud con D35/D53 tardía = primer domingo del ciclo.
 */
export function beforeFirstSundayOfCycle(context: TemporalContext): TemporalResult {
  if (!context.cicloFechaInicio || !context.fechaSolicitud) {
    return unknown('Requiere inicio de ciclo y fecha de solicitud.');
  }
  const limit = firstSundayOnOrAfter(context.cicloFechaInicio);
  return context.fechaSolicitud <= limit
    ? ok('TRUE', `Dentro del primer domingo del ciclo (${limit}, N-29, p.4).`)
    : ok('FALSE', `Supera el primer domingo del ciclo (${limit}, N-29, p.4).`);
}

/**
 * `N-103` (p.17): cierre financiero en semana 3. **Frontera de irreversibilidad**,
 * no condición de entrada: pasado el plazo el estatus CV↔baja es inmutable.
 */
export function afterWeekThreeIrreversibility(context: TemporalContext): TemporalResult {
  if (!context.cicloFechaInicio || !context.fechaSolicitud) {
    return unknown('Requiere inicio de ciclo y fecha de solicitud.');
  }
  const limit = addDays(context.cicloFechaInicio, 21);
  const past = context.fechaSolicitud > limit;
  return ok(
    past ? 'TRUE' : 'FALSE',
    past
      ? `Semana 3 superada (límite ${limit}): el estatus CV↔baja es inmutable (N-103, p.17).`
      : `Dentro de la semana 3 (límite ${limit}, N-103, p.17).`,
    daysBetween(context.cicloFechaInicio, context.fechaSolicitud),
  );
}

/**
 * `N-35` (p.5) / umbral 1: límite para cambios o ajustes = 1 día antes del inicio.
 */
export function oneDayBeforeStart(context: TemporalContext): TemporalResult {
  if (!context.cicloFechaInicio || !context.fechaSolicitud) {
    return unknown('Requiere inicio de ciclo y fecha de solicitud.');
  }
  const limit = addDays(context.cicloFechaInicio, -1);
  return context.fechaSolicitud <= limit
    ? ok('TRUE', `Dentro del límite de 1 día previo al inicio (${limit}, N-35, p.5).`)
    : ok('FALSE', `Supera el límite de 1 día previo al inicio (${limit}, N-35, p.5).`);
}

// ---------------------------------------------------------------------------
// Ventanas D53
// ---------------------------------------------------------------------------

/**
 * `D53-06` (p.3): 6 meses **desde su ingreso** → BAJA.
 */
export function sixMonthsFromEntry(context: TemporalContext): TemporalResult {
  if (!context.fechaIngreso) return unknown('Requiere fecha de ingreso para el plazo de 6 meses.');
  const reference = context.fechaSolicitud ?? context.cicloFechaInicio;
  if (!reference) return unknown('Requiere fecha de solicitud o inicio de ciclo como fecha de corte.');
  const limit = addMonths(context.fechaIngreso, 6);
  return reference > limit
    ? ok('TRUE', `Plazo de 6 meses desde el ingreso agotado (${limit}, D53-06, p.3).`)
    : ok('FALSE', `Dentro del plazo de 6 meses desde el ingreso (${limit}, D53-06, p.3).`);
}

/**
 * `G-08` (p.6): 6 meses **posteriores al inicio del primer ciclo académico**.
 *
 * Ancla distinta de `D53-06`. La colisión entre ambos anclajes es `XDC-03`: este
 * módulo calcula ambas ventanas y señala el conflicto, no elige un ancla.
 */
export function sixMonthsFromFirstCycle(context: TemporalContext): TemporalResult {
  if (!context.inicioPrimerCiclo) {
    return unknown('Requiere inicio del primer ciclo académico para el plazo de 6 meses (G-08, p.6).');
  }
  const reference = context.fechaSolicitud ?? context.cicloFechaInicio;
  if (!reference) return unknown('Requiere fecha de solicitud o inicio de ciclo como fecha de corte.');
  const limit = addMonths(context.inicioPrimerCiclo, 6);
  return reference > limit
    ? ok('TRUE', `Plazo de 6 meses tras el primer ciclo agotado (${limit}, G-08, p.6).`)
    : ok('FALSE', `Dentro del plazo de 6 meses tras el primer ciclo (${limit}, G-08, p.6).`);
}

/**
 * Compara los dos anclajes de 6 meses.
 *
 * Coinciden salvo que el alumno cambie de ciclo o se reinscriba a mitad de
 * ciclo. Cuando discrepan, el caso alcanza `XDC-03`.
 */
export function compareSixMonthAnchors(
  context: TemporalContext,
): { agree: boolean; conflict?: TemporalConflict; detail: string } {
  const fromEntry = sixMonthsFromEntry(context);
  const fromCycle = sixMonthsFromFirstCycle(context);
  if (fromEntry.value === 'UNKNOWN' || fromCycle.value === 'UNKNOWN') {
    return { agree: false, detail: 'Al menos un ancla no es evaluable.' };
  }
  if (fromEntry.value === fromCycle.value) {
    return { agree: true, detail: 'Ambas ventanas de 6 meses coinciden en este caso.' };
  }
  return {
    agree: false,
    detail:
      `Las ventanas de 6 meses divergen: «desde su ingreso» (D53-06, p.3) da ` +
      `${fromEntry.value} y «desde el inicio del primer ciclo» (G-08, p.6) da ${fromCycle.value}.`,
    conflict: {
      conflictId: 'XDC-03',
      detail: 'Anclaje del plazo de 6 meses: D53-06 (desde el ingreso) vs G-08 (desde el primer ciclo).',
    },
  };
}

/**
 * `D53-04` / `D53-05` (p.3): 50 % de avance curricular → BAJA documental.
 *
 * `AMB-TEM-07`: `D53-05` declara que el 50 % «no es fija» y que se «pretende
 * reducirla». El texto es intención de reforma, no derogación: la regla se
 * implementa **activa** y la ambigüedad se expone como conflicto, porque
 * desactivarla sería inventar una derogación que la fuente no contiene.
 */
export function fiftyPercentAdvanceReached(context: TemporalContext): TemporalResult {
  if (context.avanceCurricularPercent === null) {
    return unknown('Requiere avance curricular para evaluar el umbral del 50 % (D53-04, p.3).');
  }
  if (context.avanceCurricularPercent < 0 || context.avanceCurricularPercent > 100) {
    throw new RangeError(
      `El avance curricular debe estar entre 0 y 100; se recibió ${context.avanceCurricularPercent}.`,
    );
  }
  return context.avanceCurricularPercent >= 50
    ? ok('TRUE', `Avance curricular de ${context.avanceCurricularPercent} %: umbral del 50 % alcanzado (D53-04, p.3).`, context.avanceCurricularPercent)
    : ok('FALSE', `Avance curricular de ${context.avanceCurricularPercent} %: por debajo del 50 % (D53-04, p.3).`, context.avanceCurricularPercent);
}

/**
 * `D53-11` (p.4): cierre de aula = miércoles de la semana 3 **del bimestre**.
 *
 * ⚠ El bimestre no tiene duración declarada. `G-29` (p.29) dice que el ciclo
 * dura 14 semanas y `G-31` (p.29) suma 26 semanas para un bimestre. Sin
 * duración de bimestre no se puede calcular la fecha del miércoles de semana 3
 * → `XDC-04`. Este módulo devuelve `UNKNOWN` con el conflicto explícito en vez
 * de asumir 7 semanas.
 */
export function d53ClassroomClosureWednesday(
  context: TemporalContext,
): TemporalResult & { conflicts: readonly TemporalConflict[] } {
  if (!context.inicioPrimerCiclo) {
    return unknown('Requiere inicio de ciclo para el cierre de aula D53.');
  }
  return {
    value: 'UNKNOWN',
    reason:
      'El cierre de aula D53 es el miércoles de la semana 3 del bimestre, pero ninguna fuente ' +
      'sellada declara la duración del bimestre (G-29 dice ciclo de 14 semanas; G-31 suma 26).',
    measured: null,
    conflicts: [
      {
        conflictId: 'XDC-04',
        detail: 'Duración del bimestre sin declarar: no se puede calcular la fecha del cierre de aula.',
      },
    ],
  };
}

/**
 * `D53-17` (p.6): CV durante el **primer mes** de ingreso.
 *
 * La ventana de D53 cae después del punto de irreversibilidad de la semana 3
 * declarado en el primario (p.17, 5.9). `XDC-01`.
 */
export function withinFirstMonthOfEntry(context: TemporalContext): TemporalResult {
  if (!context.fechaIngreso || !context.fechaSolicitud) {
    return unknown('Requiere fecha de ingreso y fecha de solicitud (D53-17, p.6).');
  }
  const days = daysBetween(context.fechaIngreso, context.fechaSolicitud);
  return days >= 0 && days <= 30
    ? ok('TRUE', `Solicitud a día ${days} del ingreso: dentro del primer mes (D53-17, p.6).`, days)
    : ok('FALSE', `Solicitud a día ${days} del ingreso: fuera del primer mes (D53-17, p.6).`, days);
}

// ---------------------------------------------------------------------------
// Conflicto de ventana de CV
// ---------------------------------------------------------------------------

/**
 * Compara las tres ventanas de cancelación de venta declaradas.
 *
 * - Primario `N-25` (p.6): 2 semanas **después** del inicio.
 * - Glosario `G-13` (p.7): 2 semanas **del ciclo** o **antes** del inicio.
 * - D53 `D53-17` (p.6): **primer mes**.
 *
 * Primario y Glosario son mayormente compatibles. D53 es incompatible con la
 * irreversibilidad de la semana 3 del primario. El motor **no** elige lectura:
 * devuelve el conflicto.
 */
export function compareCancellationWindows(context: TemporalContext): {
  conflict: TemporalConflict | null;
  detail: string;
  values: { primary: TemporalValue; glossary: TemporalValue; d53: TemporalValue };
} {
  const primary = withinTwoWeeksAfterStart(context);
  const d53 = withinFirstMonthOfEntry(context);
  const irreversible = afterWeekThreeIrreversibility(context);

  let glossary: TemporalValue = 'UNKNOWN';
  if (primary.value === 'UNKNOWN' || d53.value === 'UNKNOWN') {
    glossary = 'UNKNOWN';
  } else if (primary.value === 'TRUE') {
    glossary = 'TRUE';
  } else {
    // Fuera de las 2 semanas post-inicio: el Glosario mantiene la CV solo si
    // la solicitud fue anterior al inicio.
    glossary = beforeStart(context).value;
  }

  const values = { primary: primary.value, glossary, d53: d53.value };
  const differ = new Set(Object.values(values)).size > 1;

  if (!differ) {
    return { conflict: null, detail: 'Las tres ventanas de CV coinciden en este caso.', values };
  }

  const detail =
    `Las ventanas de CV divergen en este caso: primario 2 sem post-inicio = ${values.primary}, ` +
    `Glosario 2 sem del ciclo o pre-inicio = ${values.glossary}, D53 primer mes = ${values.d53}.`;

  const aggravated = irreversible.value === 'TRUE' && d53.value === 'TRUE';
  return {
    conflict: {
      conflictId: 'XDC-01',
      detail: aggravated
        ? `${detail} Agravante: la ventana de D53 (≈semana 4) cae después del punto de ` +
          'irreversibilidad CV↔baja declarado en el primario (p.17, 5.9), por lo que es ' +
          'prácticamente inalcanzable.'
        : detail,
    },
    detail,
    values,
  };
}

// ---------------------------------------------------------------------------
// unidad de deserción
// ---------------------------------------------------------------------------

/** Unidad de la definición de deserción. `AMB-DEF-01`: la fuente se contradice. */
export type DesercionUnit = 'DIAS_HABILES' | 'DIAS_CALENDARIO' | 'UNKNOWN';

/**
 * `N-07` (p.2) dice «30 días **hábiles**»; `N-114` (p.18) dice «30 días».
 * `AMB-DEF-01` sigue abierto. Se expone el conflicto; no se elige unidad.
 */
export const DESERCION_UNIT_CONFLICT: TemporalConflict = {
  conflictId: 'AMB-DEF-01',
  detail:
    'La definición de deserción diverge: N-07 (p.2) declara 30 días hábiles y N-114 (p.18) ' +
    'declara 30 días. Ninguna fuente sellada establece precedencia.',
};
