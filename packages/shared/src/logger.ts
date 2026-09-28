export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

/** Nombres de campo cuyo valor nunca se escribe en el log. */
const REDACTED_FIELDS = new Set([
  'apiKey',
  'apikey',
  'authorization',
  'token',
  'accessToken',
  'password',
  'secret',
  'webhookSecret',
  'cookie',
  'headers',
]);

/** Campos que llevan texto de estudiante: se acotan, nunca se vuelcan. */
const TRUNCATED_CONTENT_FIELDS = new Set(['transcript', 'text', 'body']);

const REDACTED_PLACEHOLDER = '[redacted]';
const MAX_FIELD_CHARS = 500;
const MAX_CONTENT_CHARS = 300;
const MAX_DEPTH = 5;
const ELLIPSIS = '…';

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1)}${ELLIPSIS}`;
}

/**
 * Por qué el logger no es un `console.log` disfrazado: los logs salen del servidor
 * hacia agregadores con más permisos que la base de datos, así que una credencial
 * o una transcripción completa escrita en una línea se convierte en una copia
 * permanente de PII que nadie va a borrar. Aquí se redactan las claves conocidas y
 * el texto de estudiante queda truncado a 300 caracteres: suficiente para
 * diagnosticar, insuficiente para reconstruir el documento.
 */
function sanitizeValue(key: string, value: unknown, depth: number): unknown {
  if (REDACTED_FIELDS.has(key)) return REDACTED_PLACEHOLDER;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return TRUNCATED_CONTENT_FIELDS.has(key) ? truncate(value, MAX_CONTENT_CHARS) : truncate(value, MAX_FIELD_CHARS);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: truncate(value.message, MAX_FIELD_CHARS) };
  }
  if (depth >= MAX_DEPTH) return '[deep]';
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(key, item, depth + 1));
  if (typeof value === 'object') {
    const result: LogFields = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      result[childKey] = sanitizeValue(childKey, childValue, depth + 1);
    }
    return result;
  }
  return String(value);
}

function sanitizeFields(fields: LogFields | undefined): LogFields {
  if (!fields) return {};
  const sanitized: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    sanitized[key] = sanitizeValue(key, value, 0);
  }
  return sanitized;
}

function emit(level: LogLevel, scope: string, base: LogFields, message: string, fields?: LogFields): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    scope,
    message: truncate(message, MAX_FIELD_CHARS),
    ...base,
    ...sanitizeFields(fields),
  });

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else if (level === 'debug') console.debug(line);
  else console.info(line);
}

export function createLogger(scope: string, base: LogFields = {}): Logger {
  const sanitizedBase = sanitizeFields(base);

  return {
    debug(message, fields) {
      emit('debug', scope, sanitizedBase, message, fields);
    },
    info(message, fields) {
      emit('info', scope, sanitizedBase, message, fields);
    },
    warn(message, fields) {
      emit('warn', scope, sanitizedBase, message, fields);
    },
    error(message, fields) {
      emit('error', scope, sanitizedBase, message, fields);
    },
    child(fields) {
      return createLogger(scope, { ...sanitizedBase, ...sanitizeFields(fields) });
    },
  };
}
