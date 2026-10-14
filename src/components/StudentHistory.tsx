import { ModalShell } from "./OperationProgressDialog";
import { AuditResultPanel } from "./AuditResultPanel";
import { isLocalDashboardPreview } from "../lib/local-dashboard-preview";
import { previewStudentHistory } from "../lib/local-student-history-preview";
import { WORKFLOW_STATE_LABELS } from "../lib/labels";
import { useEffect, useRef, useState } from "react";
import {
  getStudentHistory,
  getCase,
  getAuditVersion,
  reconcileCaseRequests,
  type AuditDetail,
  type CaseDetailResponse,
} from "../lib/api";
import {
  classifyRelation,
  reportedFields,
  type StudentHistory as History,
  type StudentHistoryItem,
} from "../lib/student-history";
import { formatDateTime } from "../lib/format";
import { RESULT_LABELS } from "../lib/labels";
import { Button } from "./ui";
const resultLabel = (value: string | null) =>
  value
    ? (RESULT_LABELS[value as keyof typeof RESULT_LABELS] ?? value)
    : "Sin resultado";
const relationLabels = {
  SAME_TICKET: "Mismo ticket confirmado; requiere conciliación",
  POSSIBLE_DUPLICATE: "Posible duplicado de solicitud",
  DIFFERENT_REQUESTS: "Solicitudes independientes",
  UNVERIFIED:
    "Relación pendiente de verificar; compartir matrícula no prueba duplicidad",
};
export function StudentHistory({
  caseId,
  studentIdentifier,
  canReconcile,
  previewHistory,
}: {
  caseId: string;
  studentIdentifier: string | null;
  canReconcile: boolean;
  previewHistory?: History;
}) {
  const activeCase = useRef(caseId);
  activeCase.current = caseId;
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<History | null>(
    previewHistory ?? null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<StudentHistoryItem[]>([]);
  const [details, setDetails] = useState<CaseDetailResponse[]>([]);
  const [historicalAudit, setHistoricalAudit] = useState<AuditDetail | null>(
    null,
  );
  const [offset, setOffset] = useState(0);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    setOpen(false); setBusy(false); setNote(""); setError(""); setOffset(0);
    setHistory(null);
    setHistoricalAudit(null);
    setSelected([]);
    setDetails([]);
    setSaved(false);
    if (previewHistory) {
      setHistory(previewHistory);
      return;
    }
    if (studentIdentifier)
      getStudentHistory(caseId)
        .then((data) => {
          if (active) setHistory(data);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [caseId, studentIdentifier, previewHistory]);
  async function load(offset = 0) {
    setOffset(offset);
    if (previewHistory) {
      setHistory(previewHistory);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await getStudentHistory(caseId, offset);
      if(activeCase.current===caseId) setHistory(data);
    } catch {
      if(activeCase.current!==caseId) return;
      setError(
        "El historial no está disponible. Puedes seguir trabajando en el expediente actual.",
      );
    } finally {
      if(activeCase.current===caseId) setBusy(false);
    }
  }
  async function compare() {
    if (previewHistory) {
      setError(
        "La vista local usa datos ficticios; abre un expediente autenticado para consultar evidencias.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await Promise.all(selected.map((item) => getCase(item.id)));
      if(activeCase.current===caseId) setDetails(data);
    } catch {
      setError("No se pudieron consultar los expedientes seleccionados.");
    } finally {
      setBusy(false);
    }
  }
  async function reconcile(sameRequest: boolean, primaryId: string | null) {
    if (selected.length !== 2) return;
    setBusy(true);
    setError("");
    try {
      await reconcileCaseRequests(selected[0]!.id, {
        otherId: selected[1]!.id,
        sameRequest,
        primaryId,
        note,
      });
      if(activeCase.current===caseId) { setSaved(true); await load(); }
    } catch {
      setError(
        "No se guardó la conciliación. Revisa las decisiones previas y que no haya una auditoría en curso.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!studentIdentifier) return null;
  return (
    <section aria-label="Historial de matrícula">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>
          {history && history.totalCases > 1
            ? "Esta matrícula tiene " +
              (history.totalCases - 1) +
              (history.totalCases === 2
                ? " expediente adicional"
                : " expedientes adicionales")
            : "Matrícula " + studentIdentifier}
        </span>
        <Button
          variant="ghost"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            if (!open) void load();
          }}
        >
          Ver historial
        </Button>
      </div>
      {open && (
        <ModalShell
          variant="drawer"
          drawerClassName="student-history-panel"
          title={"Historial de matrícula · " + studentIdentifier}
          closeLabel="Cerrar historial"
          onClose={() => setOpen(false)}
        >
          <div className="flokzu-panel-scroll space-y-4">
            {error && <p role="alert">{error}</p>}
            {busy && <p role="status">Consultando expedientes…</p>}
            {history && (
              <>
                <p className="text-sm text-muted">
                  Nombre reportado:{" "}
                  {history.items[0]?.studentName ?? "No disponible"} ·{" "}
                  {history.totalCases} expedientes · {history.uniqueTickets}{" "}
                  tickets CaVe · {history.uniqueRequests} solicitudes sin
                  secundarios conciliados · {history.totalAudits} ejecuciones de
                  auditoría · {history.totalEvidence} evidencias · Última
                  solicitud: {history.lastRequest ?? "No disponible"}
                </p>
                <p className="text-sm text-muted">
                  El historial incluye reales y pruebas, etiquetados por
                  expediente. Cada ticket conserva sus evidencias y sus
                  resoluciones.
                </p>
                <div
                  role="region"
                  aria-label="Solicitudes de la matrícula"
                  tabIndex={0}
                  className="overflow-x-auto"
                >
                  <table className="w-full text-left text-sm [&_td]:align-top [&_td]:px-3 [&_td]:py-3 [&_tr]:border-b [&_tr]:border-line [&_th]:px-3 [&_th]:py-3">
                    <thead>
                      <tr>
                        <th scope="col">Comparar</th>
                        <th>Solicitud y fechas</th>
                        <th>Política y estado</th>
                        <th>Responsable y creador</th>
                        <th>Resultados y versiones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.items.map((item) => {
                        const fields = reportedFields(item.flokzuData);
                        return (
                          <tr key={item.id}>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={
                                  "Comparar " + (item.externalCaseId ?? item.id)
                                }
                                checked={selected.some((x) => x.id === item.id)}
                                disabled={
                                  selected.length === 2 &&
                                  !selected.some((x) => x.id === item.id)
                                }
                                onChange={(event) => {
                                  setDetails([]);
                                  setSaved(false);
                                  setSelected(
                                    event.target.checked
                                      ? [...selected, item]
                                      : selected.filter(
                                          (x) => x.id !== item.id,
                                        ),
                                  );
                                }}
                              />
                            </td>
                            <td>
                              <a href={"#/casos/" + item.id}>
                                {item.externalCaseId ?? "Expediente manual"}
                              </a>
                              <p>{formatDateTime(item.createdAt)}</p>
                              <p>
                                Solicitud:{" "}
                                {fields.requestDate ?? "Sin fecha Flokzu"}
                              </p>
                              <p>
                                {item.isTest ? "Prueba" : "Real"} ·{" "}
                                {item.evidenceCount} evidencias
                              </p>
                            </td>
                            <td>
                              {fields.policy ?? "Sin política reportada"}
                              <p>{fields.status ?? item.status}</p>
                              <p>
                                {WORKFLOW_STATE_LABELS[
                                  item.workflowState as keyof typeof WORKFLOW_STATE_LABELS
                                ] ?? item.workflowState}
                              </p>
                            </td>
                            <td>
                              Asignado:{" "}
                              {item.assignedName ??
                                item.assignedTo ??
                                "Sin asignar"}
                              <p>
                                Creador:{" "}
                                {item.creatorName ??
                                  item.creatorId ??
                                  "No disponible"}
                              </p>
                            </td>
                            <td>
                              IA histórica: {resultLabel(item.latestResult)}
                              <p>
                                Final humana:{" "}
                                {resultLabel(item.finalResolution)}
                              </p>
                              <p>
                                Fundamento:{" "}
                                {item.normativeSection ?? "Consultar dictamen"}
                              </p>
                              <details>
                                <summary>
                                  {item.auditCount} versiones de auditoría
                                </summary>
                                {item.versions.map((v) => (
                                  <p key={v.id}>
                                    {formatDateTime(v.createdAt)} · {v.status} ·{" "}
                                    {resultLabel(v.result)}
                                    {v.retired ? " · Retirado" : ""}
                                    {!previewHistory &&
                                      v.status === "COMPLETED" && (
                                        <Button
                                          variant="ghost"
                                          disabled={busy}
                                          onClick={() => {
                                            setBusy(true);
                                            getAuditVersion(item.id, v.id)
                                              .then(audit=>{if(activeCase.current===caseId) setHistoricalAudit(audit);})
                                              .catch(() =>
                                                setError(
                                                  "No se pudo consultar esta versión.",
                                                ),
                                              )
                                              .finally(() => setBusy(false));
                                          }}
                                        >
                                          Consultar versión
                                        </Button>
                                      )}
                                  </p>
                                ))}
                              </details>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={busy || selected.length !== 2}
                    onClick={() => void compare()}
                  >
                    Comparar dos expedientes
                  </Button>
                  {history.nextOffset !== null && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void load(history.nextOffset!)}
                    >
                      Siguiente página
                    </Button>
                  )}
                  {offset > 0 ? (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void load(0)}
                    >
                      Primera página
                    </Button>
                  ) : null}
                </div>
                {selected.length === 2 && (
                  <p className="text-sm text-muted">
                    {
                      relationLabels[
                        classifyRelation(
                          {
                            externalCaseId: selected[0]!.externalCaseId,
                            flokzuData: selected[0]!.flokzuData,
                          },
                          {
                            externalCaseId: selected[1]!.externalCaseId,
                            flokzuData: selected[1]!.flokzuData,
                          },
                        )
                      ]
                    }
                  </p>
                )}
              </>
            )}
            {historicalAudit && (
              <section aria-label="Versión histórica del dictamen">
                <h3>
                  Versión histórica ·{" "}
                  {formatDateTime(historicalAudit.createdAt)}
                </h3>
                <p className="text-sm text-muted">
                  Consulta de una versión original, sin sustituir la resolución
                  actual.
                </p>
                <AuditResultPanel
                  audit={historicalAudit}
                  canEditComments={false}
                />
              </section>
            )}
            {details.length === 2 && (
              <>
                <p className="text-sm text-muted">
                  Comparación de datos registrados, sin IA. Resultados distintos
                  pueden corresponder a solicitudes y momentos diferentes.
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  {details.map((d) => {
                    const fields = reportedFields(d.case.flokzuData);
                    return (
                      <section key={d.case.id}>
                        <h3>
                          <a href={"#/casos/" + d.case.id}>
                            {d.case.externalCaseId ?? "Expediente manual"}
                          </a>
                        </h3>
                        <dl>
                          {Object.entries(fields).map(([key, value]) => (
                            <div key={key}>
                              <dt>
                                {
                                  (
                                    {
                                      requestDate: "Fecha de solicitud",
                                      policy: "Política reportada",
                                      motive: "Motivo",
                                      description: "Descripción",
                                      originalTicket: "Ticket original",
                                      comments: "Comentarios",
                                      status: "Estado Flokzu",
                                    } as Record<string, string>
                                  )[key]
                                }
                              </dt>
                              <dd>{value ?? "No disponible"}</dd>
                            </div>
                          ))}
                        </dl>
                        <p>
                          Dictamen:{" "}
                          {resultLabel(
                            d.audit?.resultJson?.audit.result ?? null,
                          )}{" "}
                          ·{" "}
                          {d.auditIsCurrent === false
                            ? "Histórico"
                            : "Consultar vigencia"}
                        </p>
                        <p>
                          Resolución:{" "}
                          {resultLabel(d.effectiveResolution?.result ?? null)}
                        </p>
                        <p>Fundamento del dictamen IA: {d.audit?.resultJson?.audit.procedureSection ?? 'Sin fundamento registrado'}</p>
                      <h4>Evidencias del expediente de origen</h4>
                        <ul>
                          {d.evidences.map((e) => (
                            <li key={e.id}>
                              {e.filename} · {e.mimeType} ·{" "}
                              {formatDateTime(e.createdAt)} ·{" "}
                              {e.processingStatus}
                              <p className="break-all text-xs">
                                SHA-256: {e.hash}
                                {details.some(
                                  (other) =>
                                    other.case.id !== d.case.id &&
                                    other.evidences.some(
                                      (x) => x.hash === e.hash,
                                    ),
                                )
                                  ? " · Archivo idéntico en ambos expedientes"
                                  : ""}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                </div>
                {canReconcile && !previewHistory && !saved && (
                  <fieldset disabled={busy}>
                    <legend>Conciliación de Coordinación</legend>
                    <label>
                      Motivo de la decisión
                      <textarea
                        className="w-full"
                        maxLength={2000}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        disabled={!note.trim()}
                        onClick={() => void reconcile(false, null)}
                      >
                        Confirmar solicitudes diferentes
                      </Button>
                      {selected.map((item) => (
                        <Button
                          key={item.id}
                          variant="secondary"
                          disabled={!note.trim()}
                          onClick={() => void reconcile(true, item.id)}
                        >
                          Misma solicitud; principal{" "}
                          {item.externalCaseId ?? item.id.slice(0, 8)}
                        </Button>
                      ))}
                    </div>
                    <p className="text-sm text-muted">
                      La decisión conserva ambos expedientes, sus evidencias,
                      revisiones y costos. El secundario no podrá ejecutar otra
                      auditoría; no se trasladan archivos ni dictámenes.
                    </p>
                  </fieldset>
                )}
                {saved && (
                  <p role="status">
                    Conciliación registrada; el historial se conserva.
                  </p>
                )}
              </>
            )}
          </div>
        </ModalShell>
      )}
    </section>
  );
}

export function HistoryForCase({ caseId }: { caseId: string }) {
  const [identifier, setIdentifier] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    if (isLocalDashboardPreview()) return;
    getStudentHistory(caseId)
      .then((h) => {
        if (active) setIdentifier(h.studentIdentifier);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [caseId]);
  if (isLocalDashboardPreview())
    return (
      <StudentHistory
        caseId={caseId}
        studentIdentifier={previewStudentHistory.studentIdentifier}
        canReconcile={false}
        previewHistory={previewStudentHistory}
      />
    );
  if (error) return <p role="alert">El historial no está disponible.</p>;
  return identifier ? (
    <StudentHistory
      caseId={caseId}
      studentIdentifier={identifier}
      canReconcile={false}
    />
  ) : (
    <p role="status">Consultando matrícula…</p>
  );
}
