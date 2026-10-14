import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { classifyRelation } from "../src/lib/student-history";
import { auditLifecycle } from "../src/lib/audit-lifecycle";
import { assertNoRedundantAudit } from "../src/server/student-history";
import { deleteUnreviewedAudit } from "../src/server/cases";
import { createFakeDatabase } from "./helpers/fake-database";
import type { InsForgeClient } from "../src/server/insforge";
const ids = Array.from(
  { length: 8 },
  (_, i) => "00000000-0000-4000-8000-00000000000" + i,
);
let db: PGlite;
const history = async (id: string, offset = 0, limit = 20) =>
  (
    await db.query<{
      data: {
        totalCases: number;
        totalAudits: number;
        totalEvidence: number;
        uniqueTickets: number;
        uniqueRequests: number;
        items: Array<{
          id: string;
          externalCaseId: string | null;
          versions: unknown[];
        }>;
        nextOffset: number | null;
        studentIdentifier: string;
      };
    }>("SELECT student_case_history($1,$2,$3,$4) AS data", [
      id,
      ids[0],
      offset,
      limit,
    ])
  ).rows[0]!.data;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE project_admin;
 CREATE TABLE app_memberships(user_id uuid, role text);
 CREATE TABLE cases(id uuid PRIMARY KEY, student_identifier text, student_name text, created_by uuid,assigned_to uuid, external_case_id text, flokzu_data jsonb,status text,is_test boolean,created_at timestamptz);
 CREATE TABLE evidence(id uuid PRIMARY KEY,case_id uuid REFERENCES cases(id),hash text,storage_path text);
 CREATE TABLE audits(id uuid PRIMARY KEY,case_id uuid REFERENCES cases(id),status text,result_json jsonb,provider_metadata jsonb,created_at timestamptz);
 CREATE TABLE case_reviews(id uuid,case_id uuid,audit_id uuid,result text,coordinator_decision text,coordinator_resolution text);
 INSERT INTO auth.users VALUES ('${ids[0]}'); INSERT INTO app_memberships VALUES ('${ids[0]}','coordinator');`);
  await db.exec(
    await readFile(
      "migrations/20261013120000_student-history-reconciliation.sql",
      "utf8",
    ),
  );
  for (let i = 1; i < 5; i++)
    await db.query("INSERT INTO cases VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [
      ids[i],
      "0000123",
      "Reportado",
      ids[0],
      null,
      i <= 2 ? "CaVe-" + i : null,
      {},
      "READY",
      i === 4,
      "2026-10-0" + i,
    ]);
  await db.query("INSERT INTO evidence VALUES($1,$2,$3,$4)", [
    ids[5],
    ids[1],
    "hash",
    "original",
  ]);
  await db.query("INSERT INTO audits VALUES($1,$2,$3,$4,$5,$6,NULL,NULL)", [
    ids[6],
    ids[1],
    "COMPLETED",
    { audit: { result: "CANCELACION_PROCEDENTE" } },
    { usage: { cost: 0.01 } },
    "2026-10-03",
  ]);
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe("historial sin mezclar solicitudes", () => {
 it('un preflight malformado no permite gastar tokens', async()=>{
 await expect(assertNoRedundantAudit({database:{rpc:async()=>({data:{},error:null})}} as unknown as InsForgeClient,ids[1]!)).rejects.toMatchObject({status:503});
 });
  it("incluye manuales y CaVe, conserva ceros y pagina en servidor", async () => {
    const p = await history(ids[1]!, 0, 2);
    expect(p.studentIdentifier).toBe("0000123");
    expect(p.totalCases).toBe(4);
    expect(p.uniqueTickets).toBe(2);
    expect(p.totalAudits).toBe(1);
    expect(p.totalEvidence).toBe(1);
    expect(p.items).toHaveLength(2);
    expect(p.nextOffset).toBe(2);
    expect(p.items[0]!.externalCaseId).toBeNull();
    expect((await history(ids[1]!, 2, 2)).items).toHaveLength(2);
  });
  it("dos manuales no confirman duplicidad y dos CaVe distintos son independientes", () => {
    expect(classifyRelation({}, {})).toBe("UNVERIFIED");
    expect(
      classifyRelation(
        { externalCaseId: "CaVe-1" },
        { externalCaseId: "CaVe-2" },
      ),
    ).toBe("DIFFERENT_REQUESTS");
    expect(
      classifyRelation(
        { externalCaseId: "cave-1" },
        { externalCaseId: "CaVe-1" },
      ),
    ).toBe("SAME_TICKET");
  });
  it("detecta manual e importado con misma referencia original como indicio", () => {
    expect(
      classifyRelation(
        { flokzuData: { originalTicketId: "CaVe-1" } },
        { flokzuData: { originalTicketId: "CaVe-1" } },
      ),
    ).toBe("POSSIBLE_DUPLICATE");
  });
  it("permite auditar tickets diferentes aunque la matrícula exista", async () => {
    for (const id of [ids[1], ids[2]])
      expect(
        (
          await db.query<{ data: { blocked: boolean } }>(
            "SELECT audit_relation_preflight($1) data",
            [id],
          )
        ).rows[0]!.data.blocked,
      ).toBe(false);
  });
  it("autoriza en servidor y rechaza matriculas ajenas a un actor no autorizado", async () => {
    await expect(
      db.query("SELECT student_case_history($1,$2,0,20)", [ids[1], ids[7]]),
    ).rejects.toThrow("Sin permiso");
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "SELECT has_function_privilege('authenticated','student_case_history(uuid,uuid,integer,integer)','EXECUTE') allowed",
        )
      ).rows[0]!.allowed,
    ).toBe(false);
  });
  it("no concilia reales con pruebas ni permite sobrescribir una decisión", async () => {
    await expect(
      db.query("SELECT reconcile_case_requests($1,$2,$1,true,$3,$4)", [
        ids[1],
        ids[4],
        "Motivo",
        ids[0],
      ]),
    ).rejects.toThrow("incompatibles");
  });
  it("concilia sin alterar evidencias, revisiones, costos ni dictámenes", async () => {
    const before = (await db.query("SELECT * FROM audits")).rows;
    await db.query("SELECT reconcile_case_requests($1,$2,$1,true,$3,$4)", [
      ids[1],
      ids[3],
      "Misma solicitud verificada",
      ids[0],
    ]);
    expect((await history(ids[1]!)).uniqueRequests).toBe(3);
    expect((await db.query("SELECT * FROM audits")).rows).toEqual(before);
    expect((await db.query("SELECT storage_path FROM evidence")).rows).toEqual([
      { storage_path: "original" },
    ]);
    expect(
      (
        await db.query<{ data: { blocked: boolean } }>(
          "SELECT audit_relation_preflight($1) data",
          [ids[3]],
        )
      ).rows[0]!.data.blocked,
    ).toBe(true);
    await expect(
      db.query("SELECT reconcile_case_requests($1,$2,NULL,false,$3,$4)", [
        ids[1],
        ids[3],
        "Otro motivo",
        ids[0],
      ]),
    ).rejects.toThrow();
  });
  it("un mismo CaVe sin conciliar bloquea; el nombre no vincula solicitudes", async () => {
    await db.query(
      "INSERT INTO cases(id,student_identifier,student_name,created_by,external_case_id,status,is_test,created_at) VALUES($1,$2,$3,$4,$5,$6,false,now())",
      [ids[7], "999", "Otro nombre", ids[0], "cave-2", "READY"],
    );
    expect(
      (
        await db.query<{ data: { blocked: boolean } }>(
          "SELECT audit_relation_preflight($1) data",
          [ids[2]],
        )
      ).rows[0]!.data.blocked,
    ).toBe(true);
    expect((await history(ids[1]!)).totalCases).toBe(4);
    const identities = (await db.query<{data:{tickets:number;requests:number}}>('SELECT dashboard_request_identities($1) data',[[ids[2],ids[7]]])).rows[0]!.data;
    expect(identities.tickets).toBe(1); expect(identities.requests).toBe(1);
  });
  it("los contadores operativos distinguen matrículas, tickets y expedientes, excluyen pruebas", async () => {
    const data = (
      await db.query<{
        data: {
          students: number;
          tickets: number;
          caseFiles: number;
          requests: number;
        };
      }>("SELECT dashboard_request_identities($1) data", [ids.slice(1, 5)])
    ).rows[0]!.data;
    expect(data).toEqual({
      students: 1,
      tickets: 2,
      caseFiles: 3,
      requests: 2,
    });
  });
  it("bloquea antes de OpenRouter y falla cerrado si no puede verificar", async () => {
    const rpc = vi.fn(async () => ({
      data: { blocked: true, primaryId: ids[1] },
      error: null,
    }));
    await expect(
      assertNoRedundantAudit(
        { database: { rpc } } as unknown as InsForgeClient,
        ids[3]!,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      assertNoRedundantAudit(
        {
          database: { rpc: async () => ({ data: null, error: "offline" }) },
        } as unknown as InsForgeClient,
        ids[3]!,
      ),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("distingue dictamen vigente, histórico, retirado, fallido y pendiente", () => {
    const a = { status: "COMPLETED", result_json: { audit: { result: "X" } } };
    expect(auditLifecycle("COMPLETED", a, true)).toBe("CURRENT");
    expect(auditLifecycle("COMPLETED", a, false)).toBe("STALE");
    expect(auditLifecycle("COMPLETED", null, null)).toBe("RETIRED_OR_MISSING");
    expect(auditLifecycle("READY", null, null, { status: "ERROR" })).toBe(
      "FAILED",
    );
    expect(auditLifecycle("READY", null, null)).toBe("PENDING");
  });
  it("retirar un dictamen preserva sus costos y originales", async () => {
    const fake = createFakeDatabase();
    fake.seed("audits", {
      id: "a",
      case_id: "c",
      status: "COMPLETED",
      provider_metadata: { usage: { cost: 1 } },
      result_json: { original: true },
    });
    fake.seed("cases", { id: "c", status: "COMPLETED" });
    fake.seed("evidence", { id: "e", case_id: "c", storage_path: "original" });
    await deleteUnreviewedAudit(fake.client, "c", "a");
    expect(fake.rows("audits")[0]).toMatchObject({
      result_json: { original: true },
      provider_metadata: { usage: { cost: 1 } },
      retired_at: expect.any(String),
    });
    expect(fake.rows("evidence")).toHaveLength(1);
    expect(fake.removedStoragePaths).toHaveLength(0);
  });
});
