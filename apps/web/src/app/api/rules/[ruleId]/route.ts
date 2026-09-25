import { createRuleGovernanceRepository } from '@cancelaciones/db';
import { requireOwner } from '@/server/rules/auth';
import { databaseErrorResponse, invalidInputResponse, invalidJsonResponse, readJsonBody } from '@/server/rules/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request) {
  const auth = await requireOwner();
  if (!('user' in auth)) return auth;
  const url = new URL(request.url);
  const ruleId = url.searchParams.get('ruleId');
  if (!ruleId) return Response.json({ error: 'INVALID_INPUT', message: 'ruleId es obligatorio.' }, { status: 400 });
  const body = await readJsonBody<{ status?: unknown }>(request);
  if (!body) return invalidJsonResponse();
  const status = typeof body.status === 'string' ? body.status : '';
  if (!status) return invalidInputResponse('status es obligatorio.');
  try {
    const rule = await createRuleGovernanceRepository(auth.client.database).updateRuleStatus(ruleId, status as never);
    return Response.json({ rule });
  } catch (error) {
    return databaseErrorResponse(error);
  }
}