// =============================================================================
// Configuración de entorno — SOLO del lado servidor.
// Ninguna de estas variables puede exponerse al navegador (sin prefijos VITE_).
// =============================================================================

export interface ServerEnv {
  // InsForge
  INSFORGE_BASE_URL: string;
  INSFORGE_ANON_KEY: string;
  /** Clave administrativa; solo se usa en funciones server-side. */
  INSFORGE_API_KEY: string;
  /** Bucket de InsForge Storage para evidencias. */
  INSFORGE_STORAGE_BUCKET: string;

  // IA
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL: string;
  OPENROUTER_FALLBACK_MODEL: string | null;
  AI_TIMEOUT_MS: number;
  TOTAL_AUDIT_TIMEOUT_MS: number;
  AUDIT_STALE_AFTER_MS: number;

  // Audio
  ASSEMBLYAI_API_KEY: string | null;

  // Aplicación
  APP_URL: string;
  /** Límite de subida por evidencia en bytes (por defecto 4 MB, por debajo del límite de body de Vercel). */
  MAX_EVIDENCE_BYTES: number;
  /** Milisegundos de espera máxima al refrescar transcripciones antes de auditar. */
  TRANSCRIPTION_POLL_TIMEOUT_MS: number;
  MAX_EVIDENCE_COUNT: number;
  MAX_AUDIT_TEXT_CHARS: number;
  MAX_AUDIT_TEXT_CHARS_PER_EVIDENCE: number;
  MAX_AUDIT_MULTIMODAL_BYTES: number;
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`[env] Falta la variable de entorno ${name}`);
  }
  return value;
}

function optional(_name: string, value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value : null;
}

function numberEnv(name: string, value: string | undefined, fallback: number, options: { min: number; max?: number }): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < options.min || (options.max !== undefined && parsed > options.max)) {
    throw new Error(`[env] ${name} debe ser un entero entre ${options.min} y ${options.max ?? '∞'}`);
  }
  return parsed;
}

function assertNoPublicSecrets(env: NodeJS.ProcessEnv): void {
  const forbidden = Object.keys(env).filter(
    (key) => /^(VITE_|NEXT_PUBLIC_)/.test(key) && /(KEY|SECRET|TOKEN|OPENROUTER|INSFORGE|ASSEMBLYAI)/i.test(key),
  );
  if (forbidden.length > 0) {
    throw new Error(`[env] Variables sensibles expuestas al navegador: ${forbidden.join(', ')}`);
  }
}

let cached: ServerEnv | null = null;

/** Lee y valida el entorno. Se cachea por proceso. */
export function getEnv(): ServerEnv {
  if (cached) return cached;
  const env = process.env;
  assertNoPublicSecrets(env);

  cached = {
    INSFORGE_BASE_URL: required('INSFORGE_BASE_URL', env.INSFORGE_BASE_URL).replace(/\/+$/, ''),
    INSFORGE_ANON_KEY: required('INSFORGE_ANON_KEY', env.INSFORGE_ANON_KEY),
    INSFORGE_API_KEY: required('INSFORGE_API_KEY', env.INSFORGE_API_KEY),
    INSFORGE_STORAGE_BUCKET: env.INSFORGE_STORAGE_BUCKET?.trim() || 'evidencias',

    OPENROUTER_API_KEY: required('OPENROUTER_API_KEY', env.OPENROUTER_API_KEY),
    OPENROUTER_MODEL: required('OPENROUTER_MODEL', env.OPENROUTER_MODEL),
    OPENROUTER_FALLBACK_MODEL: optional('OPENROUTER_FALLBACK_MODEL', env.OPENROUTER_FALLBACK_MODEL),
    AI_TIMEOUT_MS: numberEnv('AI_TIMEOUT_MS', env.AI_TIMEOUT_MS, 60_000, { min: 1_000, max: 290_000 }),
    TOTAL_AUDIT_TIMEOUT_MS: numberEnv('TOTAL_AUDIT_TIMEOUT_MS', env.TOTAL_AUDIT_TIMEOUT_MS, 240_000, { min: 10_000, max: 295_000 }),
    AUDIT_STALE_AFTER_MS: numberEnv('AUDIT_STALE_AFTER_MS', env.AUDIT_STALE_AFTER_MS, 10 * 60_000, { min: 60_000 }),

    ASSEMBLYAI_API_KEY: optional('ASSEMBLYAI_API_KEY', env.ASSEMBLYAI_API_KEY),

    APP_URL: env.APP_URL?.trim() || 'http://localhost:5173',
    MAX_EVIDENCE_BYTES: numberEnv('MAX_EVIDENCE_BYTES', env.MAX_EVIDENCE_BYTES, 4 * 1024 * 1024, { min: 1 }),
    TRANSCRIPTION_POLL_TIMEOUT_MS: numberEnv('TRANSCRIPTION_POLL_TIMEOUT_MS', env.TRANSCRIPTION_POLL_TIMEOUT_MS, 25_000, { min: 0, max: 120_000 }),
    MAX_EVIDENCE_COUNT: numberEnv('MAX_EVIDENCE_COUNT', env.MAX_EVIDENCE_COUNT, 20, { min: 1, max: 100 }),
    MAX_AUDIT_TEXT_CHARS: numberEnv('MAX_AUDIT_TEXT_CHARS', env.MAX_AUDIT_TEXT_CHARS, 180_000, { min: 1_000 }),
    MAX_AUDIT_TEXT_CHARS_PER_EVIDENCE: numberEnv('MAX_AUDIT_TEXT_CHARS_PER_EVIDENCE', env.MAX_AUDIT_TEXT_CHARS_PER_EVIDENCE, 40_000, { min: 1_000 }),
    MAX_AUDIT_MULTIMODAL_BYTES: numberEnv('MAX_AUDIT_MULTIMODAL_BYTES', env.MAX_AUDIT_MULTIMODAL_BYTES, 16 * 1024 * 1024, { min: 1 }),
  };
  if (cached.OPENROUTER_FALLBACK_MODEL === cached.OPENROUTER_MODEL) {
    throw new Error('[env] OPENROUTER_FALLBACK_MODEL debe ser distinto de OPENROUTER_MODEL');
  }
  return cached;
}

/** Sólo para tests: limpiar la caché. */
export function resetEnvCache(): void {
  cached = null;
}
