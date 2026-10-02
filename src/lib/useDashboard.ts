// =============================================================================
// Hooks de carga del dashboard. Aíslan el estado async (loading/error/data) de
// la página y garantizan que la petición se cancele al desmontar o al cambiar
// los filtros, para no pintar datos de un periodo que ya no está seleccionado.
//
// Reglas (comunes a todos los hooks de este archivo, implementadas UNA vez en
// `useDebouncedResource`):
//   - debounce: los `<input type="date">` disparan en cada pulsación, así que la
//     petición espera 250 ms de calma antes de salir;
//   - cancelación: `AbortController` propio, abortado al cambiar de filtros o
//     al desmontar, para que la respuesta tardía no pise la nueva;
//   - datos previos: un cambio de filtro NO vacía `data`; la pantalla mantiene
//     lo último conocido y solo se recorta cuando la respuesta llega. La ÚNICA
//     excepción es un `VALIDATION_ERROR`, que sí descarta lo anterior (ver
//     `toUiError`): si el servidor rechazó la consulta, lo que hay en pantalla
//     corresponde a otros filtros.
//
// POR QUÉ HAY TRES HOOKS PÚBLICOS Y NO UNO CON UNA UNIÓN DE ENDPOINTS
// (`'summary' | 'ai-costs' | 'quality'`): los informes tienen formas distintas y
// no superpuestas (`DashboardSummary`, `AiCostsReport` y `QualityReport`). Un
// hook único tendría que devolver una unión, y entonces CADA lectura (`data?.kpi`)
// en la página dejaría de estar tipada: habría que discriminar en cada uso, con un
// `in` o un type guard, y el compilador dejaría de avisar cuando un campo no
// existe. Con un hook por informe, cada página recibe exactamente el tipo que
// espera y `data` sigue siendo `null` o el informe completo, sin unión. La
// maquinaria común (debounce, cancelación, error, recarga) no se duplica: vive
// en el hook interno.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AiCostsReport,
  CostGranularity,
  DashboardFilterOptions,
  DashboardFilters,
  DashboardSummary,
  QualityReport,
} from './dashboard';
import {
  DASHBOARD_DIMENSIONS,
  fetchAiCosts,
  fetchAiQuality,
  fetchDashboardOptions,
  fetchDashboardSummary,
} from './dashboard';
import { toErrorState } from './api';

/** Estado async común a cualquier recurso del dashboard. */
export interface UseResourceResult<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

/** @deprecated Alias del resultado de `useDashboard`, conservado por compatibilidad. */
export type UseDashboardResult = UseResourceResult<DashboardSummary>;

/** Resultado de `useAiCosts`. */
export type UseAiCostsResult = UseResourceResult<AiCostsReport>;

/** Resultado de `useAiQuality`. */
export type UseAiQualityResult = UseResourceResult<QualityReport>;

/** Espera de calma antes de pedir el agregado al cambiar los filtros. */
const DEBOUNCE_MS = 250;

/** Mensajes por categoría de error. El detalle interno nunca llega al usuario. */
const CATEGORY_MESSAGES: Record<string, string> = {
  NOT_FOUND: 'No se encontraron datos para el periodo seleccionado.',
  RATE_LIMIT: 'Se recibieron demasiadas solicitudes. Espera un momento e intenta de nuevo.',
  AUTH_ERROR: 'La sesión con el servidor no es válida. Contacta al equipo de soporte.',
  PROVIDER_UNAVAILABLE: 'El servicio no está disponible en este momento. Intenta de nuevo.',
};

/** Fallback para cualquier categoría no contemplada (incluye `UNKNOWN`). */
const GENERIC_MESSAGE = 'No se pudo cargar la información. Intenta de nuevo en unos minutos.';

/**
 * `fetch` lanza esto al cancelar. Se distingue por nombre porque no todas las
 * plataformas lanzan un `DOMException` y no siempre es un `Error`.
 */
function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) return false;
  return (error as { name?: unknown }).name === 'AbortError';
}

/**
 * Traduce cualquier excepción al estado de error que se muestra, y dice además
 * si ese error obliga a DESCARTA los datos que ya había en pantalla.
 *
 * POR QUÉ SOLO UN TIPO DE ERROR DESCARTA, y no todos: hay dos fallos posibles y
 * se portan distinto.
 *
 *  - `VALIDATION_ERROR` (400: rango invertido, fecha inexistente, filtro
 *    inválido). El servidor RECHAZÓ la consulta, así que lo que hay en pantalla
 *    corresponde a OTROS filtros: los que había antes del cambio. Dejarlo puesto
 *    es peor que un hueco, porque los KPI seguirían moviéndose con un filtro que
 *    nunca llegó a aplicarse y nadie podría distinguir "no ha cargado" de "está
 *    mostrando esto". Se descarta y queda solo el error, que además dice qué
 *    está mal.
 *
 *  - Cualquier otra categoría (`DATABASE_ERROR`, `UNKNOWN`, `AUTH_ERROR`, red
 *    caída): el problema es de TRANSPORTE. La petición anterior sí se ejecutó y
 *    su respuesta sigue siendo válida para lo que dice; borrarla dejaría la
 *    pantalla vacía por un fallo pasajero y obligaría a esperar otra vuelta para
 *    recuperar un dato que ya se tenía. Se conserva.
 *
 * `VALIDATION_ERROR` devuelve el mensaje del servidor: ya está redactado para el
 * usuario y es accionable. El resto usa el mensaje por categoría, para que el
 * detalle interno (nombres de columna, mensajes del proveedor) nunca llegue a la
 * pantalla.
 */
function toUiError(error: unknown): { message: string; discardsPreviousData: boolean } {
  const { category, message } = toErrorState(error);
  if (category === 'VALIDATION_ERROR') {
    return { message, discardsPreviousData: true };
  }
  return { message: CATEGORY_MESSAGES[category] ?? GENERIC_MESSAGE, discardsPreviousData: false };
}

/**
 * Serializa los filtros a una clave: son un objeto nuevo en cada render.
 *
 * Las seis dimensiones entran ORDENADAS y no en el orden de inserción del
 * objeto. `JSON.stringify` respeta el orden de las claves, así que el mismo
 * filtro construido en dos renders distintos produciría dos claves si el orden
 * cambiara, y eso dispararía una petición de más sin que nadie la pidiera.
 */
function filterKeyOf(filters: DashboardFilters): string {
  const parts = [filters.from, filters.to, filters.result ?? '', filters.status ?? ''];
  for (const dimension of DASHBOARD_DIMENSIONS) {
    parts.push(filters[dimension] ?? '');
  }
  return parts.join('|');
}

/**
 * Motor común de carga: debounce, cancelación, conservación de datos previos y
 * recarga inmediata.
 *
 * `key` es lo único que dispara una petición. `fetcher` NO va en las
 * dependencias a propósito y, por el mismo motivo que en la versión anterior de
 * este hook, NO se memoriza en el padre: se captura la del render que creó el
 * efecto, que por construcción corresponde a ese `key`. Si se metiera en las
 * dependencias por identidad, cada render del padre (que crea un objeto de
 * filtros nuevo) dispararía una petición y la UI parpadearía sin parar.
 */
function useDebouncedResource<K extends string, T>(
  key: K,
  fetcher: (signal: AbortSignal) => Promise<T>,
): UseResourceResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(0);

  // `reload()` marca la siguiente pasada como inmediata para saltarse el debounce.
  // Arranca en `true` para que la PRIMERA carga de cada página salga ya: al
  // montar no hay nada que debouncear, y esperar 250 ms solo retrasaba el
  // time-to-data de las tres pantallas.
  const immediateRef = useRef(true);

  const reload = useCallback((): void => {
    immediateRef.current = true;
    setRequestId((n) => n + 1);
  }, []);

  useEffect(() => {
    const immediate = immediateRef.current;
    immediateRef.current = false;
    const controller = new AbortController();
    let cancelled = false;

    setIsLoading(true);
    setError(null);

    const run = (): void => {
      void fetcher(controller.signal).then(
        (result) => {
          if (cancelled) return;
          setData(result);
          setError(null);
          setIsLoading(false);
        },
        (cause: unknown) => {
          // Una petición cancelada no es un fallo: la reemplazó otra más nueva.
          if (cancelled || isAbortError(cause)) return;
          const { message, discardsPreviousData } = toUiError(cause);
          // ÚNICO punto donde se borra `data`. Solo lo hace un error de
          // validación, porque es el único caso en que lo que hay en pantalla
          // corresponde a filtros que ya no son los que se están mirando. Ver
          // el contrato completo en `toUiError`.
          if (discardsPreviousData) setData(null);
          setError(message);
          setIsLoading(false);
        },
      );
    };

    const timer: ReturnType<typeof setTimeout> | undefined = immediate
      ? undefined
      : setTimeout(run, DEBOUNCE_MS);

    if (timer === undefined) run();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
    // `fetcher` se omite a propósito: su identidad cambia en cada render, pero
    // la del render que creó este efecto es la correcta para este `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, requestId]);

  return { data, isLoading, error, reload };
}

/** Agregado de casos: KPIs, evolución, reparto y casos recientes. */
export function useDashboard(filters: DashboardFilters, endpoint: 'summary'): UseDashboardResult {
  // `endpoint` forma parte de la clave para que el hook siga siendo
  // parametrizable sin que un endpoint futuro pueda pintar el informe del otro.
  const key = `${endpoint}|${filterKeyOf(filters)}`;
  return useDebouncedResource<typeof key, DashboardSummary>(key, (signal) =>
    fetchDashboardSummary(filters, signal),
  );
}

/** Informe de costes de IA. `granularity` es parte de la clave: cambiarla recarga. */
export function useAiCosts(filters: DashboardFilters, granularity: CostGranularity): UseAiCostsResult {
  const key = `${granularity}|${filterKeyOf(filters)}`;
  return useDebouncedResource<typeof key, AiCostsReport>(key, (signal) =>
    fetchAiCosts(filters, granularity, signal),
  );
}

/**
 * Informe de calidad de la IA.
 *
 * Tercer hook público y no un caso especial de los otros dos, por la razón que
 * explica el cabecera del archivo: `QualityReport` tiene una forma propia
 * (`humanReview` + `confidence`) que no comparte campo útil con `AiCostsReport`
 * ni con `DashboardSummary`. Un hook único devolvería una unión y dejaría de
 * avisar al compilador cuando una página lee un campo que ese informe no tiene.
 */
export function useAiQuality(filters: DashboardFilters): UseAiQualityResult {
  const key = filterKeyOf(filters);
  return useDebouncedResource<typeof key, QualityReport>(key, (signal) =>
    fetchAiQuality(filters, signal),
  );
}

/** Resultado de `useDashboardOptions`. */
export type UseDashboardOptionsResult = UseResourceResult<DashboardFilterOptions>;

/**
 * Valores disponibles para los filtros de dimensión, en el periodo dado.
 *
 * Hook aparte y no parte de `useDashboard` porque su clave es SOLO el rango: los
 * menús se llenan con el periodo, no con los filtros ya aplicados, para que
 * cambiar de dimensión sea siempre posible sin limpiar antes. Si compartieran
 * clave, elegir "México" recargaría el menú ya filtrado por México y no se podría
 * saltar a "Online" sin un paso extra.
 */
export function useDashboardOptions(from: string, to: string): UseDashboardOptionsResult {
  const key = `${from}|${to}`;
  return useDebouncedResource<typeof key, DashboardFilterOptions>(key, (signal) =>
    fetchDashboardOptions(from, to, signal),
  );
}
