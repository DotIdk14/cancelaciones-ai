import { createRuleGovernanceRepository } from '@cancelaciones/db';
import { requireOwner, requireUser } from '@/server/rules/auth';
import { databaseErrorResponse, invalidInputResponse, invalidJsonResponse, readJsonBody } from '@/server/rules/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireUser();
  if (!('user' in auth)) return auth;
  try {
    const rules = await createRuleGovernanceRepository(auth.client.database).listRules();
    return Response.json({ rules });
  } catch (error) {
    return databaseErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireOwner();
  if (!('user' in auth)) return auth;
  const body = await readJsonBody<{ ruleKey?: unknown; version?: unknown; name?: unknown; status?: unknown; createdBy?: unknown }>(request);
  if (!body) return invalidJsonResponse();
  const ruleKey = typeof body.ruleKey === 'string' ? body.ruleKey.trim() : '';
  const version = typeof body.version === 'string' ? body.version.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const status = typeof body.status === 'string' ? (body.status as 'DRAFT' | 'REVIEW' | 'APPROVED' | 'ACTIVE' | 'RETIRED') : undefined;
  if (!ruleKey || !version || !name) return invalidInputResponse('ruleKey, version y name son obligatorios.');
  try {
    const rule = await createRuleGovernanceRepository(auth.client.database).createRule({
      ruleKey,
      version,
      name,
      status,
      createdBy: auth.user.id,
    });
    return Response.json({ rule }, { status: 201 });
  } catch (error) {
    return databaseErrorResponse(error);
  }
}