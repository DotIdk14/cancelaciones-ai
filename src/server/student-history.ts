import type { InsForgeClient } from "./insforge.js";
import type { AuthContext } from "./auth.js";
import { capabilitiesForRole } from "./capabilities.js";
import { ApiError } from "./errors.js";
import { getScopedCaseOr404 } from "./cases.js";
import type { StudentHistory } from "../lib/student-history.js";

export async function getStudentHistory(
  client: InsForgeClient,
  caseId: string,
  auth: AuthContext,
  offset = 0,
  limit = 20,
): Promise<StudentHistory> {
  await getScopedCaseOr404(client, caseId, auth);
  const { data, error } = await client.database.rpc("student_case_history", {
    p_case_id: caseId,
    p_actor: auth.sub,
    p_offset: offset,
    p_limit: limit,
  });
  if (error || !data)
    throw new ApiError(
      503,
      "DATABASE_ERROR",
      "El historial no está disponible. No se modificó ningún expediente.",
    );
  const history = data as StudentHistory;
  const ids = [
    ...new Set(
      history.items.flatMap((item) =>
        [item.assignedTo, item.creatorId].filter((id): id is string =>
          Boolean(id),
        ),
      ),
    ),
  ];
  const names = new Map<string, string | null>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const result = await client.auth.getProfile(id);
        const profile = result.data as {
          name?: string;
          profile?: { name?: string };
        } | null;
        names.set(id, profile?.name ?? profile?.profile?.name ?? null);
      } catch {
        names.set(id, null);
      }
    }),
  );
  for (const item of history.items) {
    item.assignedName = item.assignedTo
      ? (names.get(item.assignedTo) ?? null)
      : null;
    item.creatorName = item.creatorId
      ? (names.get(item.creatorId) ?? null)
      : null;
  }
  return history;
}
export async function assertNoRedundantAudit(
  client: InsForgeClient,
  caseId: string,
): Promise<void> {
  const { data, error } = await client.database.rpc(
    "audit_relation_preflight",
    { p_case_id: caseId },
  );
  if (error || !data)
    throw new ApiError(
      503,
      "DATABASE_ERROR",
      "No se pudo verificar la relación de solicitudes antes de auditar.",
    );
  const result = (Array.isArray(data) ? data[0] : data) as {
    blocked?: boolean;
    primaryId?: string;
  };
  if (typeof result?.blocked !== "boolean")
    throw new ApiError(
      503,
      "DATABASE_ERROR",
      "Respuesta inválida al verificar la solicitud.",
    );
  if (result.blocked)
    throw new ApiError(
      409,
      "VALIDATION_ERROR",
      result.primaryId
        ? "Este expediente es secundario de una solicitud conciliada. Abre el principal " +
          result.primaryId +
          "; su historial y sus evidencias se conservan por separado."
        : "El mismo ticket ya existe en otro expediente. Coordinación debe verificar y elegir el principal antes de gastar tokens.",
    );
}
export async function reconcileCases(
  client: InsForgeClient,
  caseId: string,
  otherId: string,
  primaryId: string | null,
  sameRequest: boolean,
  note: string,
  auth: AuthContext,
): Promise<void> {
  if (!capabilitiesForRole(auth.role).canFinalizeAnyCase)
    throw new ApiError(
      403,
      "AUTH_ERROR",
      "Solo Coordinación puede conciliar solicitudes.",
    );
  await getScopedCaseOr404(client, caseId, auth);
  await getScopedCaseOr404(client, otherId, auth);
  const { error } = await client.database.rpc("reconcile_case_requests", {
    p_case_id: caseId,
    p_other_id: otherId,
    p_primary_id: primaryId,
    p_same_request: sameRequest,
    p_note: note,
    p_actor: auth.sub,
  });
  if (error)
    throw new ApiError(
      409,
      "VALIDATION_ERROR",
      "No se pudo conciliar: verifica los expedientes, su clasificación real/prueba y las decisiones previas.",
    );
}
