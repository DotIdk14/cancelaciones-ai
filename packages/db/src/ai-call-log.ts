import type { DatabaseClient } from './client';

export interface AiCallLogInput { auditId?: string | null; runId?: string | null; provider: string; model: string; purpose: string; inputTokens?: number | null; outputTokens?: number | null; estimatedCostUsd?: number | null; latencyMs?: number | null; errorCode?: string | null; }

export function createAiCallLogRepository(database: DatabaseClient) {
  return { async record(input: AiCallLogInput): Promise<void> { try { await database.from('ai_call_log').insert([{ audit_id: input.auditId ?? null, run_id: input.runId ?? null, provider: input.provider, model: input.model, purpose: input.purpose, input_tokens: input.inputTokens ?? null, output_tokens: input.outputTokens ?? null, estimated_cost_usd: input.estimatedCostUsd ?? null, latency_ms: input.latencyMs ?? null, error_code: input.errorCode ?? null }]); } catch { /* best-effort: el fallo de telemetria no debe romper el flujo principal */ } } };
}

export type AiCallLogRepository = ReturnType<typeof createAiCallLogRepository>;
