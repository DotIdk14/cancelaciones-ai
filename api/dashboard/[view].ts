import { z } from 'zod';
import {
  handleRoute,
  ok,
  methodNotAllowed,
  ApiError,
  type QueryValue,
} from '../../src/server/http.js';
import { createServerClient } from '../../src/server/insforge.js';
import { parseDashboardFilters } from '../../src/server/dashboard-filters.js';
import {
  getAiCosts,
  getAiQuality,
  getDashboardFilterOptions,
  getDashboardSummary,
} from '../../src/server/dashboard.js';

// Vercel Hobby admite 12 Functions por deployment y, en un proyecto sin
// framework, cada archivo de `api/` es una Function. Los cuatro GET del
// dashboard salen de UNA sola función con el segmento dinámico `[view]`, de modo
// que las URLs públicas no cambian y el cliente no se entera:
//   GET /api/dashboard/summary  → 200 { summary }
//   GET /api/dashboard/quality  → 200 { quality }
//   GET /api/dashboard/ai-costs → 200 { costs }
//   GET /api/dashboard/options  → 200 { options }
const VIEWS = ['summary', 'ai-costs', 'quality', 'options'] as const;
type View = (typeof VIEWS)[number];

/**
 * Vocabulario cerrado: una vista que no existe es 404, no un 400 que adivine
 * cuál quiso pedir. Responde 404 y no 403 para no confirmar nada sobre el
 * despliegue (NO_RESOURCE_EXISTENCE_LEAK).
 */
function requiredView(query: Record<string, QueryValue>): View {
  const value = query.view;
  if (typeof value !== 'string' || !VIEWS.includes(value as View)) {
    throw new ApiError(404, 'NOT_FOUND', 'Vista de dashboard no encontrada');
  }
  return value as View;
}

// Vocabulario cerrado y el único filtro propio de la vista `ai-costs`. El resto
// de los params (`from`, `to`, `result`, `status`, `country`, `channel`) los valida
// `parseDashboardFilters`, que ya sabe redactar en español el 400.
const GranularitySchema = z.enum(['day', 'week', 'month'], {
  errorMap: () => ({ message: 'Granularidad no válida. Opciones: day, week, month.' }),
});

// `?granularity=` ausente o vacío -> `day`. Repetido (`?granularity=day&granularity=week`)
// es ambiguo y adivinar cuál vale sería inventar criterio: 400.
function parseGranularity(query: Record<string, QueryValue>): 'day' | 'week' | 'month' {
  const value = query.granularity;
  if (Array.isArray(value)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'El parámetro "granularity" se recibió varias veces: envía un solo valor.',
    );
  }
  if (value === undefined || value.trim() === '') return 'day';
  const parsed = GranularitySchema.safeParse(value.trim());
  if (!parsed.success) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `Parámetro "granularity": ${parsed.error.issues[0]?.message ?? 'valor no válido.'}`,
    );
  }
  return parsed.data;
}

// GET /api/dashboard/:view?from&to&result&status&country&channel[&granularity=day|week|month]
export default handleRoute(async (req, res) => {
  // El método se resuelve ANTES que la vista: un 405 no puede depender de que el
  // path además sea una vista existente.
  if (req.method !== 'GET') {
    methodNotAllowed(req, res, 'GET');
    return;
  }
  const view = requiredView(req.query);
  const client = createServerClient();

  // `options` es la única vista sin filtros: devuelve el catálogo completo.
  if (view === 'options') {
    ok(res, { options: await getDashboardFilterOptions(client) });
    return;
  }

  const filters = parseDashboardFilters(req.query);
  if (view === 'summary') {
    ok(res, { summary: await getDashboardSummary(client, filters, req.auth) });
    return;
  }
  if (view === 'quality') {
    ok(res, { quality: await getAiQuality(client, filters, req.auth) });
    return;
  }
  const costs = await getAiCosts(client, filters, parseGranularity(req.query), req.auth);
  ok(res, { costs });
});