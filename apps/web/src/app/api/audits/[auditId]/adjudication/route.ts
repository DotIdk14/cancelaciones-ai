import { auditEngineNotImplemented } from '@/server/audit-engine/http';

/**
 * Retirado en la fase clean slate. Requiere un resultado normativo, y el motor
 * de auditoría no existe. Falla de forma explicita; no hay fallback legacy.
 */
export async function GET() {
  return auditEngineNotImplemented('adjudication');
}

export async function POST() {
  return auditEngineNotImplemented('adjudication');
}
