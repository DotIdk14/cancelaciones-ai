import { handleRoute, ok, created, methodNotAllowed, readJsonBody } from '../../src/server/http.js';
import { requireUser } from '../../src/server/auth.js';
import { createCase, listCaseSummaries } from '../../src/server/cases.js';
import { caseToSummary } from '../../src/server/dto.js';

// GET  /api/cases            → { cases: CaseSummary[] }
// POST /api/cases { studentIdentifier? } → 201 { case: CaseSummary }
export default handleRoute(async (req, res) => {
  const { user, client } = await requireUser(req, res);

  if (req.method === 'GET') {
    const rows = await listCaseSummaries(client);
    ok(res, { cases: rows.map(caseToSummary) });
    return;
  }

  if (req.method === 'POST') {
    const body = (await readJsonBody(req)) as { studentIdentifier?: unknown };
    const rawIdentifier = typeof body?.studentIdentifier === 'string' ? body.studentIdentifier.trim() : '';
    const studentIdentifier = rawIdentifier.length > 0 ? rawIdentifier.slice(0, 200) : null;
    const row = await createCase(client, user.id, studentIdentifier);
    created(res, { case: caseToSummary({ ...row, evidence: [] }) });
    return;
  }

  methodNotAllowed(req, res);
});