// =============================================================================
// Configuración de entorno — SOLO del lado servidor.
// Ninguna de estas variables puede exponerse al navegador (sin prefijos VITE_).
// =============================================================================

export interface ServerEnv {
  // InsForge
  INSFORGE_BASE_URL: string;
  INSFORGE_ANON_KEY: string;
  /** API key administrativa. Opcional: se usa para operaciones privilegiadas. */
  INSFORGE_API_KEY: string | null;
  /** Bucket de InsForge Storage para evidencias. */
  INSFORGE_STORAGE_BUCKET: string;

  // IA
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL: string;
  OPENROUTER_FALLBACK_MODEL: string | null;

  // Audio
  ASSEMBLYAI_API_KEY: string | null;

  // Aplicación
  APP_URL: string;
  /** Límite de subida por evidencia en bytes (por defecto 4 MB, por debajo del límite de body de Vercel). */
  MAX_EVIDENCE_BYTES: number;
  /** Milisegundos de espera máxima al refrescar transcripciones antes de auditar. */
  TRANSCRIPTION_POLL_TIMEOUT_MS: number;
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

let cached: ServerEnv | null = null;

/** Lee y valida el entorno. Se cachea por proceso. */
export function getEnv(): ServerEnv {
  if (cached) return cached;
  const env = process.env;

  cached = {
    INSFORGE_BASE_URL: required('INSFORGE_BASE_URL', env.INSFORGE_BASE_URL).replace(/\/+$/, ''),
    INSFORGE_ANON_KEY: required('INSFORGE_ANON_KEY', env.INSFORGE_ANON_KEY),
    INSFORGE_API_KEY: optional('INSFORGE_API_KEY', env.INSFORGE_API_KEY),
    INSFORGE_STORAGE_BUCKET: env.INSFORGE_STORAGE_BUCKET?.trim() || 'evidencias',

    OPENROUTER_API_KEY: required('OPENROUTER_API_KEY', env.OPENROUTER_API_KEY),
    OPENROUTER_MODEL: required('OPENROUTER_MODEL', env.OPENROUTER_MODEL),
    OPENROUTER_FALLBACK_MODEL: optional('OPENROUTER_FALLBACK_MODEL', env.OPENROUTER_FALLBACK_MODEL),

    ASSEMBLYAI_API_KEY: optional('ASSEMBLYAI_API_KEY', env.ASSEMBLYAI_API_KEY),

    APP_URL: env.APP_URL?.trim() || 'http://localhost:5173',
    MAX_EVIDENCE_BYTES: Number(env.MAX_EVIDENCE_BYTES) || 4 * 1024 * 1024,
    TRANSCRIPTION_POLL_TIMEOUT_MS: Number(env.TRANSCRIPTION_POLL_TIMEOUT_MS) || 25_000,
  };

  if (cached.MAX_EVIDENCE_BYTES <= 0 || !Number.isFinite(cached.MAX_EVIDENCE_BYTES)) {
    throw new Error('[env] MAX_EVIDENCE_BYTES debe ser un número positivo');
  }
  return cached;
}

/** Sólo para tests: limpiar la caché. */
export function resetEnvCache(): void {
  cached = null;
}