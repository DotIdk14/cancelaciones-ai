import { NextResponse, type NextRequest } from 'next/server';
import { createAuditRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getCurrentUser } from '@/server/auth/session';
import { buildAuditCostSummary } from '@/server/jobs/cost-ledger';
import { logPolicyEvent, startTimer } from '@/server/policy/operational-log';

export const dynamic = 'force-dynamic';

/**
 * GET /api/audits/[auditId]/cost
 *
 * Read-only. NO expone claves de API, cabeceras de autenticación ni el payload
 * crudo del proveedor: sólo metadatos de coste. Un endpoint de coste que
 * devuelve el request original está a una llamada de filtrar la clave de
 * OpenRouter en un log.
 *
 * Autorización: idéntica al resto de la auditoría (`audit.createdBy ===
 * user.id`). El coste se lee por `audit_id`, y `ai_usage` tiene RLS con la misma
 * política de visibilidad que el resto, de modo que un usuario ajeno no puede
 * ni leer la fila ni saltarse la comprobación de la ruta.
 *
 * Si el interruptor de coste está apagado, este endpoint SIGUE funcionando: es
 * lectura pura y hace falta para saber cuánto se gastó antes de apagarlo.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ auditId: string }> }) {
  const elapsed = startTimer();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesion requerida.' }, { status: 401 });

  const { auditId } = await context.params;
  const client = await createInsForgeServerClient();
  const audit = await createAuditRepository(client.database).findById(auditId);
  if (!audit) return NextResponse.json({ error: 'NOT_FOUND', message: 'Auditoria no encontrada.' }, { status: 404 });
  if (audit.createdBy !== user.id) return NextResponse.json({ error: 'FORBIDDEN', message: 'Acceso denegado.' }, { status: 403 });

  try {
    const summary = await buildAuditCostSummary({ database: client.database, auditId });

    // Un fallo de lectura del ledger NO se devuelve como "coste cero": son dos
    // afirmaciones distintas, y un 0 aquí affirmaría que se controló el gasto
    // cuando no se midió nada. Se responde 500 controlado, con el mismo
    // criterio que usa el resto de la API para un fallo de lectura.
    if (summary.readFailed) {
      return NextResponse.json(
        { error: 'COST_READ_FAILED', message: 'No fue posible leer el coste de esta auditoria.' },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );
    }

    logPolicyEvent('DECISION_TRACE_BUILT', { auditId, code: 'COST_SUMMARY_READ', factCount: summary.providerCallCount, durationMs: elapsed() });
    return NextResponse.json(summary, { headers: { 'cache-control': 'no-store' } });
  } catch {
    // No se devuelve un 0 falso: un error de lectura NO es "coste cero".
    return NextResponse.json({ error: 'COST_READ_FAILED', message: 'No fue posible leer el coste de esta auditoria.' }, { status: 500 });
  }
}
