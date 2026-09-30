import { handleRoute, ok, methodNotAllowed } from '../../src/server/http.js';
import { createServerClient } from '../../src/server/insforge.js';
import { parseDashboardFilters } from '../../src/server/dashboard-filters.js';
import { getAiQuality } from '../../src/server/dashboard.js';

// GET /api/dashboard/quality?from&to&result&status → 200 { quality: QualityReport }
export default handleRoute(async (req, res) => {
  if (req.method !== 'GET') {
    methodNotAllowed(req, res, 'GET');
    return;
  }
  const filters = parseDashboardFilters(req.query);
  const client = createServerClient();
  const quality = await getAiQuality(client, filters);
  ok(res, { quality });
});
