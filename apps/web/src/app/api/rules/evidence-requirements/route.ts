import { createRuleGovernanceRepository } from '@cancelaciones/db';
import { requireOwner, requireUser } from '@/server/rules/auth';
import { databaseErrorResponse, invalidInputResponse, invalidJsonResponse, readJsonBody } from '@/server/rules/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < 0 ? undefined : parsed;
}

function parseOffset(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < 0 ? undefined : parsed;
}

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!('user' in auth)) return auth;
  const url = new URL(request.url);
  const ruleId = url.searchParams.get('ruleId');
  if (!ruleId) return Response.json({ error: 'INVALID_INPUT', message: 'ruleId es obligatorio.' }, { status: 400 });
  try {
    const requirements = await createRuleGovernanceRepository(auth.client.database).listEvidenceRequirements(ruleId, {
      limit: parseLimit(url.searchParams.get('limit')),
      offset: parseOffset(url.searchParams.get('offset')),
    });
    return Response.json({ requirements });
  } catch (error) {
    return databaseErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireOwner();
  if (!('user' in auth)) return auth;
  const url = new URL(request.url);
  const ruleId = url.searchParams.get('ruleId');
  if (!ruleId) return Response.json({ error: 'INVALID_INPUT', message: 'ruleId es obligatorio.' }, { status: 400 });
  const body = await readJsonBody<Record<string, unknown>>(request);
  if (!body) return invalidJsonResponse();
  const requirementKey = typeof body.requirementKey === 'string' ? body.requirementKey.trim() : '';
  const evidenceType = typeof body.evidenceType === 'string' ? body.evidenceType : '';
  if (!requirementKey) return invalidInputResponse('requirementKey es obligatorio.');
  if (!evidenceType) return invalidInputResponse('evidenceType es obligatorio.');
  try {
    const requirement = await createRuleGovernanceRepository(auth.client.database).createEvidenceRequirement({
      ruleId,
      requirementKey,
      evidenceType: evidenceType as never,
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      evidenceCode: typeof body.evidenceCode === 'string' ? body.evidenceCode : undefined,
      documentRole: typeof body.documentRole === 'string' ? (body.documentRole as never) : undefined,
      required: typeof body.required === 'boolean' ? body.required : undefined,
      minCount: typeof body.minCount === 'number' ? body.minCount : undefined,
      maxCount: typeof body.maxCount === 'number' ? body.maxCount : undefined,
      orderIndex: typeof body.orderIndex === 'number' ? body.orderIndex : undefined,
      metadata: typeof body.metadata === 'object' && body.metadata !== null ? (body.metadata as Record<string, unknown>) : undefined,
    });
    return Response.json({ requirement }, { status: 201 });
  } catch (error) {
    return databaseErrorResponse(error);
  }
}