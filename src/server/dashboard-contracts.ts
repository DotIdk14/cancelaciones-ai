// =============================================================================
// Dashboard — contratos compartidos
// =============================================================================
import { type AuditResultType, type CaseStatus, type ErrorCategory } from '../skills/audit/types.js';
import type { DashboardFilters } from '../lib/dashboard.js';
import type { AuditStatus } from './cases.js';



// El tipo vive en `src/lib/dashboard.ts` (única definición, también la usa la
// UI). Se reexporta para no obligar a los importadores a saber de dónde viene.
export type { DashboardFilters };

/** Fila de `public.audit_dashboard_metrics`. Solo escalares: nada de jsonb crudo. */
export interface DashboardMetricRow {
  id: string;
  case_id: string;
  case_status: CaseStatus;
  student_identifier: string | null;
  audit_status: AuditStatus;
  model: string;
  provider: string;
  latency_ms: number | null;
  error_category: ErrorCategory | null;
  attempt_number: number | null;
  created_at: string;
  result: AuditResultType | null;
  confidence: number | null;
  missing_evidence_count: number | null;
  usage_cost_usd: number | null;
  usage_total_tokens: number | null;
  usage_prompt_tokens: number | null;
  usage_completion_tokens: number | null;
  provider_models: string[] | null;
  attempts_cost_usd: number | null;
  attempts_total_tokens: number | null;
  attempts_prompt_tokens: number | null;
  attempts_completion_tokens: number | null;
  /** Nº de intentos reales de la llamada (elementos de `openrouterAttempts`). */
  attempts_count: number;
  country: string | null;
  channel: string | null;
  campus: string | null;
  modality: string | null;
  project: string | null;
  responsible: string | null;
  guideline: string | null;
  /**
   * Dictamen humano de `case_reviews` para ESTE `id` de auditoría, o `null` si
   * el caso aún no tiene revisión. Es `null` con frecuencia, y NO es lo mismo
   * que una discrepancia: `null` = nadie ha revisado, `false` = alguien
   * revisó y discrepó.
   */
  human_result: string | null;
}

/** Tamaño de página REST. Las consultas recorren todas las páginas antes de agregar KPI. */
export const DASHBOARD_PAGE_SIZE = 500;
