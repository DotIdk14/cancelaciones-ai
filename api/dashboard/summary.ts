import { handleRoute, ok, methodNotAllowed } from '../../src/server/http.js';
import { createServerClient } from '../../src/server/insforge.js';
import { parseDashboardFilters } from '../../src/server/dashboard-filters.js';
import { getDashboardSummary } from '../../src/server/dashboard.js';

// GET /api/dashboard/summary?from&to&result&status → 200 { summary: DashboardSummary }
export default handleRoute(async (req, res) => {
  if (req.method !== 'GET') {
    methodNotAllowed(req, res, 'GET');
    return;
  }
  const filters = parseDashboardFilters(req.query);
  const client = createServerClient();
  const summary = await getDashboardSummary(client, filters, req.auth);
  ok(res, { summary });
});
