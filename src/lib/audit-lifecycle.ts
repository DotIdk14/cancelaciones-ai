export type AuditLifecycle =
  | "CURRENT"
  | "STALE"
  | "RETIRED_OR_MISSING"
  | "FAILED"
  | "PENDING";
export function auditLifecycle(
  caseStatus: string,
  completed: { status: string; result_json?: unknown } | null,
  isCurrent: boolean | null,
  latest?: { status: string; retired_at?: string | null } | null,
): AuditLifecycle {
  if (completed?.status === "COMPLETED" && completed.result_json)
    return isCurrent === true ? "CURRENT" : "STALE";
  if (latest?.retired_at) return "RETIRED_OR_MISSING";
  if (latest?.status === "ERROR") return "FAILED";
  return caseStatus === "COMPLETED" ? "RETIRED_OR_MISSING" : "PENDING";
}
export const AUDIT_LIFECYCLE_LABELS: Record<AuditLifecycle, string> = {
  CURRENT: "Dictamen vigente",
  STALE:
    "Dictamen histórico: cambió la evidencia, los datos o la versión de preparación",
  RETIRED_OR_MISSING:
    "Auditoría registrada como completada, sin resultado vigente disponible",
  FAILED: "Auditoría fallida",
  PENDING: "Pendiente de auditoría",
};
