// =============================================================================
// Cuotas atómicas sin Redis.
//
// El límite se aplica a través de la función RPC admit_or_reject_quota, que
// serializa con pg_advisory_xact_lock y cuenta ventanas móviles en PostgreSQL.
// Nunca se almacena el email ni la IP crudos: se usa HMAC server-side.
// =============================================================================

import { createHmac } from 'node:crypto';
import { createServerClient } from './insforge.js';
import { getEnv } from './env.js';
import { ApiError } from './http.js';

function quotaHmacKey(): string {
  const env = getEnv();
  return env.QUOTA_HMAC_KEY ?? env.INSFORGE_API_KEY;
}

/** Hash irreversible de un sujeto (usuario, email o IP) para la tabla de cuotas. */
export function hashQuotaSubject(subject: string): string {
  return createHmac('sha256', quotaHmacKey()).update(subject).digest('hex');
}

export interface QuotaResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

async function admit(
  operation: 'paid' | 'login',
  subjectHash: string,
  contextHash: string,
  userId: string | null,
): Promise<QuotaResult> {
  const admin = createServerClient();
  const { data, error } = await admin.database.rpc('admit_or_reject_quota', {
    p_operation: operation,
    p_subject_hash: subjectHash,
    p_context_hash: contextHash,
    p_user_id: userId,
  });

  if (error) {
    // Fail-closed: si el servicio de cuotas no responde, NO llamamos al proveedor.
    throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'El servicio de cuotas no está disponible; inténtalo más tarde');
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Respuesta inesperada del servicio de cuotas');
  }

  // `admitted` debe ser un booleano EXPLÍCITO. Si la RPC devuelve algo que no
  // cumple el contrato (columna que falta, fila corrupta, versión distinta), NO
  // se interpreta como denegación: se reporta como servicio no disponible. Decir
  // "alcanzaste tu límite" cuando el problema es la infraestructura esconde la
  // avería y hace que el usuario espere en vano.
  const admitted = (row as Record<string, unknown>).admitted;
  if (typeof admitted !== 'boolean') {
    throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Respuesta inesperada del servicio de cuotas');
  }

  const allowed = admitted;
  const rawRetry = (row as Record<string, unknown>).retry_after_seconds;
  const retry = typeof rawRetry === 'number' && Number.isFinite(rawRetry) ? rawRetry : 60;
  return { allowed, retryAfterSeconds: retry };
}

function throwIfDenied(result: QuotaResult, message: string): void {
  if (result.allowed) return;
  const err = new ApiError(429, 'RATE_LIMIT', message);
  err.retryAfterSeconds = result.retryAfterSeconds;
  throw err;
}

/** Cuota para operaciones pagadas (auditoría, comparación, transcripción). */
export async function checkPaidQuota(userId: string, contextHash: string): Promise<void> {
  const result = await admit('paid', hashQuotaSubject(userId), contextHash, userId);
  throwIfDenied(result, 'Se alcanzó el límite de auditorías pagadas; espera antes de reintentar.');
}

/** Cuota de login por IP (10/IP/15min). */
export async function checkLoginIpQuota(ip: string): Promise<void> {
  const result = await admit('login', hashQuotaSubject(ip), 'ip', null);
  throwIfDenied(result, 'Demasiados intentos de inicio de sesión desde esta red; espera antes de reintentar.');
}
