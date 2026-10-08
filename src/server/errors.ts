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
  /**
   * Detalle estructurado SANEADO para observabilidad (diagnósticos de intento,
   * logs y `provider_metadata`). Sólo puede contener texto estático emitido por
   * el propio emisor o códigos de error (p. ej. `ZodError.issue.code`): NUNCA
   * contenido de la respuesta del modelo ni PII. Si no puede garantizarse, no
   * se setea y los consumidores ignoran el `message` crudo (fail-closed).
   */
  sanitizedDetail?: string;

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
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url oculta]')
    .slice(0, 300);
}

/**
 * Códigos con los que PostgREST/Postgres reportan "esta columna no existe".
 *
 * `42703` es el SQLSTATE de `undefined_column` y `PGRST204` el código propio de
 * PostgREST. Los dos significan lo mismo desde el punto de vista de quien llama:
 * el servidor está speaking de un esquema que la base no tiene, y eso NO es un
 * error del cliente.
 */
const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204']);

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

  // UNA MIGRACIÓN SIN APLICAR, no una petición del usuario. Sin esta rama el
  // 400 caía en el mapeo genérico de abajo y quedaba etiquetado
  // VALIDATION_ERROR: el operador leía "revisa el formato de la fecha" cuando
  // lo que pasaba es que el despliegue está incompleto, y el 400 invitaba a
  // corregir algo que no estaba mal (FAIL_CLOSED: sigue fallando cerrado, solo
  // que con la categoría honesta y un 503 que sí dice "reintenta más tarde").
  if (code !== undefined && MISSING_COLUMN_CODES.has(code)) {
    return new ApiError(
      503,
      'DATABASE_ERROR',
      'Falta aplicar una migración en la base de datos. Reintentar no lo resuelve: es un despliegue incompleto.',
    );
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