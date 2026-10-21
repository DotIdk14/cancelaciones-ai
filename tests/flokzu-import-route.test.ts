import { beforeEach, expect, it, vi } from "vitest";
import handler from "../api/cases/index";
import { fakeAuthContext } from "./helpers/auth";
import { setTestEnv } from "./helpers/env";
import type { ApiRequest, ApiResponse } from "../src/server/http";
const client = vi.hoisted(() => vi.fn());
vi.mock("../src/server/insforge", () => ({ createServerClient: client }));
const res = () => {
  const r = {
    statusCode: 200,
    body: "",
    setHeader: vi.fn(),
    appendHeader: vi.fn(),
    end(value: unknown) {
      r.body = String(value ?? "");
    },
  };
  return r as unknown as ApiResponse & { body: string };
};
beforeEach(() => {
  setTestEnv();
  client.mockReset();
});
it.each(["user", "coordinator", "manager"] as const)(
  "retira multipart Excel para %s antes de acceder a persistencia",
  async (role) => {
    const response = res();
    await handler(
      {
        method: "POST",
        headers: { "content-type": "multipart/form-data" },
        query: {},
        auth: fakeAuthContext(role),
      } as ApiRequest,
      response,
    );
    expect(response.statusCode).toBe(role === "manager" ? 403 : 415);
    expect(client).not.toHaveBeenCalled();
  },
);
it("rechaza matrícula inválida antes de consultar el proveedor", async () => {
  const response = res();
  await handler(
    {
      method: "GET",
      headers: {},
      query: { view: "flokzu-student", studentIdentifier: "123" },
      auth: fakeAuthContext("user"),
    } as ApiRequest,
    response,
  );
  expect(response.statusCode).toBe(400);
  expect(client).not.toHaveBeenCalled();
});
