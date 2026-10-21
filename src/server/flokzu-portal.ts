import { load } from "cheerio";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "./errors.js";
import type { FlokzuCaseData } from "./flokzu-types.js";

const PORTAL = "https://hkthn-n8n.scalahed.com/webhook/";
const FILE_HOSTS = new Set([
  "flokzu-storage-production.s3.amazonaws.com",
  "flokzu-storage-public-apps-prd.s3.amazonaws.com",
]);
export const StudentNumberSchema = z
  .string()
  .trim()
  .regex(/^\d{9}$/, "La matrícula debe contener exactamente 9 dígitos.");
export const TicketIdSchema = z.string().regex(/^CaVe-\d{1,16}$/);
export interface PortalTicket {
  identifier: string;
  canImport: boolean;
  existing?: { caseId: string; status: string; canUpdate: boolean; auditId: string | null; evidenceCount?: number };
}
export interface PortalAsset {
  source: string;
  url: string;
  field: string;
  filename: string;
}
export interface PortalDetail {
  studentIdentifier: string;
  studentName: string;
  data: Omit<
    FlokzuCaseData,
    "externalCaseId" | "studentIdentifier" | "studentName"
  >;
  assets: PortalAsset[];
}
const key = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const text = (html: string): string => {
  const $ = load(html);
  $("script,style,noscript").remove();
  $("br").replaceWith("\n");
  $("p,div,li,h1,h2,h3,h4,h5,h6,tr,td").append("\n");
  return $.root()
    .text()
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
};
export function parsePortalTickets(html: string): PortalTicket[] {
  const $ = load(html);
  if (!$('input[name="matricula"]').length)
    throw new ApiError(
      502,
      "VALIDATION_ERROR",
      "Flokzu cambió el formato de consulta. No se importaron datos.",
    );
  const tickets = new Map<string, PortalTicket>();
  $("a.btn-detalle").each((_, el) => {
    const identifier = $(el)
      .attr("onclick")
      ?.match(/input\.value\s*=\s*['"]([A-Za-z_]+-\d{1,16})['"]/)?.[1];
    if (!identifier)
      throw new ApiError(
        502,
        "VALIDATION_ERROR",
        "No se pudo leer un ticket de Flokzu.",
      );
    tickets.set(identifier, {
      identifier,
      canImport: TicketIdSchema.safeParse(identifier).success,
    });
  });
  return [...tickets.values()];
}
export function allowedAssetUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(
      502,
      "UPLOAD_ERROR",
      "Flokzu devolvió un enlace de archivo inválido.",
    );
  }
  if (
    url.protocol !== "https:" ||
    !FILE_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new ApiError(
      502,
      "UPLOAD_ERROR",
      "El archivo apunta a un origen no permitido.",
    );
  return url;
}
export function parsePortalDetail(
  html: string,
  identifier: string,
  student: string,
): PortalDetail {
  const $ = load(html);
  const fields = new Map<string, { label: string; value: string }>();
  const assets = new Map<string, PortalAsset>();
  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length !== 2) return;
    const label = text($(cells[0]).html() ?? "");
    const fieldKey = key(label);
    if (fields.has(fieldKey))
      throw new ApiError(
        502,
        "VALIDATION_ERROR",
        "Flokzu devolvió campos ambiguos.",
      );
    const value = text($(cells[1]).html() ?? "");
    if (value.length > 100_000)
      throw new ApiError(
        413,
        "VALIDATION_ERROR",
        "Un comentario de Flokzu excede el tamaño permitido.",
      );
    fields.set(fieldKey, { label, value });
    $(cells[1])
      .find("img[src],a[href],audio[src],video[src],source[src]")
      .each((__, element) => {
        const raw = $(element).attr("src") ?? $(element).attr("href") ?? "";
        // Los enlaces administrativos se conservan como texto; los adjuntos e imágenes deben descargarse.
        if (
          element.tagName === "a" &&
          !/s3\.amazonaws\.com/.test(raw) &&
          !/evidencia|archivo|llamada/i.test(label)
        )
          return;
        const url = allowedAssetUrl(raw);
        const source = url.origin + url.pathname;
        const disposition = url.searchParams.get(
          "response-content-disposition",
        );
        const name = disposition?.match(/filename\s*=\s*"?([^";]+)/i)?.[1];
        const filename =
          name ??
          `${label}-${createHash("sha256").update(source).digest("hex").slice(0, 12)}${element.tagName === "img" ? ".png" : ""}`;
        assets.set(source, { source, url: url.href, field: label, filename });
      });
  });
  const get = (...names: string[]): string | null => {
    for (const name of names) {
      const value = fields.get(key(name))?.value;
      if (value && !/^(?:99|sin dato|sin datos)$/i.test(value)) return value;
    }
    return null;
  };
  const body = text(html);
  if (
    get("Matricula") !== student ||
    !get("Nombre del estudiante") ||
    !new RegExp(`\\b${identifier}\\b`).test(body)
  )
    throw new ApiError(
      502,
      "VALIDATION_ERROR",
      "El detalle no corresponde a la matrícula y ticket seleccionados.",
    );
  const date = (s: string | null): string | null =>
    s && /^\d{4}[/-]\d{2}[/-]\d{2}$/.test(s) ? s.replaceAll("/", "-") : null;
  const administrativeComments = [...fields.values()].filter((f) =>
    /comentario|observacion/i.test(key(f.label)),
  );
  const exportedAt = new Date().toISOString();
  const observations = administrativeComments.map((f) => ({
    field: f.label,
    original: f.value,
    text: f.value,
    externalCaseId: identifier,
    area: /backoffice/i.test(key(f.label))
      ? ("BACK_OFFICE" as const)
      : /helpdesk/i.test(key(f.label))
        ? ("HELPDESK" as const)
        : ("ADMINISTRATIVE" as const),
    exportedAt,
    version: createHash("sha256").update(f.value).digest("hex"),
  }));
  const task = body.match(/TAREA ACTUAL:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
  const administrativeStartDate =
    body.match(/Fecha de inicio:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  if (assets.size > 100)
    throw new ApiError(
      413,
      "UPLOAD_ERROR",
      "El ticket supera el límite de 100 archivos.",
    );
  return {
    studentIdentifier: student,
    studentName: get("Nombre del estudiante")!,
    assets: [...assets.values()],
    data: {
      academic: {
        campus: get("Campus"),
        university: get("Universidad"),
        countryReported: null,
        program: get("Programa"),
        level: get("Nivel"),
        block: get("Bloque"),
        programKey: get("Clave de programa"),
        entryDate: date(get("Fecha de ingreso")),
      },
      procedure: {
        policyReported: get("Politica que aplica"),
        motive: get("Motivo"),
        description: get("Descripcion"),
        requestDate: date(get("Fecha de solicitud")),
        administrativeStartDate,
      },
      operations: {
        salesChannelReported: get("Canal de venta"),
        currentTask: task,
        statusReported: get("Estado"),
        finalizedReported: /El proceso en Flokzu ya ha finalizado/i.test(body)
          ? "Sí"
          : "No",
        reviewerReported: get("Agente revisor CV"),
        supervisorReported: get("Supervisor"),
        requesterReported: get("Iniciador"),
        requesterArea: get("Area del solicitante"),
      },
      observations,
      administrativeComments,
      fields: [...fields.values()],
      evidenceReferences: [...assets.values()].map((a) => ({
        label: a.field,
        value: a.filename,
      })),
    },
  };
}
export async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  if (!response.ok || !response.body)
    throw new ApiError(
      502,
      "UPLOAD_ERROR",
      "Flokzu no pudo entregar los datos o el archivo. Vuelve a consultar.",
    );
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > maxBytes)
        throw new ApiError(
          413,
          "UPLOAD_ERROR",
          "El contenido de Flokzu excede el tamaño permitido.",
        );
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}
async function queryPortal(
  path: string,
  body: Record<string, string>,
): Promise<string> {
  try {
    const response = await fetch(PORTAL + path, {
      method: "POST",
      body: new URLSearchParams(body),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!(response.headers.get("content-type") ?? "").includes("text/html"))
      throw new ApiError(
        502,
        "VALIDATION_ERROR",
        "Flokzu no devolvió el formato esperado.",
      );
    return (await readBounded(response, 8 * 1024 * 1024)).toString("utf8");
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      503,
      "VALIDATION_ERROR",
      "Flokzu no está disponible. Vuelve a consultar la matrícula.",
    );
  }
}
export async function lookupPortalTickets(
  student: string,
): Promise<PortalTicket[]> {
  return parsePortalTickets(
    await queryPortal("apiFlokzu2", {
      matricula: StudentNumberSchema.parse(student),
    }),
  );
}
export async function fetchPortalDetail(
  student: string,
  identifier: string,
): Promise<PortalDetail> {
  const tickets = await lookupPortalTickets(student);
  if (!tickets.some((t) => t.identifier === identifier && t.canImport))
    throw new ApiError(
      404,
      "NOT_FOUND",
      "La matrícula no tiene el ticket de cancelación seleccionado.",
    );
  return parsePortalDetail(
    await queryPortal("apiflokzuTicket2", { identifier }),
    identifier,
    student,
  );
}
