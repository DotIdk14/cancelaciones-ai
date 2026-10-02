// =============================================================================
// Errores tipados del API (módulo HOJA: no importa nada del servidor).
// =============================================================================
// Vive aparte de `http.ts` por una razón concreta y verificable: `http.ts`
// importa `auth.ts`, que a su vez importa el cliente de InsForge. Cuando un test
// reemplaza ese cliente por un store en memoria, la cadena
// `http -> auth -> insforge(mock) -> store -> http` cierra un círculo y el
// cargador de módulos queda esperando una promesa que nunca se resuelve: la
// suite se cuelga ANTES de ejecutar el primer test (y ningún `--testTimeout`
// puede abortarlo, porque el worker está bloqueado).
//
// `ApiError` y `mapProviderError` no necesitan nada de HTTP: sacarlos a un
// módulo sin dependencias rompe el círculo sin cambiar el comportamiento.
// `http.ts` los re-exporta, así que todas las importaciones existentes siguen
// funcionando tal cual.
// =============================================================================

import type { ErrorCategory } from '../skills/audit/types.js';

export type { ErrorCategory };

/** Error tipado del API. Nunca expone stack traces al cliente. */
export class ApiError extends Error {
  readonly status: number;
  readonly category: ErrorCategory;
  /** Segundos que el cliente debe esperar antes de reintentar (rate limiting). */
  retryAfterSeconds?: number;

  constructor(status: number, category: ErrorCategory, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.category = category;
  }
}

/** Evita filtrar claves, tokens o URLs internas en mensajes al cliente. */
function sanitizeErrorMessage(message: string): string {
  // Cubre tanto `Authorization=Bearer xyz` como `Authorization=xyz`.
  return message
    .replace(/(api[_-]?key|secret|token|authorization)[=:]\s*(?:(?:bearer|basic)\s+)?\S+/gi, '$1=[oculto]')
    .slice(0, 300);
}

/**
 * Convierte errores del SDK (InsForgeError / PostgrestError) en ApiError.
 * Trata el código PGRST116 (fila no encontrada) como 404.
 */
export function mapProviderError(
  error: unknown,
  fallbackCategory: ErrorCategory = 'DATABASE_ERROR',
): ApiError {
  const err = error as { statusCode?: number; status?: number; code?: string; message?: string } | null;
  const statusCode = err?.statusCode ?? err?.status ?? 500;
  const code = err?.code;

  if (code === 'PGRST116') {
    return new ApiError(404, 'NOT_FOUND', 'Registro no encontrado');
  }

  if (statusCode >= 500) {
    const safeMessage = err?.message ? sanitizeErrorMessage(err.message) : 'Error del proveedor';
    return new ApiError(statusCode, fallbackCategory, safeMessage);
  }
  if (statusCode === 400) {
    return new ApiError(400, 'VALIDATION_ERROR', sanitizeErrorMessage(err?.message ?? 'Solicitud inválida'));
  }
  if (statusCode === 401 || statusCode === 403) return new ApiError(statusCode, 'AUTH_ERROR', 'No autorizado');
  if (statusCode === 404) return new ApiError(404, 'NOT_FOUND', 'Recurso no encontrado');
  return new ApiError(statusCode, fallbackCategory, sanitizeErrorMessage(err?.message ?? 'Error del proveedor'));
}