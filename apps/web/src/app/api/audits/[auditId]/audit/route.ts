import { auditEngineNotImplemented } from '@/server/audit-engine/http';

/**
 * Punto de entrada explicito al motor de auditoria.
 *
 * Retirado en la fase clean slate. Este endpoint existe para que la ausencia
 * del motor sea ruidosa y explicita (501 AUDIT_ENGINE_NOT_IMPLEMENTED) en vez
 * de un 404 silencioso que podria confundirse con "no hay nada que auditar".
 *
 * La V2 implementara aqui el flujo:
 *   Evidence ingestion -> Fact extraction -> Canonical facts
 *   -> Decision tree -> Normative result -> Evidence assessment -> Review
 */
export async function POST() {
  return auditEngineNotImplemented('normative-evaluation');
}
