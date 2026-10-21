import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Search } from "lucide-react";
import {
  createCase,
  lookupFlokzuStudent,
  getCaseAssignmentOptions,
  type AppRole,
  type FlokzuPortalTicket,
} from "../lib/api";
import { capabilitiesForRole } from "../server/capabilities";
import { isLocalDashboardPreview } from "../lib/local-dashboard-preview";
import { goToCase } from "../lib/useHashRoute";
import { Button, Panel } from "./ui";

const control =
  "min-h-11 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";
const canSelectTicket = (ticket: FlokzuPortalTicket): boolean =>
  ticket.canImport && (!ticket.existing || ticket.existing.canUpdate);
const auditLink = (caseId: string, auditId: string): string =>
  `#/casos/${encodeURIComponent(caseId)}?audit=${encodeURIComponent(auditId)}`;
export function NewCasePanel({
  role = null,
  canWrite = false,
}: {
  role?: AppRole | null;
  canWrite?: boolean;
}): ReactNode {
  const [matricula, setMatricula] = useState("");
  const [tickets, setTickets] = useState<FlokzuPortalTicket[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState<"lookup" | "create" | null>(null);
  const [resolvedAudit, setResolvedAudit] = useState<{
    caseId: string;
    auditId: string;
  } | null>(null);
  const selectedTicket = tickets?.find(
    (ticket) => ticket.identifier === selected,
  );
  const [error, setError] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<
    Array<{ userId: string; name: string | null }>
  >([]);
  const [assignedTo, setAssignedTo] = useState("");
  const pending = useRef<{
    student: string;
    ticket: string;
    id: string;
  } | null>(null);
  const canAssign = capabilitiesForRole(role).canImportCases;
  const preview = isLocalDashboardPreview();
  useEffect(() => {
    if (canAssign && !preview)
      void getCaseAssignmentOptions()
        .then(setAssignees)
        .catch(() =>
          setError(
            "No se pudieron cargar los responsables. Puedes usar la asignación automática.",
          ),
        );
  }, [canAssign, preview]);
  async function lookup(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy("lookup");
    setError(null);
    setResolvedAudit(null);
    setTickets(null);
    setSelected("");
    try {
      setTickets(await lookupFlokzuStudent(matricula.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo consultar Flokzu.");
    } finally {
      setBusy(null);
    }
  }
  async function create() {
    if (busy || !selected) return;
    setBusy("create");
    setError(null);
    try {
      let request = pending.current;
      if (
        !request ||
        request.student !== matricula.trim() ||
        request.ticket !== selected
      ) {
        try {
          const saved = sessionStorage.getItem("flokzu-creation-request");
          const value = saved ? JSON.parse(saved) : null;
          request =
            value?.student === matricula.trim() &&
            value?.ticket === selected &&
            typeof value?.id === "string"
              ? value
              : null;
        } catch {
          request = null;
        }
        request ??= {
          student: matricula.trim(),
          ticket: selected,
          id: crypto.randomUUID(),
        };
        pending.current = request;
        sessionStorage.setItem(
          "flokzu-creation-request",
          JSON.stringify(request),
        );
      }
      const result = await createCase(
        request.student,
        request.ticket,
        request.id,
        assignedTo || undefined,
      );
      sessionStorage.removeItem("flokzu-creation-request");
      if (result.existingAuditId) {
        setResolvedAudit({
          caseId: result.id,
          auditId: result.existingAuditId,
        });
        setTickets(
          (current) =>
            current?.map((ticket) =>
              ticket.identifier === selected
                ? {
                    ...ticket,
                    existing: {
                      caseId: result.id,
                      status: result.status,
                      canUpdate: false,
                      auditId: result.existingAuditId!,
                    },
                  }
                : ticket,
            ) ?? null,
        );
        setSelected("");
        return;
      }
      goToCase(result.id);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "La carga no terminó. Reintenta para recuperar los archivos pendientes.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Crear expediente desde Flokzu
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Consulta una matrícula y elige la solicitud de cancelación. Se
          incorporarán los datos, comentarios, adjuntos e imágenes de ese
          ticket.
        </p>
      </header>
      {!canWrite ? (
        <Panel title="Solo lectura">
          <p>Tu rol no puede crear expedientes.</p>
        </Panel>
      ) : (
        <Panel
          title="Buscar alumno"
          description="La matrícula debe tener 9 dígitos y devolver una solicitud real en Flokzu."
        >
          {preview && (
            <p role="status" className="mb-4 text-sm text-warning">
              Vista previa local. La consulta de alumnos está deshabilitada.
            </p>
          )}
          <form
            onSubmit={(e) => void lookup(e)}
            className="flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end"
          >
            <label
              className="flex-1 text-sm font-medium"
              htmlFor="flokzu-student"
            >
              Matrícula
              <input
                id="flokzu-student"
                className={`${control} mt-2`}
                value={matricula}
                required
                inputMode="numeric"
                pattern="[0-9]{9}"
                maxLength={9}
                disabled={busy !== null || preview}
                onChange={(e) => {
                  setMatricula(e.target.value.trim());
                  setTickets(null);
                  setSelected("");
                  setError(null);
                  setResolvedAudit(null);
                }}
              />
            </label>
            <Button
              type="submit"
              loading={busy === "lookup"}
              disabled={
                busy !== null || preview || !/^\d{9}$/.test(matricula.trim())
              }
            >
              <Search size={16} aria-hidden="true" />
              Consultar Flokzu
            </Button>
          </form>
          {error && (
            <p
              role="alert"
              className="mt-4 whitespace-pre-wrap text-sm text-danger"
            >
              {error}
            </p>
          )}
          {resolvedAudit && (
            <p role="status" className="mt-4 text-sm">
              El expediente ya tiene auditoría.{" "}
              <a
                className="font-semibold text-brand underline underline-offset-4"
                href={auditLink(resolvedAudit.caseId, resolvedAudit.auditId)}
              >
                Ver auditoría existente
              </a>
            </p>
          )}
          {tickets !== null && (
            <div className="mt-6" aria-live="polite">
              {tickets.length === 0 ? (
                <p className="text-sm text-muted">
                  Flokzu no devolvió solicitudes para esta matrícula. Revisa los
                  9 dígitos y vuelve a consultar.
                </p>
              ) : (
                <>
                  <fieldset disabled={busy !== null} className="space-y-2">
                    <legend className="mb-3 text-sm font-semibold">
                      Solicitudes encontradas · {tickets.length}
                    </legend>
                    {tickets.map((t) => (
                      <div
                        key={t.identifier}
                        className="rounded-lg border border-line p-3 text-sm"
                      >
                        <label className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="flokzu-ticket"
                            value={t.identifier}
                            checked={selected === t.identifier}
                            disabled={!canSelectTicket(t)}
                            onChange={() => setSelected(t.identifier)}
                          />
                          <span>
                            <span className="font-semibold">
                              {t.identifier}
                            </span>
                            <span className="mt-1 block text-muted">
                              {!t.canImport
                                ? "Otro trámite · no corresponde a cancelaciones"
                                : t.existing?.canUpdate
                                  ? t.existing.evidenceCount === 0
                                    ? "Expediente sin evidencias · se importarán los archivos de su CaVe."
                                    : "Borrador existente · se actualizarán sus datos y archivos."
                                  : t.existing?.auditId
                                    ? "Este expediente ya tiene auditoría."
                                    : t.existing
                                      ? "Expediente existente · consulta sus datos y permisos."
                                      : "Solicitud de cancelación · disponible para crear expediente"}
                            </span>
                          </span>
                        </label>
                        {t.existing && (
                          <a
                            className="mt-2 inline-flex min-h-10 items-center font-semibold text-brand underline underline-offset-4"
                            href={
                              t.existing.auditId
                                ? auditLink(
                                    t.existing.caseId,
                                    t.existing.auditId,
                                  )
                                : `#/casos/${encodeURIComponent(t.existing.caseId)}`
                            }
                          >
                            {t.existing.auditId
                              ? "Ver auditoría existente"
                              : "Abrir expediente existente"}
                          </a>
                        )}
                      </div>
                    ))}
                  </fieldset>
                  {canAssign && !selectedTicket?.existing && (
                    <label className="mt-5 block max-w-xl text-sm">
                      Responsable
                      <select
                        className={`${control} mt-2`}
                        value={assignedTo}
                        disabled={busy !== null}
                        onChange={(e) => setAssignedTo(e.target.value)}
                      >
                        <option value="">Asignación automática</option>
                        {assignees.map((a) => (
                          <option key={a.userId} value={a.userId}>
                            {a.name ?? "Asesor sin nombre"}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <p className="mt-4 max-w-2xl text-sm text-muted">
                    Se adjuntarán únicamente los archivos del ticket
                    seleccionado. Los dictámenes históricos se conservarán como
                    contexto. Esta acción no ejecuta una auditoría.
                  </p>
                  <Button
                    className="mt-4"
                    variant="primary"
                    disabled={!selected || busy !== null}
                    loading={busy === "create"}
                    loadingLabel="Incorporando expediente de Flokzu"
                    onClick={() => void create()}
                  >
                    {busy === "create"
                      ? "Incorporando datos y archivos…"
                      : selectedTicket?.existing?.canUpdate
                        ? selectedTicket.existing.status === "DRAFT"
                          ? "Actualizar borrador con Flokzu"
                          : "Importar evidencias del CaVe"
                        : "Crear expediente con todo el contenido"}
                  </Button>
                </>
              )}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
