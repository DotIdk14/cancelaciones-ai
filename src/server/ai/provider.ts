import { getEnv } from '../env.js';
import { ApiError } from '../errors.js';

export type AiProvider = 'openrouter' | 'github-copilot';

/** Elige antes de inferir: nunca reinicia un dictamen después de gastar sus intentos. */
export async function selectAiProvider(deadlineMs?: number): Promise<AiProvider> {
  const env = getEnv();
  if (env.AI_PROVIDER_MODE === 'openrouter') return 'openrouter';
  if (!env.COPILOT_GITHUB_TOKEN || !env.COPILOT_MODEL || !env.COPILOT_REVIEW_MODEL) {
    throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Configura las credenciales y modelos de Copilot en el servidor.');
  }
  if (env.AI_PROVIDER_MODE === 'github-copilot') return 'github-copilot';
  const timeout = Math.min(5_000, (deadlineMs ?? Date.now() + 5_000) - Date.now());
  if (timeout <= 0) throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Se agotó el tiempo disponible para seleccionar proveedor.');
  try {
    const read = async (path: string) => {
      const response = await fetch(`https://openrouter.ai/api/v1/${path}`, {
        headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` }, signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) throw new Error('BUDGET_UNAVAILABLE');
      return await response.json() as { data?: Record<string, unknown> };
    };
    const [key, credits] = await Promise.all([read('key'), read('credits')]);
    const remaining = key.data?.limit_remaining;
    const purchased = credits.data?.total_credits;
    const spent = credits.data?.total_usage;
    if ((remaining !== null && (typeof remaining !== 'number' || !Number.isFinite(remaining)))
      || typeof purchased !== 'number' || !Number.isFinite(purchased)
      || typeof spent !== 'number' || !Number.isFinite(spent)) return 'github-copilot';
    const available = Math.min(remaining ?? Infinity, purchased - spent);
    return available >= env.OPENROUTER_MIN_BALANCE_USD ? 'openrouter' : 'github-copilot';
  } catch {
    // El respaldo está autorizado y configurado; no se relajan sesión, cuotas ni validación.
    return 'github-copilot';
  }
}
