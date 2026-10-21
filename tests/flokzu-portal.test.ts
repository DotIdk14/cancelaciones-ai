import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allowedAssetUrl,
  fetchPortalDetail,
  parsePortalDetail,
  parsePortalTickets,
  readBounded,
  StudentNumberSchema,
} from "../src/server/flokzu-portal";

const student = "000000001";
const asset =
  "https://flokzu-storage-production.s3.amazonaws.com/test/image?X-Amz-Signature=secret";
const html = (mat = student) =>
  `<h2>CaVe-101</h2><div><strong>TAREA ACTUAL:</strong> [BACKOFFICE] [REVISION BO] [CV]</div><table><tr><td>Matricula</td><td>${mat}</td></tr><tr><td>Nombre del estudiante</td><td>Estudiante sintético</td></tr><tr><td>Comentario de BackOffice</td><td><p>Nota BO</p><img src="${asset}"></td></tr><tr><td>Comentarios HelpDesk</td><td>Nota HD</td></tr><tr><td>Comentario de finanzas</td><td>Nota finanzas</td></tr><tr><td>Evidencia acceso al Aula</td><td><a href="${asset}">Ver archivo</a></td></tr></table>`;
const search = (ids = ["CaVe-101", "CAMBCICLO-202"]) =>
  `<input name="matricula">${ids.map((id) => `<a class="btn-detalle" onclick="input.value = '${id}';">Ver detalle</a>`).join("")}`;
afterEach(() => vi.unstubAllGlobals());
describe("portal de consulta Flokzu", () => {
  it("conserva ceros iniciales y exige nueve dígitos", () => {
    expect(StudentNumberSchema.parse(" 000000001\u00a0")).toBe(student);
    expect(StudentNumberSchema.safeParse("123").success).toBe(false);
  });
  it("distingue cancelaciones de otros trámites sin elegir automáticamente", () => {
    expect(parsePortalTickets(search())).toEqual([
      { identifier: "CaVe-101", canImport: true },
      { identifier: "CAMBCICLO-202", canImport: false },
    ]);
  });
  it("falla cerrado al cambiar el contrato HTML", () =>
    expect(() => parsePortalTickets("<h1>Error</h1>")).toThrow("formato"));
  it("extrae imágenes incrustadas y adjuntos, deduplica por origen y preserva comentarios por área", () => {
    const detail = parsePortalDetail(html(), "CaVe-101", student);
    expect(detail.assets).toHaveLength(1);
    expect(detail.assets[0]?.url).toContain("secret");
    expect(JSON.stringify(detail.data)).not.toContain("secret");
    expect(detail.data.observations?.map((o) => o.area)).toEqual([
      "BACK_OFFICE",
      "HELPDESK",
      "ADMINISTRATIVE",
    ]);
    expect(detail.data.operations.currentTask).toBe(
      "[BACKOFFICE] [REVISION BO] [CV]",
    );
    expect(detail.data.academic.countryReported).toBeNull();
  });
  it("rechaza detalle de otro alumno y campos duplicados", () => {
    expect(() =>
      parsePortalDetail(html("000000002"), "CaVe-101", student),
    ).toThrow("corresponde");
    expect(() =>
      parsePortalDetail(
        html() + "<table><tr><td>Matricula</td><td>000000001</td></tr></table>",
        "CaVe-101",
        student,
      ),
    ).toThrow("ambiguos");
  });
  it.each([
    "http://flokzu-storage-production.s3.amazonaws.com/a",
    "https://evil.test/a",
    "https://user:password@flokzu-storage-production.s3.amazonaws.com/a",
    "https://127.0.0.1/a",
  ])("rechaza descargas fuera del origen aprobado: %s", (url) =>
    expect(() => allowedAssetUrl(url)).toThrow(),
  );
  it("limita bytes leídos aunque no haya Content-Length", async () => {
    await expect(readBounded(new Response("123456"), 5)).rejects.toMatchObject({
      status: 413,
    });
  });
  it("verifica que el CaVe pertenece a la matrícula antes de pedir su detalle", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(search(["CaVe-202"]), {
          headers: { "content-type": "text/html" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(fetchPortalDetail(student, "CaVe-101")).rejects.toMatchObject({
      status: 404,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
