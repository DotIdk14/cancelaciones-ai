import { beforeEach, expect, it, vi } from "vitest";
import { createCaseFromPortal } from "../src/server/flokzu-acquisition";
import { fakeAuthContext } from "./helpers/auth";
import type { InsForgeClient } from "../src/server/insforge";

const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  create: vi.fn(),
  find: vi.fn(),
  insert: vi.fn(),
  status: vi.fn(),
  upload: vi.fn(),
  prepare: vi.fn(),
  quota: vi.fn(),
  audit: vi.fn(),
  owner: vi.fn(),
  finalized: vi.fn(),
  canAdd: vi.fn(),
  existing: null as Record<string, unknown> | null,
  rows: new Map<string, unknown>(),
  patches: [] as Array<Record<string, unknown>>,
}));
vi.mock("../src/server/flokzu-existing", () => ({
  existingPortalAudit: mocks.audit,
  portalEvidenceCount: (row: { evidenceCount?: number }) =>
    row.evidenceCount ?? 1,
}));
vi.mock("../src/server/flokzu-portal", async () => ({
  ...(await vi.importActual("../src/server/flokzu-portal")),
  fetchPortalDetail: mocks.detail,
}));
vi.mock("../src/server/cases", () => ({
  createCase: mocks.create,
  assertCaseOwner: mocks.owner,
  evidenceByRequestId: mocks.find,
  insertEvidence: mocks.insert,
  updateCaseStatus: mocks.status,
  assertCaseNotFinalized: mocks.finalized,
}));
vi.mock("../src/server/review-locks", () => ({
  assertEvidenceMayBeAdded: mocks.canAdd,
}));
vi.mock("../src/server/env", () => ({
  getEnv: () => ({
    MAX_EVIDENCE_BYTES: 1024,
    MAX_EVIDENCE_COUNT: 50,
    INSFORGE_STORAGE_BUCKET: "test",
  }),
}));
vi.mock("../src/server/quotas", () => ({ checkPaidQuota: mocks.quota }));
vi.mock("../src/server/audio-preparation", () => ({
  prepareAudio: mocks.prepare,
}));
const input = { studentIdentifier: "000000001", externalCaseId: "CaVe-101" };
const row = {
  id: "00000000-0000-4000-8000-000000000001",
  created_by: "owner",
  student_identifier: input.studentIdentifier,
  status: "DRAFT",
};
const client = {
  database: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: async () => ({
              data: mocks.existing ? [mocks.existing] : [],
              error: null,
            }),
          }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          mocks.patches.push(patch);
          return { error: null };
        },
      }),
    }),
  },
  storage: {
    from: () => ({
      upload: mocks.upload,
      download: async () => ({ data: null, error: "missing" }),
    }),
  },
} as unknown as InsForgeClient;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.audit.mockResolvedValue(null);
  mocks.finalized.mockResolvedValue(undefined);
  mocks.canAdd.mockResolvedValue(undefined);
  mocks.owner.mockImplementation(() => {});
  mocks.existing = null;
  mocks.rows.clear();
  mocks.patches.length = 0;
  mocks.detail.mockResolvedValue({
    studentIdentifier: input.studentIdentifier,
    studentName: "Estudiante sintético",
    data: {
      academic: {},
      procedure: { motive: null, description: null },
      operations: {
        currentTask: "[BACKOFFICE] [REVISION BO] [CV]",
        statusReported: "REVISIÓN",
        finalizedReported: "No",
      },
    },
    assets: [
      {
        source: "https://flokzu-storage-production.s3.amazonaws.com/test/a",
        url: "https://flokzu-storage-production.s3.amazonaws.com/test/a?temporary-token",
        field: "Evidencia",
        filename: "evidencia.png",
      },
    ],
  });
  mocks.create.mockResolvedValue({ ...row });
  mocks.find.mockImplementation(
    async (_client, id) => mocks.rows.get(id) ?? null,
  );
  mocks.insert.mockImplementation(async (_client, value) => {
    mocks.rows.set(value.id, value);
    return value;
  });
  mocks.upload.mockResolvedValue({ data: { key: "saved/key" }, error: null });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(
            new Uint8Array([
              137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0,
            ]),
            { headers: { "content-type": "image/png" } },
          ),
      ),
  );
});
it("valida el original antes de crear, guarda procedencia y completa solo tras persistir todas las evidencias", async () => {
  await createCaseFromPortal(
    client,
    { ...fakeAuthContext("user"), sub: "owner" },
    input,
    row.id,
  );
  expect(mocks.rows.size).toBe(1);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(
    mocks.patches.map(
      (p) =>
        (p.flokzu_data as { acquisition: { status: string } }).acquisition
          .status,
    ),
  ).toEqual(["INCOMPLETE", "COMPLETE"]);
  expect(JSON.stringify(mocks.patches)).not.toContain("temporary-token");
  expect(mocks.status).toHaveBeenCalledWith(client, row.id, "READY");
});
it("rechaza una descarga inválida antes de crear o subir archivos", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("not a PNG", { headers: { "content-type": "image/png" } }),
      ),
  );
  await expect(
    createCaseFromPortal(client, fakeAuthContext("user"), input, row.id),
  ).rejects.toMatchObject({ status: 415 });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("un fallo de almacenamiento mantiene el manifiesto incompleto", async () => {
  mocks.upload.mockResolvedValue({ data: null, error: "unavailable" });
  await expect(
    createCaseFromPortal(client, fakeAuthContext("user"), input, row.id),
  ).rejects.toMatchObject({ status: 503 });
  expect(mocks.patches).toHaveLength(1);
  expect(
    (mocks.patches[0]?.flokzu_data as { acquisition: { status: string } })
      .acquisition.status,
  ).toBe("INCOMPLETE");
});
it("la recuperación no vuelve a insertar evidencia durable", async () => {
  const actor = { ...fakeAuthContext("user"), sub: "owner" };
  await createCaseFromPortal(client, actor, input, row.id);
  mocks.upload.mockClear();
  mocks.insert.mockClear();
  await createCaseFromPortal(client, actor, input, row.id);
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.insert).not.toHaveBeenCalled();
});
it("el gerente se rechaza antes de consultar el origen", async () => {
  await expect(
    createCaseFromPortal(client, fakeAuthContext("manager"), input, row.id),
  ).rejects.toMatchObject({ status: 403 });
  expect(mocks.detail).not.toHaveBeenCalled();
});

it("actualiza un DRAFT previo sin manifiesto, conserva su identidad y no vuelve a crear", async () => {
  mocks.existing = {
    ...row,
    external_source: "FLOKZU",
    external_case_id: input.externalCaseId,
  };
  const result = await createCaseFromPortal(
    client,
    { ...fakeAuthContext("user"), sub: "owner" },
    input,
    "another-request",
  );
  expect(result.id).toBe(row.id);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.owner).toHaveBeenCalled();
  expect(mocks.patches[1]).toMatchObject({
    student_name: "Estudiante sintético",
  });
});
it("un borrador con carga COMPLETE se vuelve a sincronizar sin duplicar originales", async () => {
  mocks.existing = {
    ...row,
    flokzu_data: {
      acquisition: {
        status: "COMPLETE",
        assets: [
          {
            evidenceId: "old-evidence",
            source: "old-source",
            field: "Archivo anterior",
            hash: "old",
            filename: "old.png",
          },
        ],
      },
    },
  };
  await createCaseFromPortal(
    client,
    { ...fakeAuthContext("user"), sub: "owner" },
    input,
    row.id,
  );
  expect(mocks.detail).toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(
    (mocks.patches[1]?.flokzu_data as { acquisition: { assets: unknown[] } })
      .acquisition.assets,
  ).toHaveLength(2);
});
it.each(["READY", "COMPLETED", "ERROR"])(
  "si %s ya tiene auditoría devuelve el enlace sin consultar Flokzu ni escribir",
  async (status) => {
    mocks.existing = { ...row, status, created_by: "other-person" };
    mocks.audit.mockResolvedValue("audit-existing");
    const result = await createCaseFromPortal(
      client,
      fakeAuthContext("coordinator"),
      input,
      row.id,
    );
    expect(result.existingAuditId).toBe("audit-existing");
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.patches).toHaveLength(0);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  },
);
it("una auditoría iniciada durante la descarga bloquea la actualización y devuelve su enlace", async () => {
  mocks.existing = { ...row };
  mocks.audit.mockResolvedValueOnce(null).mockResolvedValueOnce("new-audit");
  const result = await createCaseFromPortal(
    client,
    { ...fakeAuthContext("user"), sub: "owner" },
    input,
    row.id,
  );
  expect(result.existingAuditId).toBe("new-audit");
  expect(mocks.patches).toHaveLength(0);
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("el guard de propiedad sigue impidiendo actualizar un borrador ajeno", async () => {
  mocks.existing = { ...row };
  mocks.owner.mockImplementation(() => {
    throw Object.assign(new Error("Not found"), { status: 404 });
  });
  await expect(
    createCaseFromPortal(client, fakeAuthContext("user"), input, row.id),
  ).rejects.toMatchObject({ status: 404 });
  expect(mocks.detail).not.toHaveBeenCalled();
  expect(mocks.patches).toHaveLength(0);
});

it.each(["READY", "COMPLETED", "ERROR"])(
  "incorpora las evidencias de un %s vacío sin crear otro expediente ni rehacer su auditoría",
  async (status) => {
    mocks.existing = { ...row, status, evidenceCount: 0 };
    mocks.audit.mockResolvedValue("audit-existing");
    const result = await createCaseFromPortal(
      client,
      { ...fakeAuthContext("user"), sub: "owner" },
      input,
      row.id,
    );
    expect(result.id).toBe(row.id);
    expect(result.existingAuditId).toBeUndefined();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.patches).toHaveLength(2);
  },
);
it("sincroniza un DRAFT con auditoría previa y preserva el expediente", async () => {
  mocks.existing = { ...row, evidenceCount: 3 };
  mocks.audit.mockResolvedValue("audit-existing");
  const result = await createCaseFromPortal(
    client,
    { ...fakeAuthContext("user"), sub: "owner" },
    input,
    row.id,
  );
  expect(result.id).toBe(row.id);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.insert).toHaveBeenCalledTimes(1);
});
it("una revisión finalizada no se modifica aunque no tenga archivos", async () => {
  mocks.existing = { ...row, status: "COMPLETED", evidenceCount: 0 };
  mocks.audit.mockResolvedValue("audit-existing");
  mocks.finalized.mockRejectedValue(
    Object.assign(new Error("Finalizado"), { status: 409 }),
  );
  await expect(
    createCaseFromPortal(
      client,
      { ...fakeAuthContext("user"), sub: "owner" },
      input,
      row.id,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(mocks.detail).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.patches).toHaveLength(0);
});
it("respeta el bloqueo de auditoría en curso y no descarga ni guarda archivos", async () => {
  mocks.existing = { ...row, status: "READY", evidenceCount: 0 };
  mocks.audit.mockResolvedValue("running");
  mocks.canAdd.mockRejectedValue(
    Object.assign(new Error("En curso"), { status: 409 }),
  );
  await expect(
    createCaseFromPortal(
      client,
      { ...fakeAuthContext("user"), sub: "owner" },
      input,
      row.id,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(mocks.detail).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.patches).toHaveLength(0);
});

it("si se finaliza durante la descarga, conserva el cierre sin guardar evidencias", async () => {
  mocks.existing = { ...row, status: "READY", evidenceCount: 0 };
  mocks.audit.mockResolvedValue("audit-existing");
  mocks.finalized
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(
      Object.assign(new Error("Finalizado"), { status: 409 }),
    );
  await expect(
    createCaseFromPortal(
      client,
      { ...fakeAuthContext("user"), sub: "owner" },
      input,
      row.id,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(mocks.detail).toHaveBeenCalledTimes(1);
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.patches).toHaveLength(0);
});

it("el Coordinador sincroniza el CaVe vacío asignado a otro Asesor sin cambiar su asignación ni comentarios locales", async () => {
  mocks.existing = {
    ...row,
    external_source: "FLOKZU",
    assigned_to: "another-advisor",
    created_by: "another-person",
    evidenceCount: 0,
  };
  mocks.owner.mockImplementation(() => {
    throw Object.assign(new Error("Not owner"), { status: 404 });
  });
  const result = await createCaseFromPortal(
    client,
    fakeAuthContext("coordinator"),
    input,
    row.id,
  );
  expect(result.id).toBe(row.id);
  expect(mocks.owner).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.insert).toHaveBeenCalledTimes(1);
  for (const patch of mocks.patches) {
    expect(patch).not.toHaveProperty("assigned_to");
    expect(patch).not.toHaveProperty("created_by");
    expect(patch).not.toHaveProperty("coordinator_decision");
  }
});
