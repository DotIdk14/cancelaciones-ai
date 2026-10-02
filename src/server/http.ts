// =============================================================================
// Helpers HTTP compartidos por todas las rutas /api (funcionan igual en
// Vercel Functions y en el dev server de Vite vía scripts/dev-api.mjs).
// =============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ErrorCategory } from '../skills/audit/types.js';
import { ApiError } from './errors.js';
import { requireAuth, type AuthContext } from './auth.js';
import { getEnv } from './env.js';

export type QueryValue = string | string[] | undefined;

export interface ApiRequest extends IncomingMessage {
  /** Params de ruta + query string (Vercel inyecta aquí los params `[casoId]`). */
  query: Record<string, QueryValue>;
  /** Body JSON ya parseado (en Vercel lo hace el runtime; en dev lo hace dev-api.mjs). */
  body?: unknown;
  /** Contexto de autenticación resuelto por `handleRoute` (o inyectado en tests). */
  auth?: AuthContext;
}

export type ApiResponse = ServerResponse;

export type ApiHandler = (req: ApiRequest, res: ApiResponse) => Promise<void> | void;

// `ApiError` y `mapProviderError` viven en `errors.ts` (módulo hoja) para que la
// capa de datos no dependa de la capa HTTP y para que los tests puedan
// sustituirlos sin cerrar un círculo de importaciones. Se re-exportan aquí para
// no cambiar ni un solo `import { ApiError } from './http.js'` del proyecto.
export { ApiError, mapProviderError, type ErrorCategory } from './errors.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida que un parámetro de ruta sea un UUID (en producción) o un identificador seguro. */
export function requiredUuid(query: Record<string, QueryValue>, key: string): string {
  const value = requiredString(query, key);
  if (process.env.NODE_ENV === 'test') {
    // Los tests usan identificadores sint├®ticos; la validación de producción es UUID.
    if (value.includes('/') || value.includes('\\') || value.includes('..')) {
      throw new ApiError(400, 'VALIDATION_ERROR', `El parámetro ${key} no es un identificador válido`);
    }
    return value;
  }
  if (!UUID_REGEX.test(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `El parámetro ${key} debe ser un UUID válido`);
  }
  return value;
}

/** Protección CSRF para mutaciones: Origin propio + header X-App-Request. */
function assertMutatingCsrf(req: ApiRequest): void {
  if (!req.method || !['POST', 'PATCH', 'DELETE'].includes(req.method)) return;

  const origin = req.headers.origin;
  if (typeof origin !== 'string') {
    throw new ApiError(403, 'AUTH_ERROR', 'Falta el header Origin');
  }

  const env = getEnv();
  const allowedOrigins = new Set<string>([env.APP_URL.replace(/\/$/, '')]);
  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.add('http://localhost:5173');
    allowedOrigins.add('http://127.0.0.1:5173');
  }

  if (!allowedOrigins.has(origin)) {
    throw new ApiError(403, 'AUTH_ERROR', 'Origen no permitido');
  }

  if (req.headers['x-app-request'] !== '1') {
    throw new ApiError(403, 'AUTH_ERROR', 'Falta el header X-App-Request');
  }
}

interface HandleRouteOptions {
  /** Si es true, la ruta no exige sesión (p. ej. login, healthcheck). */
  public?: boolean;
}

/**
 * Envuelve un handler con autenticación, CSRF en mutaciones y manejo de errores.
 *
 * - Por defecto exige sesión válida y membership en `app_memberships`.
 * - Las mutaciones (POST/PATCH/DELETE) exigen Origin propio y X-App-Request: 1.
 * - Los tests pueden inyectar `req.auth` para saltar ambas capas.
 */
export function handleRoute(handler: ApiHandler, options?: HandleRouteOptions): ApiHandler {
  return async (req, res) => {
    try {
      const isMutating = req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE';
      // Si el test ya inyectó un contexto, no lo re-resuelve: es el único bypass
      // intencional de auth/CSRF y nunca ocurre en producción.
      if (req.auth) {
        /* contexto inyectado (tests) o ya resuelto: no re-resolver */
      } else if (options?.public) {
        // Rutas públicas: las mutaciones siguen exigiendo CSRF para no aceptar
        // solicitudes cross-site (fail-closed).
        if (isMutating) assertMutatingCsrf(req);
      } else {
        // Rutas protegidas: CSRF primero, luego autenticación. Si CSRF falla,
        // no llegamos a consultar el proveedor de identidad.
        if (isMutating) assertMutatingCsrf(req);
        req.auth = await requireAuth(req, res);
      }
      await handler(req, res);
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function json(res: ApiResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(JSON.stringify(payload));
}

export function ok(res: ApiResponse, payload: unknown): void {
  json(res, 200, payload);
}

export function created(res: ApiResponse, payload: unknown): void {
  json(res, 201, payload);
}

export function errorJson(res: ApiResponse, status: number, category: ErrorCategory, message: string): void {
  json(res, status, { error: { category, message } });
}

export function sendError(res: ApiResponse, error: unknown): void {
  if (error instanceof ApiError) {
    if (error.retryAfterSeconds !== undefined && error.status === 429) {
      res.setHeader('Retry-After', String(error.retryAfterSeconds));
    }
    errorJson(res, error.status, error.category, error.message);
    return;
  }
  // Nunca exponer stack traces ni detalles internos en producción:
  // se loguea en el servidor y se responde gen├®rico.
  const message = error instanceof Error ? error.message : 'error desconocido';
  console.error('[api] error no controlado:', message);
  errorJson(res, 500, 'UNKNOWN', 'Error interno del servidor');
}

export function methodNotAllowed(req: ApiRequest, res: ApiResponse, allow?: string | string[]): void {
  if (allow) res.setHeader('Allow', Array.isArray(allow) ? allow.join(', ') : allow);
  errorJson(res, 405, 'VALIDATION_ERROR', `M├®todo ${req.method ?? '?'} no soportado`);
}

export function requiredString(query: Record<string, QueryValue>, key: string): string {
  const value = query[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(400, 'VALIDATION_ERROR', `Falta el parámetro requerido: ${key}`);
  }
  return value;
}

export function optionalString(query: Record<string, QueryValue>, key: string): string | undefined {
  const value = query[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export async function readRawBody(req: ApiRequest): Promise<Buffer> {
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body instanceof Uint8Array) return Buffer.from(req.body);
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

const MAX_JSON_BODY_BYTES = 1 * 1024 * 1024;

export async function readJsonBody(req: ApiRequest): Promise<unknown> {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      if (Buffer.byteLength(req.body, 'utf-8') > MAX_JSON_BODY_BYTES) {
        throw new ApiError(413, 'VALIDATION_ERROR', 'El cuerpo JSON excede el límite de 1 MB');
      }
      if (req.body.trim().length === 0) return {};
      try {
        return JSON.parse(req.body);
      } catch {
        throw new ApiError(400, 'VALIDATION_ERROR', 'El body no es JSON válido');
      }
    }
    return req.body;
  }
  const raw = await readRawBody(req);
  if (raw.length > MAX_JSON_BODY_BYTES) {
    throw new ApiError(413, 'VALIDATION_ERROR', 'El cuerpo JSON excede el límite de 1 MB');
  }
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf-8'));
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'El body no es JSON válido');
  }
}

export function parseCookies(req: ApiRequest): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (name) {
      try {
        out[name] = decodeURIComponent(value);
      } catch {
        out[name] = value;
      }
    }
  }
  return out;
}

export interface CookieOptions {
  maxAgeSeconds: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
}

export function setCookie(res: ApiResponse, name: string, value: string, options: CookieOptions): void {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? '/'}`,
    `Max-Age=${options.maxAgeSeconds}`,
  ];
  if (options.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  if (options.secure) parts.push('Secure');
  res.appendHeader('Set-Cookie', parts.join('; '));
}

export function clearCookie(res: ApiResponse, name: string): void {
  res.appendHeader('Set-Cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

/** Envía un buffer binario (descarga o preview de evidencia). */
export function sendBinary(
  res: ApiResponse,
  buffer: Buffer,
  mimeType: string,
  options: { inline: boolean; filename: string },
): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; script-src 'none'; style-src 'none'",
  );
  res.setHeader(
    'Content-Disposition',
    `${options.inline ? 'inline' : 'attachment'}; filename="${asciiFilenameFallback(options.filename)}"; filename*=UTF-8''${encodeURIComponent(options.filename)}`,
  );
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.end(buffer);
}

function asciiFilenameFallback(filename: string): string {
  return filename
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_')
    .trim() || 'download';
}



export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
