import { expect, it, vi } from "vitest";
import {
  describeExistingPortalCases,
  existingPortalAudit,
} from "../src/server/flokzu-existing";
import type { InsForgeClient } from "../src/server/insforge";
import { fakeAuthContext } from "./helpers/auth";

function database(
  cases: Array<Record<string, unknown>>,
  audits: unknown[],
  error: unknown = null,
) {
  const queries: Array<{ table: string; filters: Array<unknown[]> }> = [];
  const client = {
    database: {
      from: (table: string) => {
        const filters: Array<unknown[]> = [];
        queries.push({ table, filters });
        const result = () => ({
          data:
            table === "cases"
              ? cases.map((row) => ({ evidence: [{ count: 1 }], ...row }))
              : audits,
          error,
        });
        const q = {
          select: vi.fn(() => q),
          eq: vi.fn((...args: unknown[]) => {
            filters.push(["eq", ...args]);
            return q;
          }),
          in: vi.fn((...args: unknown[]) => {
            filters.push(["in", ...args]);
            return q;
          }),
          is: vi.fn((...args: unknown[]) => {
            filters.push(["is", ...args]);
            return q;
          }),
          order: vi.fn(() => q),
          limit: vi.fn(async () => result()),
          range: vi.fn(async () => result()),
        };
        return q;
      },
    },
  } as unknown as InsForgeClient;
  return { client, queries };
}
const tickets = [
  { identifier: "CaVe-1", canImport: true },
  { identifier: "CaVe-2", canImport: true },
  { identifier: "INSS-3", canImport: false },
];
it("identifica borradores propios editables y enlaza cualquier caso auditado sin permitir actualizarlo", async () => {
  const actor = fakeAuthContext("user");
  const { client, queries } = database(
    [
      {
        id: "draft",
        status: "DRAFT",
        external_case_id: "CaVe-1",
        external_source: "FLOKZU",
        assigned_to: actor.sub,

      },
      {
        id: "audited",
        status: "DRAFT",
        external_case_id: "CaVe-2",
        external_source: "FLOKZU",
        assigned_to: "someone-else",
      },
    ],
    [
      { id: "latest", case_id: "audited" },
      { id: "older", case_id: "audited" },
    ],
  );
  const result = await describeExistingPortalCases(
    client,
    actor,
    "000000001",
    tickets,
  );
  expect(result[0]?.existing).toEqual({
    caseId: "draft",
    status: "DRAFT",
    auditId: null,
    canUpdate: true,
    evidenceCount: 1,
  });
  expect(result[1]?.existing).toEqual({
    caseId: "audited",
    status: "DRAFT",
    auditId: "latest",
    canUpdate: false,
    evidenceCount: 1,
  });
  expect(result[2]?.existing).toBeUndefined();
  expect(queries[0]?.filters).toContainEqual([
    "eq",
    "student_identifier",
    "000000001",
  ]);
  expect(queries[1]?.filters).toContainEqual(["is", "retired_at", null]);
});
it("un coordinador puede importar el contenido Flokzu de un borrador asignado a otro Asesor", async () => {
  const { client } = database(
    [
      {
        id: "foreign",
        status: "DRAFT",
        external_case_id: "CaVe-1",
        external_source: "FLOKZU",
        assigned_to: "someone-else",

      },
    ],
    [],
  );
  const result = await describeExistingPortalCases(
    client,
    fakeAuthContext("coordinator"),
    "000000001",
    tickets,
  );
  expect(result[0]?.existing?.canUpdate).toBe(true);
});
it("una caída de base no se presenta como si el ticket fuera nuevo", async () => {
  const { client } = database([], [], { message: "unavailable" });
  await expect(
    describeExistingPortalCases(
      client,
      fakeAuthContext("user"),
      "000000001",
      tickets,
    ),
  ).rejects.toBeTruthy();
});
it("el enlace individual usa la auditoría vigente más reciente y excluye las retiradas", async () => {
  const { client, queries } = database([], [{ id: "latest" }]);
  expect(await existingPortalAudit(client, "case-1")).toBe("latest");
  expect(queries[0]?.filters).toContainEqual(["eq", "case_id", "case-1"]);
  expect(queries[0]?.filters).toContainEqual(["is", "retired_at", null]);
});

it.each(["READY", "ERROR", "COMPLETED"])(
  "ofrece recuperar archivos de un %s vacío aunque tenga auditoría",
  async (status) => {
    const actor = fakeAuthContext("user");
    const { client } = database(
      [
        {
          id: "empty",
          status,
          external_case_id: "CaVe-1",
          external_source: "FLOKZU",
          assigned_to: actor.sub,

          evidence: [{ count: 0 }],
        },
      ],
      [{ id: "audit-existing", case_id: "empty", status: "COMPLETED" }],
    );
    const result = await describeExistingPortalCases(
      client,
      actor,
      "000000001",
      tickets,
    );
    expect(result[0]?.existing).toMatchObject({
      evidenceCount: 0,
      canUpdate: true,
      auditId: "audit-existing",
    });
  },
);
it("una auditoría en curso impide ofrecer la sincronización de un expediente vacío", async () => {
  const actor = fakeAuthContext("user");
  const { client } = database(
    [
      {
        id: "empty",
        status: "DRAFT",
        external_case_id: "CaVe-1",
        external_source: "FLOKZU",
        assigned_to: actor.sub,

        evidence: [{ count: 0 }],
      },
    ],
    [{ id: "running", case_id: "empty", status: "RUNNING" }],
  );
  const result = await describeExistingPortalCases(
    client,
    actor,
    "000000001",
    tickets,
  );
  expect(result[0]?.existing?.canUpdate).toBe(false);
});
it("un borrador propio con auditoría y archivos sigue admitiendo sincronización", async () => {
  const actor = fakeAuthContext("user");
  const { client } = database(
    [
      {
        id: "draft",
        status: "DRAFT",
        external_case_id: "CaVe-1",
        external_source: "FLOKZU",
        assigned_to: actor.sub,

        evidence: [{ count: 3 }],
      },
    ],
    [{ id: "audit-existing", case_id: "draft", status: "COMPLETED" }],
  );
  const result = await describeExistingPortalCases(
    client,
    actor,
    "000000001",
    tickets,
  );
  expect(result[0]?.existing).toMatchObject({
    evidenceCount: 3,
    canUpdate: true,
    auditId: "audit-existing",
  });
});

it("un Asesor no recibe importación de un borrador ajeno", async () => {
  const { client } = database(
    [
      {
        id: "foreign",
        status: "DRAFT",
        external_case_id: "CaVe-1",
        external_source: "FLOKZU",
        assigned_to: "other-advisor",

        evidence: [{ count: 0 }],
      },
    ],
    [],
  );
  const result = await describeExistingPortalCases(
    client,
    fakeAuthContext("user"),
    "000000001",
    tickets,
  );
  expect(result[0]?.existing?.canUpdate).toBe(false);
});
