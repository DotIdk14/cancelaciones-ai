// =============================================================================
// Helpers HTTP compartidos por todas las rutas /api (funcionan igual en
// Vercel Functions y en el dev server de Vite vía scripts/dev-api.mjs).
// =============================================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ErrorCategory } from '../skills/audit/types.js';

export type QueryValue = string | string[] | undefined;

export interface ApiRequest extends IncomingMessage {
  /** Params de ruta + query string (Vercel inyecta aquí los params `[casoId]`). */
  query: Record<string, QueryValue>;
  /** Body JSON ya parseado (en Vercel lo hace el runtime; en dev lo hace dev-api.mjs). */
  body?: unknown;
}

export type ApiResponse = ServerResponse;

export type ApiHandler = (req: ApiRequest, res: ApiResponse) => Promise<void> | void;

/** Error tipado del API. Nunca expone stack traces al cliente. */
export class ApiError extends Error {
  readonly status: number;
  readonly category: ErrorCategory;
  constructor(status: number, category: ErrorCategory, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.category = category;
  }
}

/** Envuelve un handler con manejo de errores unificado. */
export function handleRoute(handler: ApiHandler): ApiHandler {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      sendError(res, error);
    }
  };
}

export function json(res: ApiResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
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
    errorJson(res, error.status, error.category, error.message);
    return;
  }
  // Nunca exponer stack traces ni detalles internos en producción:
  // se loguea en el servidor y se responde genérico.
  const message = error instanceof Error ? error.message : 'error desconocido';
  console.error('[api] error no controlado:', message);
  errorJson(res, 500, 'UNKNOWN', 'Error interno del servidor');
}

export function methodNotAllowed(req: ApiRequest, res: ApiResponse, allow?: string | string[]): void {
  if (allow) res.setHeader('Allow', Array.isArray(allow) ? allow.join(', ') : allow);
  errorJson(res, 405, 'VALIDATION_ERROR', `Método ${req.method ?? '?'} no soportado`);
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

export async function readJsonBody(req: ApiRequest): Promise<unknown> {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
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

/**
 * Convierte errores del SDK (InsForgeError / PostgrestError) en ApiError.
 * Trata el código PGRST116 (fila no encontrada) como 404.
 */
export function mapProviderError(error: unknown, fallbackCategory: ErrorCategory = 'DATABASE_ERROR'): ApiError {
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
  if (statusCode === 400) return new ApiError(400, 'VALIDATION_ERROR', sanitizeErrorMessage(err?.message ?? 'Solicitud inválida'));
  if (statusCode === 401 || statusCode === 403) return new ApiError(statusCode, 'AUTH_ERROR', 'No autorizado');
  if (statusCode === 404) return new ApiError(404, 'NOT_FOUND', 'Recurso no encontrado');
  return new ApiError(statusCode, fallbackCategory, sanitizeErrorMessage(err?.message ?? 'Error del proveedor'));
}

function sanitizeErrorMessage(message: string): string {
  // Evita filtrar claves, tokens o URLs internas en mensajes al cliente.
  // Cubre tanto `Authorization=Bearer xyz` como `Authorization=xyz`.
  return message
    .replace(/(api[_-]?key|secret|token|authorization)[=:]\s*(?:(?:bearer|basic)\s+)?\S+/gi, '$1=[oculto]')
    .slice(0, 300);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
