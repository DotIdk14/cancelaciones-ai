import { createRuleGovernanceRepository } from '@cancelaciones/db';
import { requireOwner } from '@/server/rules/auth';
import { databaseErrorResponse, invalidJsonResponse, readJsonBody } from '@/server/rules/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request) {
  const auth = await requireOwner();
  if (!('user' in auth)) return auth;
  const url = new URL(request.url);
  const requirementId = url.searchParams.get('requirementId');
  if (!requirementId) return Response.json({ error: 'INVALID_INPUT', message: 'requirementId es obligatorio.' }, { status: 400 });
  const body = await readJsonBody<Record<string, unknown>>(request);
  if (!body) return invalidJsonResponse();
  try {
    const requirement = await createRuleGovernanceRepository(auth.client.database).updateEvidenceRequirement(requirementId, {
      requirementKey: typeof body.requirementKey === 'string' ? body.requirementKey.trim() : undefined,
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      evidenceType: typeof body.evidenceType === 'string' ? (body.evidenceType as never) : undefined,
      evidenceCode: typeof body.evidenceCode === 'string' ? body.evidenceCode : undefined,
      documentRole: typeof body.documentRole === 'string' ? (body.documentRole as never) : undefined,
      required: typeof body.required === 'boolean' ? body.required : undefined,
      minCount: typeof body.minCount === 'number' ? body.minCount : undefined,
      maxCount: typeof body.maxCount === 'number' ? body.maxCount : undefined,
      orderIndex: typeof body.orderIndex === 'number' ? body.orderIndex : undefined,
      metadata: typeof body.metadata === 'object' && body.metadata !== null ? (body.metadata as Record<string, unknown>) : undefined,
    });
    return Response.json({ requirement });
  } catch (error) {
    return databaseErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const auth = await requireOwner();
  if (!('user' in auth)) return auth;
  const url = new URL(request.url);
  const requirementId = url.searchParams.get('requirementId');
  if (!requirementId) return Response.json({ error: 'INVALID_INPUT', message: 'requirementId es obligatorio.' }, { status: 400 });
  try {
    await createRuleGovernanceRepository(auth.client.database).deleteEvidenceRequirement(requirementId);
    return Response.json({ deleted: true });
  } catch (error) {
    return databaseErrorResponse(error);
  }
}