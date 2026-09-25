import { NextResponse, type NextRequest } from 'next/server';
import { createAuditRepository, createFactRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';
import { deriveFactRunFromReviews } from '@/server/facts/human-correction';

/**
 * `document_id` en `policy_source_registry` (migración 20260925120000, §11).
 * `create_derived_fact_run_v1` lo exige: sólo se deriva de una fuente de
 * política que el propietario haya registrado (ONLY_OWNER_PROVIDED_POLICY_SOURCES).
 */
const POLICY_SOURCE_ID = 'gdm-gam-prd-mlg-003-local-unverified';

async function authorized(auditId: string) {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 }) };
  const client = await createInsForgeServerClient();
  const audit = await createAuditRepository(client.database).findById(auditId);
  if (!audit) return { response: NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 }) };
  if (audit.createdBy !== user.id) return { response: NextResponse.json({ error: 'FORBIDDEN', message: 'No puede revisar esta auditoria.' }, { status: 403 }) };
  return { user, client };
}

export async function GET(_request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorized(auditId);
  if (auth.response) return auth.response;
  const result = await auth.client.database.from('fact_reviews').select('*').eq('audit_id', auditId).order('created_at', { ascending: false });
  if (result.error) return NextResponse.json({ error: 'DATABASE_ERROR', message: result.error.message }, { status: 500 });
  return NextResponse.json({ reviews: result.data ?? [] });
}

/**
 * ============================================================================
 * Step 4: una corrección humana NO reescribe el Fact Run congelado
 * ============================================================================
 * La review se guarda append-only exactamente igual que antes y la respuesta
 * conserva `{ review }` con 201. Lo que se AÑADE es `derivedFactRunId`: cuando
 * la review trae `correctedValue`, se deriva un Fact Run NUEVO con esa
 * corrección, su motivo, su autor y su instante. El run padre no recibe ni un
 * UPDATE (`guard_frozen_fact_run_row` lo impediría, y `PRESERVE_MACHINE_DECISION`
 * lo exige), de modo que la evaluación que ya se registró no se reescribe: la
 * corrección produce una versión nueva y trazable.
 *
 * POR QUÉ UN FALLO AL DERIVAR NO ES UN 500
 * La review ya está en la base y es append-only: no se puede borrar. Devolver
 * 500 invitaría al cliente a reintentar y duplicaría evidencia humana. Por eso la
 * respuesta sigue siendo 201 con `derivedFactRunId: null` y un bloque
 * `derivation` con el código y el mensaje, más un aviso en el log del servidor.
 * El fallo queda declarado, no se traga.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await context.params;
  const auth = await authorized(auditId);
  if (auth.response) return auth.response;
  let body: { factId?: string; decision?: 'VALID' | 'INVALID'; correctedValue?: unknown; note?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'INVALID_JSON', message: 'JSON invalido.' }, { status: 400 }); }
  if (!body.factId || !body.decision) return NextResponse.json({ error: 'INVALID_INPUT', message: 'factId y decision son obligatorios.' }, { status: 400 });
  const fact = await createFactRepository(auth.client.database).findFactById(body.factId);
  if (!fact || fact.auditId !== auditId) return NextResponse.json({ error: 'FACT_NOT_FOUND', message: 'Dato no encontrado.' }, { status: 404 });
  const inserted = await auth.client.database.from('fact_reviews').insert([{
    audit_id: auditId, fact_id: body.factId, decision: body.decision,
    status: body.decision === 'VALID' ? 'ACCEPTED' : 'REJECTED',
    corrected_value: body.correctedValue ?? null, note: body.note?.trim() || null,
    note_sanitized: body.note?.trim() || null, reviewed_by: auth.user.id,
  }]).select('*').single();
  if (inserted.error || !inserted.data) return NextResponse.json({ error: 'DATABASE_ERROR', message: inserted.error?.message ?? 'No fue posible guardar la revisión.' }, { status: 500 });

  const hasCorrection = body.correctedValue !== undefined && body.correctedValue !== null;
  if (!hasCorrection) {
    return NextResponse.json({ review: inserted.data, derivedFactRunId: null, derivation: { status: 'NOT_APPLICABLE', code: 'NO_CORRECTED_VALUE' } }, { status: 201 });
  }

  try {
    const derived = await deriveFactRunFromReviews({
      database: auth.client.database,
      auditId,
      factId: body.factId,
      correctedValue: body.correctedValue,
      review: {
        reviewId: String((inserted.data as { id?: unknown }).id ?? '') || null,
        factId: body.factId,
        decision: body.decision,
        correctedValue: body.correctedValue,
        reviewedBy: auth.user.id,
        createdAt: String((inserted.data as { created_at?: unknown }).created_at ?? ''),
      },
      actorId: auth.user.id,
      policySourceId: POLICY_SOURCE_ID,
    });
    return NextResponse.json({
      review: inserted.data,
      derivedFactRunId: derived.derivedRun.id,
      derivation: {
        status: derived.transport === 'RPC' ? 'DERIVED' : 'DERIVED_WITHOUT_RPC',
        code: derived.degradation ?? 'DERIVED_FACT_RUN_CREATED',
        parentFactRunId: derived.parentFactRunId,
        parentFingerprintUnchanged: derived.parentFingerprintUnchanged,
      },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'error desconocido';
    console.warn(`[policy-foundation:HUMAN_CORRECTION_DERIVATION_FAILED] La review ${String((inserted.data as { id?: unknown }).id ?? '')} de la auditoría ${auditId} se guardó pero NO se derivó un Fact Run: ${message}`);
    return NextResponse.json({
      review: inserted.data,
      derivedFactRunId: null,
      derivation: { status: 'FAILED', code: 'DERIVED_FACT_RUN_FAILED', message },
    }, { status: 201 });
  }
}
