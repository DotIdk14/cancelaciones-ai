// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewCasePanel } from "../src/components/NewCasePanel";
import { createCase, lookupFlokzuStudent } from "../src/lib/api";
vi.mock("../src/lib/api", () => ({
  createCase: vi.fn(),
  lookupFlokzuStudent: vi.fn(),
  getCaseAssignmentOptions: vi.fn().mockResolvedValue([]),
}));
vi.mock("../src/lib/local-dashboard-preview", () => ({
  isLocalDashboardPreview: () => false,
}));
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.location.hash = "";
});
afterEach(cleanup);
it("exige consultar y elegir un CaVe real; otros trámites no se pueden seleccionar", async () => {
  vi.mocked(lookupFlokzuStudent).mockResolvedValue([
    { identifier: "CaVe-101", canImport: true },
    { identifier: "INSS-202", canImport: false },
  ]);
  vi.mocked(createCase).mockResolvedValue({ id: "case-1" } as never);
  render(<NewCasePanel role="user" canWrite />);
  fireEvent.change(screen.getByLabelText("Matrícula"), {
    target: { value: "000000001" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Consultar Flokzu" }));
  await screen.findByText("CaVe-101");
  expect(
    (screen.getByDisplayValue("INSS-202") as HTMLInputElement).disabled,
  ).toBe(true);
  const create = screen.getByRole("button", {
    name: "Crear expediente con todo el contenido",
  });
  expect((create as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByDisplayValue("CaVe-101"));
  fireEvent.click(create);
  await waitFor(() =>
    expect(createCase).toHaveBeenCalledWith(
      "000000001",
      "CaVe-101",
      expect.any(String),
      undefined,
    ),
  );
  await waitFor(() => expect(window.location.hash).toBe("#/casos/case-1"));
});
it("mantiene la misma identidad al reintentar una carga incompleta", async () => {
  vi.mocked(lookupFlokzuStudent).mockResolvedValue([
    { identifier: "CaVe-101", canImport: true },
  ]);
  vi.mocked(createCase).mockRejectedValue(new Error("Carga pendiente"));
  render(<NewCasePanel role="user" canWrite />);
  fireEvent.change(screen.getByLabelText("Matrícula"), {
    target: { value: "000000001" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Consultar Flokzu" }));
  await screen.findByText("CaVe-101");
  fireEvent.click(screen.getByDisplayValue("CaVe-101"));
  fireEvent.click(
    screen.getByRole("button", {
      name: "Crear expediente con todo el contenido",
    }),
  );
  await screen.findByRole("alert");
  fireEvent.click(
    screen.getByRole("button", {
      name: "Crear expediente con todo el contenido",
    }),
  );
  await waitFor(() => expect(createCase).toHaveBeenCalledTimes(2));
  expect(vi.mocked(createCase).mock.calls[0]?.[2]).toBe(
    vi.mocked(createCase).mock.calls[1]?.[2],
  );
});
it("gerencia permanece en solo lectura", () => {
  render(<NewCasePanel role="manager" />);
  expect(screen.getByText("Solo lectura")).toBeTruthy();
  expect(screen.queryByLabelText("Matrícula")).toBeNull();
});

it("muestra enlace directo a una auditoría existente y no permite volver a crear", async () => {
  vi.mocked(lookupFlokzuStudent).mockResolvedValue([
    {
      identifier: "CaVe-101",
      canImport: true,
      existing: {
        caseId: "existing-case",
        status: "DRAFT",
        canUpdate: false,
        auditId: "audit-1",
      },
    },
  ]);
  render(<NewCasePanel role="user" canWrite />);
  fireEvent.change(screen.getByLabelText("Matrícula"), {
    target: { value: "000000001" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Consultar Flokzu" }));
  const link = await screen.findByRole("link", {
    name: "Ver auditoría existente",
  });
  expect(link.getAttribute("href")).toBe("#/casos/existing-case?audit=audit-1");
  expect(
    (screen.getByDisplayValue("CaVe-101") as HTMLInputElement).disabled,
  ).toBe(true);
  expect(createCase).not.toHaveBeenCalled();
});
it("ofrece actualizar el borrador existente y conserva su ID al navegar", async () => {
  vi.mocked(lookupFlokzuStudent).mockResolvedValue([
    {
      identifier: "CaVe-101",
      canImport: true,
      existing: {
        caseId: "draft-1",
        status: "DRAFT",
        canUpdate: true,
        auditId: null,
      },
    },
  ]);
  vi.mocked(createCase).mockResolvedValue({ id: "draft-1" } as never);
  render(<NewCasePanel role="user" canWrite />);
  fireEvent.change(screen.getByLabelText("Matrícula"), {
    target: { value: "000000001" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Consultar Flokzu" }));
  await screen.findByText("CaVe-101");
  fireEvent.click(screen.getByDisplayValue("CaVe-101"));
  fireEvent.click(
    screen.getByRole("button", { name: "Actualizar borrador con Flokzu" }),
  );
  await waitFor(() => expect(window.location.hash).toBe("#/casos/draft-1"));
});

it("ofrece importar evidencias cuando el expediente vacío ya tiene una auditoría", async () => {
  vi.mocked(lookupFlokzuStudent).mockResolvedValue([
    {
      identifier: "CaVe-101",
      canImport: true,
      existing: {
        caseId: "empty-case",
        status: "READY",
        canUpdate: true,
        auditId: "old-audit",
        evidenceCount: 0,
      },
    },
  ]);
  vi.mocked(createCase).mockResolvedValue({
    id: "empty-case",
    status: "READY",
  } as never);
  render(<NewCasePanel role="user" canWrite />);
  fireEvent.change(screen.getByLabelText("Matrícula"), {
    target: { value: "000000001" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Consultar Flokzu" }));
  await screen.findByText(
    "Expediente sin evidencias · se importarán los archivos de su CaVe.",
  );
  expect(
    screen
      .getByRole("link", { name: "Ver auditoría existente" })
      .getAttribute("href"),
  ).toBe("#/casos/empty-case?audit=old-audit");
  expect(
    (screen.getByDisplayValue("CaVe-101") as HTMLInputElement).disabled,
  ).toBe(false);
  fireEvent.click(screen.getByDisplayValue("CaVe-101"));
  fireEvent.click(
    screen.getByRole("button", { name: "Importar evidencias del CaVe" }),
  );
  await waitFor(() => expect(window.location.hash).toBe("#/casos/empty-case"));
});
