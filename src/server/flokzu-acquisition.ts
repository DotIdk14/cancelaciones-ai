import { createHash } from "node:crypto";
import type { InsForgeClient } from "./insforge.js";
import type { AuthContext } from "./auth.js";
import { capabilitiesForRole } from "./capabilities.js";
import { ApiError, mapProviderError } from "./errors.js";
import {
  createCase,
  evidenceByRequestId,
  insertEvidence,
  assertCaseNotFinalized,
  assertCaseOwner,
  updateCaseStatus,
  type CaseRow,
} from "./cases.js";
import { classifyFlokzu } from "../shared/flokzu-review.js";
import { getEnv } from "./env.js";
import {
  fetchPortalDetail,
  allowedAssetUrl,
  readBounded,
  type PortalAsset,
} from "./flokzu-portal.js";
import { resolveEvidenceMime } from "../shared/evidence-formats.js";
import {
  sanitizeFilename,
  verifyFileSignature,
  sha256Hex,
  isAudio,
} from "./evidence-prep.js";
import { checkPaidQuota } from "./quotas.js";
import { prepareAudio } from "./audio-preparation.js";
import { assertEvidenceMayBeAdded } from "./review-locks.js";
import { existingPortalAudit, portalEvidenceCount } from "./flokzu-existing.js";

function identity(value: string): string {
  const h = createHash("sha256").update(value).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
async function download(asset: PortalAsset) {
  try {
    const response = await fetch(allowedAssetUrl(asset.url), {
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    const buffer = await readBounded(response, getEnv().MAX_EVIDENCE_BYTES);
    const mime = resolveEvidenceMime(
      new Uint8Array(buffer.subarray(0, 16)),
      response.headers.get("content-type") ?? "",
      asset.filename,
    );
    if (!buffer.length || !mime || !verifyFileSignature(buffer, mime).ok)
      throw new ApiError(
        415,
        "UPLOAD_ERROR",
        `Archivo inválido o no admitido en «${asset.field}». No se completó la carga.`,
      );
    return {
      asset,
      buffer,
      mime,
      hash: sha256Hex(buffer),
      filename: sanitizeFilename(asset.filename),
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      503,
      "UPLOAD_ERROR",
      `No se pudo descargar un archivo de «${asset.field}». Vuelve a intentarlo.`,
    );
  }
}
export async function createCaseFromPortal(
  client: InsForgeClient,
  actor: AuthContext,
  input: {
    studentIdentifier: string;
    externalCaseId: string;
    assignedTo?: string;
  },
  requestId: string,
): Promise<CaseRow & { existingAuditId?: string }> {
  const caps = capabilitiesForRole(actor.role);
  if (!caps.canWriteOwnedCases || (input.assignedTo && !caps.canImportCases))
    throw new ApiError(
      403,
      "AUTH_ERROR",
      "No tienes permiso para crear o asignar este expediente.",
    );
  const existing = await client.database
    .from("cases")
    .select("*,evidence(count)")
    .eq("external_source", "FLOKZU")
    .eq("external_case_id", input.externalCaseId)
    .limit(1);
  if (existing.error) throw mapProviderError(existing.error, "DATABASE_ERROR");
  let row = (
    existing.data as Array<
      CaseRow & { evidence?: Array<{ count: number }> }
    > | null
  )?.[0];
  let originalAuditId: string | null = null;
  if (
    row &&
    (row.merged_into_case_id ||
      row.student_identifier !== input.studentIdentifier)
  )
    throw new ApiError(404, "NOT_FOUND", "Expediente no encontrado.");
  const previousData = row?.flokzu_data as {
    acquisition?: {
      status?: string;
      assets?: Array<{
        evidenceId: string;
        source: string;
        field: string;
        hash: string;
        filename: string;
      }>;
    };
  } | null;
  if (row) {
    const auditId = await existingPortalAudit(client, row.id);
    originalAuditId = auditId;
    const needsSync =
      row.status === "DRAFT" ||
      portalEvidenceCount(row) === 0 ||
      previousData?.acquisition?.status === "INCOMPLETE";
    if (auditId && !needsSync) {
      if (!caps.canReadAllCases) assertCaseOwner(row, actor);
      return { ...row, existingAuditId: auditId };
    }
    // La sincronización de contenido externo usa la capacidad de importación.
    // No concede escritura en comentarios locales ni cambia al responsable.
    if (!caps.canImportCases) assertCaseOwner(row, actor);
    if (!needsSync) return row;
    await assertCaseNotFinalized(client, row.id);
    await assertEvidenceMayBeAdded(client, row.id);
  }
  const detail = await fetchPortalDetail(
    input.studentIdentifier,
    input.externalCaseId,
  );
  if (detail.assets.length > getEnv().MAX_EVIDENCE_COUNT)
    throw new ApiError(
      413,
      "UPLOAD_ERROR",
      "El ticket supera el límite de evidencias del expediente. No se creó.",
    );
  const files: Awaited<ReturnType<typeof download>>[] = [];
  for (let offset = 0; offset < detail.assets.length; offset += 4) {
    const results = await Promise.allSettled(
      detail.assets.slice(offset, offset + 4).map(download),
    );
    const failure = results.find((r) => r.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    for (const result of results)
      if (result.status === "fulfilled") files.push(result.value);
    if (files.reduce((n, f) => n + f.buffer.length, 0) > 64 * 1024 * 1024)
      throw new ApiError(
        413,
        "UPLOAD_ERROR",
        "El expediente supera el límite total de 64 MB. No se importó.",
      );
  }
  if (row) {
    const auditId = await existingPortalAudit(client, row.id);
    if (auditId && auditId !== originalAuditId)
      return { ...row, existingAuditId: auditId };
    await assertCaseNotFinalized(client, row.id);
    await assertEvidenceMayBeAdded(client, row.id);
  }
  for (const f of files)
    if (isAudio(f.mime))
      await checkPaidQuota(
        actor.sub,
        `transcription:${input.externalCaseId}:${f.hash}`,
      );
  row ??= await createCase(
    client,
    detail.studentIdentifier,
    detail.studentName,
    actor.sub,
    requestId,
    {
      externalCaseId: input.externalCaseId,
      assignedTo: input.assignedTo,
      separateRequest: true,
    },
  );
  const caseId = row.id;
  const currentAssets = files.map((f) => ({
    evidenceId: identity(`${caseId}:${f.asset.source}:${f.hash}`),
    source: f.asset.source,
    field: f.asset.field,
    hash: f.hash,
    filename: f.filename,
  }));
  const assets = [
    ...new Map(
      [...(previousData?.acquisition?.assets ?? []), ...currentAssets].map(
        (asset) => [asset.evidenceId, asset],
      ),
    ).values(),
  ];
  const snapshot = {
    ...detail.data,
    acquisition: {
      status: "INCOMPLETE",
      fetchedAt: new Date().toISOString(),
      ticket: input.externalCaseId,
      assets,
    },
  };
  const save = async (status: "INCOMPLETE" | "COMPLETE") => {
    const data = {
      ...snapshot,
      acquisition: { ...snapshot.acquisition, status },
    };
    const classification = classifyFlokzu(detail.data);
    const { error } = await client.database
      .from("cases")
      .update({
        flokzu_data: data,
        student_name: detail.studentName,
        flokzu_classification: classification.classification,
        flokzu_audit_eligible: classification.classification === "ACTIVE",
      })
      .eq("id", caseId);
    if (error) throw mapProviderError(error, "DATABASE_ERROR");
    row!.flokzu_data = data;
    row!.student_name = detail.studentName;
  };
  await save("INCOMPLETE");
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    const id = currentAssets[i]!.evidenceId;
    if (await evidenceByRequestId(client, id)) continue;
    const storagePath = `${caseId}/${id}`;
    const { data: stored, error } = await client.storage
      .from(getEnv().INSFORGE_STORAGE_BUCKET)
      .upload(
        storagePath,
        new Blob([new Uint8Array(f.buffer)], { type: f.mime }),
      );
    if (error || !stored) {
      if (await evidenceByRequestId(client, id)) continue;
      const recovered = await client.storage
        .from(getEnv().INSFORGE_STORAGE_BUCKET)
        .download(storagePath);
      if (
        recovered.error ||
        !recovered.data ||
        sha256Hex(Buffer.from(await recovered.data.arrayBuffer())) !== f.hash
      )
        throw new ApiError(
          503,
          "STORAGE_ERROR",
          "La carga quedó pendiente. Reintenta con la misma matrícula y ticket.",
        );
    }
    let evidence;
    try {
      evidence = await insertEvidence(client, {
        id,
        case_id: caseId,
        filename: f.filename,
        mime_type: f.mime,
        size_bytes: f.buffer.length,
        hash: f.hash,
        storage_path: stored?.key ?? storagePath,
        processing_status: isAudio(f.mime) ? "UPLOADED" : "READY",
        ...(isAudio(f.mime)
          ? {
              transcript_json: {
                status: "SUBMITTING",
                submissionDeadlineAt: new Date(
                  Date.now() + 120_000,
                ).toISOString(),
              },
            }
          : {}),
      });
    } catch (cause) {
      if (await evidenceByRequestId(client, id)) continue;
      throw cause;
    }
    if (isAudio(f.mime)) await prepareAudio(client, evidence, f.buffer);
  }
  await save("COMPLETE");
  if (files.length > 0 && !files.some((f) => isAudio(f.mime))) {
    await updateCaseStatus(client, caseId, "READY");
    row.status = "READY";
  }
  return row;
}
