import type { InsForgeClient } from "./insforge.js";
import type { AuthContext } from "./auth.js";
import { ApiError, mapProviderError } from "./errors.js";
import {
  assertFlokzuCoordinator,
  decideFlokzuTicket,
} from "./flokzu-review.js";
const databaseError = (error: unknown): never => {
  throw mapProviderError(error, "DATABASE_ERROR");
};
export async function assignImportedCase(
  client: InsForgeClient,
  caseId: string,
  assignedTo: string | null,
  actor: AuthContext,
): Promise<void> {
  assertFlokzuCoordinator(actor);
  if (assignedTo !== null) {
    const { data, error } = await client.database
      .from("app_memberships")
      .select("user_id")
      .eq("user_id", assignedTo)
      .eq("role", "user")
      .limit(1);
    if (error) databaseError(error);
    if (!data || data.length === 0)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "El responsable debe ser un Asesor activo.",
      );
  }
  const result = await client.database
    .from("cases")
    .select("flokzu_revision")
    .eq("id", caseId)
    .eq("external_source", "FLOKZU")
    .limit(1);
  if (result.error) databaseError(result.error);
  if (!result.data?.[0])
    throw new ApiError(404, "NOT_FOUND", "Ticket no encontrado.");
  await decideFlokzuTicket(client, actor, {
    caseId,
    revision: result.data[0].flokzu_revision,
    action: "REASSIGN",
    assignedTo,
  });
}
