import type { InsForgeClient } from "./insforge.js";
import type { AuthContext } from "./auth.js";
import { capabilitiesForRole } from "./capabilities.js";
import { caseOwnedBy, type CaseRow } from "./cases.js";
import { ApiError, mapProviderError } from "./errors.js";
import type { PortalTicket } from "./flokzu-portal.js";

/** La relación cuenta originales reales; un enlace administrativo no es evidencia. */
export function portalEvidenceCount(row: {
  evidence?: Array<{ count: number }> | null;
}): number {
  const count = row.evidence?.[0]?.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0)
    throw new ApiError(
      503,
      "DATABASE_ERROR",
      "No se pudo verificar cuántas evidencias tiene el expediente. Vuelve a consultar.",
    );
  return count;
}

export async function existingPortalAudit(
  client: InsForgeClient,
  caseId: string,
): Promise<string | null> {
  const { data, error } = await client.database
    .from("audits")
    .select("id")
    .eq("case_id", caseId)
    .is("retired_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) throw mapProviderError(error, "DATABASE_ERROR");
  return (data as Array<{ id: string }> | null)?.[0]?.id ?? null;
}

/** Solo metadatos en lote: no descarga evidencia ni cambia el expediente al buscar. */
export async function describeExistingPortalCases(
  client: InsForgeClient,
  actor: AuthContext,
  student: string,
  tickets: PortalTicket[],
): Promise<PortalTicket[]> {
  if (!capabilitiesForRole(actor.role).canReadAllCases)
    throw new ApiError(
      403,
      "AUTH_ERROR",
      "No tienes permiso para consultar expedientes.",
    );
  const ids = tickets.filter((t) => t.canImport).map((t) => t.identifier);
  if (ids.length === 0) return tickets;
  if (ids.length > 100)
    throw new ApiError(
      413,
      "VALIDATION_ERROR",
      "La matrícula tiene demasiadas solicitudes para una sola consulta.",
    );
  const { data, error } = await client.database
    .from("cases")
    .select(
      "id,status,student_identifier,external_case_id,external_source,created_by,assigned_to,flokzu_audit_eligible,flokzu_data,merged_into_case_id,evidence(count)",
    )
    .eq("student_identifier", student)
    .eq("external_source", "FLOKZU")
    .in("external_case_id", ids)
    .is("merged_into_case_id", null)
    .limit(100);
  if (error) throw mapProviderError(error, "DATABASE_ERROR");
  const cases =
    (data as Array<CaseRow & { evidence?: Array<{ count: number }> }> | null) ??
    [];
  const audits = new Map<string, string>();
  const running = new Set<string>();
  if (cases.length) {
    for (let offset = 0; ; offset += 500) {
      const result = await client.database
        .from("audits")
        .select("id,case_id,status")
        .in(
          "case_id",
          cases.map((row) => row.id),
        )
        .is("retired_at", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + 499);
      if (result.error) throw mapProviderError(result.error, "DATABASE_ERROR");
      const page =
        (result.data as Array<{
          id: string;
          case_id: string;
          status?: string;
        }> | null) ?? [];
      for (const audit of page)
        if (!audits.has(audit.case_id)) {
          audits.set(audit.case_id, audit.id);
          if (audit.status === "RUNNING") running.add(audit.case_id);
        }
      if (page.length < 500 || audits.size === cases.length) break;
    }
  }
  const byTicket = new Map(cases.map((row) => [row.external_case_id, row]));
  return tickets.map((ticket) => {
    const row = byTicket.get(ticket.identifier);
    if (!row) return ticket;
    const auditId = audits.get(row.id) ?? null;
    const evidenceCount = portalEvidenceCount(row);
    return {
      ...ticket,
      existing: {
        caseId: row.id,
        status: row.status,
        auditId,
        evidenceCount,
        canUpdate:
          !running.has(row.id) &&
          (row.status === "DRAFT" || evidenceCount === 0) &&
          (capabilitiesForRole(actor.role).canImportCases ||
            (capabilitiesForRole(actor.role).canWriteOwnedCases &&
              caseOwnedBy(row, actor.sub))),
      },
    };
  });
}
