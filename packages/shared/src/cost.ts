export interface AiCallRecord {
  provider: string;
  model: string;
  purpose: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  latencyMs: number;
  errorCode: string | null;
}

/**
 * Precios por millón de tokens en USD. Fuente: precios públicos de OpenRouter.
 * Valores aproximados a la fecha de la migración: sirven para dimensionar y
 * alertar, no para facturar. Si OpenRouter publica otro precio, se corrige aquí
 * y nada más hay que tocar, porque el cálculo siempre pasa por esta tabla.
 */
export const MODEL_PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'google/gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'google/gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'anthropic/claude-sonnet-4.5': { input: 3.0, output: 15.0 },
  'openai/gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'meta-llama/llama-3.3-70b-instruct': { input: 0.12, output: 0.3 },
};

const TOKENS_PER_PRICING_UNIT = 1_000_000;
const COST_DECIMALS = 6;

/**
 * Coste estimado de una llamada. `null` significa "no lo sé": un modelo sin
 * precio en la tabla deja el coste sin estimar en vez de inventar un cero,
 * porque un 0 falso oculta el gasto. Con precios conocidos, un conteo ausente
 * cuenta como 0 y sí se registra coste.
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  const pricing = MODEL_PRICING_USD_PER_MTOK[model.trim()];
  if (!pricing) return null;

  const cost = (safeTokenCount(inputTokens) * pricing.input + safeTokenCount(outputTokens) * pricing.output) / TOKENS_PER_PRICING_UNIT;
  return Math.round(cost * 10 ** COST_DECIMALS) / 10 ** COST_DECIMALS;
}

function safeTokenCount(value: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return value;
}
