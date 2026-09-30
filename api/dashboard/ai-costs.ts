import { z } from 'zod';
import { handleRoute, ok, methodNotAllowed, ApiError, type QueryValue } from '../../src/server/http.js';
import { createServerClient } from '../../src/server/insforge.js';
import { parseDashboardFilters } from '../../src/server/dashboard-filters.js';
import { getAiCosts } from '../../src/server/dashboard.js';

// Vocabulario cerrado y el único filtro propio de esta ruta. El resto de los
// params (`from`, `to`, `result`, `status`) los valida `parseDashboardFilters`,
// que ya sabe redactar en español el 400.
const GranularitySchema = z.enum(['day', 'week', 'month'], {
  errorMap: () => ({ message: 'Granularidad no válida. Opciones: day, week, month.' }),
});

// `?granularity=` ausente o vacío -> `day`. Repetido (`?granularity=day&granularity=week`)
// es ambiguo y adivinar cuál vale sería inventar criterio: 400.
function parseGranularity(query: Record<string, QueryValue>): 'day' | 'week' | 'month' {
  const value = query.granularity;
  if (Array.isArray(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'El parámetro "granularity" se recibió varias veces: envía un solo valor.');
  }
  if (value === undefined || value.trim() === '') return 'day';
  const parsed = GranularitySchema.safeParse(value.trim());
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Parámetro "granularity": ${parsed.error.issues[0]?.message ?? 'valor no válido.'}`);
  }
  return parsed.data;
}

// GET /api/dashboard/ai-costs?from&to&result&status&granularity=day|week|month → 200 { costs: AiCostsReport }
export default handleRoute(async (req, res) => {
  if (req.method !== 'GET') {
    methodNotAllowed(req, res, 'GET');
    return;
  }
  const filters = parseDashboardFilters(req.query);
  const granularity = parseGranularity(req.query);
  const client = createServerClient();
  const costs = await getAiCosts(client, filters, granularity);
  ok(res, { costs });
});
