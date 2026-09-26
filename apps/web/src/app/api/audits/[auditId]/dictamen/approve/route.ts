import { auditEngineNotImplemented } from '@/server/audit-engine/http';

/**
 * Retirado en la fase clean slate. Un dictamen exige un resultado normativo
 * aprobado, y el motor de auditoría no existe. Falla de forma explicita.
 */
export async function POST() {
  return auditEngineNotImplemented('dictamen-generation');
}
