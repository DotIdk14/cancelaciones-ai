/** Presupuesto duro de pasos del agente por run. Al agotarlo el run termina, nunca se reinicia. */
export const MAX_AGENT_STEPS = 12;
/** Presupuesto duro de llamadas a tools por run. */
export const MAX_TOOL_CALLS = 20;
/** Rondas máximas del revisor (CONFIRMED / REJECTED). Una sola corrección del analista como máximo. */
export const MAX_REVIEW_ROUNDS = 2;
/** 1 intento original + 1 reintento. No hay más. */
export const MAX_PROVIDER_ATTEMPTS = 2;
/** Timeout de una llamada al gateway de modelos. */
export const PROVIDER_TIMEOUT_MS = 60_000;
/** Timeout de una llamada de visión (imágenes grandes). */
export const VISION_TIMEOUT_MS = 90_000;
/** Timeout de una llamada al proveedor de audio. */
export const AUDIO_SUBMIT_TIMEOUT_MS = 30_000;
/** Fallback de polling de audio: como máximo estos intentos. */
export const AUDIO_POLL_MAX_ATTEMPTS = 12;
/** Intervalo del fallback de polling de audio. */
export const AUDIO_POLL_INTERVAL_MS = 5_000;
/** Deadline global del fallback de polling de audio. */
export const AUDIO_POLL_TIMEOUT_MS = 90_000;
/** Antigüedad máxima de un run sin estado terminal antes de que el barrido lo marque FAILED. */
export const AUDIT_RUN_STALE_MS = 30 * 60_000;
/** Límite de caracteres de una tool de lectura para no reventar el contexto. */
export const MAX_TOOL_OUTPUT_CHARS = 24_000;
