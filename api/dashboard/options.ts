import { handleRoute, methodNotAllowed, ok } from '../../src/server/http.js';
import { createServerClient } from '../../src/server/insforge.js';
import { getDashboardFilterOptions } from '../../src/server/dashboard.js';

// GET /api/dashboard/options ÔåÆ 200 { options: DashboardFilterOptions }
export default handleRoute(async (req, res) => {
  if (req.method !== 'GET') {
    methodNotAllowed(req, res, 'GET');
    return;
  }
  const options = await getDashboardFilterOptions(createServerClient());
  ok(res, { options });
});
