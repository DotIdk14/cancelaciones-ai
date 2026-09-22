import { NextResponse, type NextRequest } from 'next/server';
import { createAuditLogRepository, createAuditManualCommentsRepository, createAuditRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

type ManualCommentPayload = {
  backOfficeComment?: string | null;
  helpdeskComment?: string | null;
  schoolServicesComment?: string | null;
  financeComment?: string | null;
  additionalComment?: string | null;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildPayload(raw: Record<string, unknown>): ManualCommentPayload {
  return {
    backOfficeComment: normalizeText(raw.back_office_comment ?? raw.backOfficeComment),
    helpdeskComment: normalizeText(raw.helpdesk_comment ?? raw.helpdeskComment),
    schoolServicesComment: normalizeText(raw.school_services_comment ?? raw.schoolServicesComment),
    financeComment: normalizeText(raw.finance_comment ?? raw.financeComment),
    additionalComment: normalizeText(raw.additional_comment ?? raw.additionalComment),
  };
}

async function authorized(auditId: string) {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 }) };
  const client = await createInsForgeServerClient();
  const audit = await createAuditRepository(client.database).findById(auditId);
  if (!audit) return { response: NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 }) };
  if (audit.createdBy !== user.id) return { response: NextResponse.json({ error: 'FORBIDDEN', message: 'No puede operar esta auditoria.' }, { status: 403 }) };
  return { user, client, audit };
}

async function saveComments(request: NextRequest, auditId: string, auth: { user: any; client: any }) {
  const contentType = request.headers.get('content-type') ?? '';
  let payload: Record<string, unknown> = {};

  if (contentType.includes('application/json')) {
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON', message: 'JSON invalido.' }, { status: 400 });
    }
  } else {
    const form = await request.formData().catch(() => null);
    payload = Object.fromEntries(form?.entries() ?? []);
  }

  const normalized = buildPayload(payload);
  const repo = createAuditManualCommentsRepository(auth.client.database);
  const previous = await repo.findByAudit(auditId);
  const saved = await repo.upsert({ auditId, actorId: auth.user.id, comments: normalized });

  const previousValues = {
    backOfficeComment: previous?.backOfficeComment ?? null,
    helpdeskComment: previous?.helpdeskComment ?? null,
    schoolServicesComment: previous?.schoolServicesComment ?? null,
    financeComment: previous?.financeComment ?? null,
    additionalComment: previous?.additionalComment ?? null,
  };

  const fieldsChanged = (Object.keys(normalized) as Array<keyof ManualCommentPayload>).filter((key) => {
    const nextValue = normalized[key] ?? null;
    const previousValue = previousValues[key] ?? null;
    return previousValue !== nextValue;
  });

  await createAuditLogRepository(auth.client.database).record({
    auditId,
    eventType: 'AUDIT_MANUAL_COMMENTS_UPDATED',
    actorId: auth.user.id,
    metadata: {
      auditId,
      actor: auth.user.id,
      timestamp: new Date().toISOString(),
      fieldsChanged,
    },
  });

  if (contentType.includes('application/json')) {
    return NextResponse.json({ comments: saved, fieldsChanged }, { status: 200 });
  }

  return NextResponse.redirect(new URL(`/auditorias/${auditId}?commentsSaved=1`, request.url));
}

export async function GET(_request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorized(auditId);
  if ('response' in auth && auth.response) return auth.response;
  const comments = await createAuditManualCommentsRepository(auth.client.database).findByAudit(auditId);
  return NextResponse.json({ comments });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorized(auditId);
  if ('response' in auth && auth.response) return auth.response;
  return saveComments(request, auditId, auth);
}

export async function POST(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorized(auditId);
  if ('response' in auth && auth.response) return auth.response;
  return saveComments(request, auditId, auth);
}
