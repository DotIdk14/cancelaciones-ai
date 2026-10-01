  // =============================================================================
// Panel de resultado de la auditoría (sección 23 del encargo).
// Muestra EXACTAMENTE lo que devolvió el modelo. Nunca inventa un dictamen:
// si `resultJson` es null, se dice que no hay resultado, nada más.
// =============================================================================

import type { ReactNode } from 'react';
import type { AuditDetail, Evidence } from '../lib/api';
import type { TemporalAnalysis } from '../skills/audit/types';
import {
  DASH,
  formatCost,
  formatDate,
  formatDateTime,
  formatFactValue,
  formatLatency,
  formatPercent,
  shortId,
  textOrDash,
} from '../lib/format';
import { RESULT_DESCRIPTIONS, RESULT_LABELS, RESULT_TONE, errorCategoryLabel } from '../lib/labels';
import { Badge, Chip, DataRow, SectionTitle } from './ui';
import type { Tone } from './ui';

export interface AuditResultPanelProps {
  audit: AuditDetail;
  evidences: Evidence[];
}

/** Etiquetas del vocabulario cerrado de relaciones temporales. */
const RELATION_LABELS: Record<TemporalAnalysis['relationToCycleStart'], string> = {
  ANTES_DEL_INICIO: 'La solicitud es anterior al inicio de ciclo',
  MISMO_DIA_DEL_INICIO: 'La solicitud es el mismo día del inicio de ciclo',
  DESPUES_DEL_INICIO: 'La solicitud es posterior al inicio de ciclo',
  NO_DETERMINABLE: 'No determinable con las evidencias disponibles',
};

export function AuditResultPanel({ audit, evidences }: AuditResultPanelProps): ReactNode {
  const result = audit.resultJson;

  if (result === null) {
    // El servidor valida con Zod: si esto ocurre, no hay dictamen que mostrar.
    return (
      <div role="alert" className="rounded-2xl border border-danger/40 bg-danger/10 p-5">
        <p className="text-sm font-semibold text-danger">No hay resultado de auditoría</p>
        <p className="mt-1 text-sm text-ink">
          El registro de la auditoría no contiene un resultado utilizable
          {audit.errorCategory !== null ? ` (${errorCategoryLabel(audit.errorCategory)})` : ''}. No se emite
          ningún dictamen. Vuelve a auditar el caso.
        </p>
      </div>
    );
  }

  const { audit: assessment, case: caseData, facts, timeline, conflicts, model, usage } = result;
  // Audiencias anteriores a `temporalAnalysis` no tienen análisis temporal.
  const temporal = (result as { temporalAnalysis?: TemporalAnalysis }).temporalAnalysis ?? null;
  const isInsufficient = assessment.result === 'EVIDENCIA_INSUFICIENTE';
  const tone: Tone = RESULT_TONE[assessment.result] ?? 'neutral';
  const safeEvidences = arrayOrEmpty(evidences);
  const safeFacts = arrayOrEmpty(facts);
  const safeTimeline = arrayOrEmpty(timeline);
  const safeConflicts = arrayOrEmpty(conflicts);
  const missingEvidence = arrayOrEmpty(assessment.missingEvidence);
  const procedureChecks = arrayOrEmpty(assessment.procedureChecks);
  const supportingEvidenceIds = arrayOrEmpty(assessment.supportingEvidenceIds);
  const observations = arrayOrEmpty(assessment.observations);
  const provisionalResolution = assessment.provisionalResolution ?? null;
  const hasProcedureChecks = procedureChecks.length > 0;

  // Resuelve ids de evidencia -> nombre de archivo del caso.
  const namesById = new Map(safeEvidences.map((item) => [item.id, item.filename]));
  const fileName = (id: string): string => namesById.get(id) ?? `Evidencia ${shortId(id)}`;

  const usageValues = [usage.promptTokens, usage.completionTokens, usage.totalTokens, usage.estimatedCostUSD];
  const hasUsage = usageValues.some((value) => value !== null);

  return (
    <div
      className={`rounded-2xl border p-5 ${
        isInsufficient ? 'border-warning/40 bg-warning/5' : 'border-success/30 bg-surface-1'
      }`}
    >
      {/* ------------------------------------------------- Dictamen */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Resultado de la auditoría</p>
          <div className="mt-2">
            <span
              className={`inline-flex items-center rounded-2xl border px-4 py-2 text-lg font-bold ${
                isInsufficient
                  ? 'border-warning/50 bg-warning/15 text-warning'
                  : tone === 'success'
                    ? 'border-success/50 bg-success/10 text-success'
                    : 'border-brand/50 bg-brand/10 text-brand'
              }`}
            >
              {RESULT_LABELS[assessment.result]}
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            {RESULT_DESCRIPTIONS[assessment.result]}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Confianza</p>
          <p className="text-2xl font-bold text-ink">{formatPercent(assessment.confidence)}</p>
        </div>
      </div>

      {isInsufficient && (
        <div
          role="status"
          className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning"
        >
          <p className="font-semibold">SE NECESITA INFORMACIÓN ADICIONAL</p>
          <p className="mt-1 text-ink">
            Qué sí pude comprobar: hechos relevantes y checks acreditados. Qué todavía no puedo comprobar: la
            evidencia que falta para cerrar la condición normativa.
          </p>
          {missingEvidence.length > 0 && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {missingEvidence.map((item) => (
                <div key={`${item.title}-${item.relatedProcedureSection}`} className="rounded-xl border border-warning/30 bg-surface-2 p-3">
                  <p className="font-semibold text-ink">{item.title}</p>
                  <p className="mt-1 text-sm text-ink">{item.reason}</p>
                  <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted">Qué puedes compartir</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-ink">
                    {arrayOrEmpty(item.acceptedEvidence).map((entry) => <li key={`${item.title}-${entry}`}>{entry}</li>)}
                  </ul>
                  <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted">Sección aplicable</p>
                  <p className="mt-1 text-sm text-ink">{item.relatedProcedureSection}</p>
                  {arrayOrEmpty(item.relatedEvidenceIds).length > 0 && (
                    <>
                      <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted">Evidencias relacionadas</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {arrayOrEmpty(item.relatedEvidenceIds).map((id) => (
                          <Chip key={`${item.title}-${id}`} title={fileName(id)}>{fileName(id)}</Chip>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="mt-4">
            <button
              type="button"
              onClick={() => {
                const uploader = document.getElementById('evidence-uploader');
                if (uploader) {
                  uploader.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  uploader.focus();
                }
              }}
              className="rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm font-medium text-warning transition-colors hover:bg-warning/15"
            >
              Subir evidencias faltantes
            </button>
          </div>
        </div>
      )}

      {isInsufficient && (
        <section aria-label="Orientación provisional" className="mt-4 rounded-xl border border-brand/30 bg-brand/5 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Orientación provisional</p>
          {provisionalResolution ? (
            <>
              <p className="mt-1 text-base font-semibold text-ink">{RESULT_LABELS[provisionalResolution.result]}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink">{provisionalResolution.rationale}</p>
              <p className="mt-2 text-xs text-muted">Sección del procedimiento: {provisionalResolution.procedureSection}</p>
              {arrayOrEmpty(provisionalResolution.evidenceIds).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {arrayOrEmpty(provisionalResolution.evidenceIds).map((id) => (
                    <Chip key={`provisional-${id}`} title={fileName(id)}>{fileName(id)}</Chip>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-ink">Esta auditoría anterior no guardó una orientación provisional.</p>
          )}
        </section>
      )}

      {/* ------------------------------------------------- Regla y razonamiento */}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <SectionTitle>Regla</SectionTitle>
          <p className="mt-1 break-words text-sm text-ink">{textOrDash(assessment.rule)}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <SectionTitle>Sección del procedimiento</SectionTitle>
          <p className="mt-1 break-words text-sm text-ink">{textOrDash(assessment.procedureSection)}</p>
        </div>
      </div>

      <div className="mt-4">
        <SectionTitle>Razonamiento</SectionTitle>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
          {textOrDash(assessment.reasoning)}
        </p>
      </div>

      {/* ------------------------------------------------- Datos del caso */}
      <div className="mt-5">
        <SectionTitle>Datos del caso</SectionTitle>
        <dl className="mt-1">
          <DataRow label="Matrícula" value={caseData.matricula ?? DASH} />
          <DataRow label="Nombre" value={caseData.studentName ?? DASH} />
          <DataRow label="Programa" value={caseData.program ?? DASH} />
          <DataRow label="Ciclo" value={caseData.cycle ?? DASH} />
          <DataRow label="Fecha inicio ciclo" value={caseData.cycleStartDate ?? DASH} />
        </dl>
      </div>

      {/* ------------------------------------------------- Análisis temporal
          La fecha de inicio de ciclo es una fecha CRÍTICA: de ella depende que el
          dictamen sea cancelación de venta o baja. Se muestra junto a la fecha de
          la solicitud y a su relación para que la comparación sea auditable, y
          nunca se rellena con una fecha administrativa. */}
      {temporal !== null && (
        <section aria-label="Análisis temporal" className="mt-5 rounded-2xl border border-line bg-surface-2 p-4">
          <SectionTitle>Análisis temporal</SectionTitle>
          <dl className="mt-1">
            <DataRow label="Fecha de inicio de ciclo" value={textOrDash(temporal.cycleStartDate)} />
            <DataRow label="Fecha de la solicitud" value={textOrDash(temporal.cancellationRequestDate)} />
            <DataRow label="Solicitud vs. inicio" value={RELATION_LABELS[temporal.relationToCycleStart] ?? DASH} />
          </dl>
          {temporal.cycleStartDate === null && (
            <p className="mt-2 text-sm text-muted">
              No hay evidencia que acredite la fecha de inicio de ciclo; no se ha supuesto ninguna.
            </p>
          )}
          {temporal.cycleStartEvidenceText !== null && temporal.cycleStartEvidenceText.trim() !== '' && (
            <p className="mt-3 border-l-2 border-line pl-2 text-sm text-muted">
              <span className="font-medium text-ink">Evidencia del inicio:</span> {temporal.cycleStartEvidenceText}
            </p>
          )}
          {arrayOrEmpty(temporal.cycleStartEvidenceIds).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {arrayOrEmpty(temporal.cycleStartEvidenceIds).map((id) => (
                <Chip key={`cycle-start-${id}`} title={fileName(id)}>
                  {fileName(id)}
                </Chip>
              ))}
            </div>
          )}
          {arrayOrEmpty(temporal.cancellationRequestEvidenceIds).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {arrayOrEmpty(temporal.cancellationRequestEvidenceIds).map((id) => (
                <Chip key={`cancel-request-${id}`} title={fileName(id)}>
                  {fileName(id)}
                </Chip>
              ))}
            </div>
          )}
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">{textOrDash(temporal.reasoning)}</p>
        </section>
      )}

      {/* ------------------------------------------------- Hechos encontrados */}
      <div className="mt-5">
        <SectionTitle>Hechos encontrados</SectionTitle>
        {safeFacts.length === 0 ? (
          <p className="mt-1 text-sm text-muted">{DASH}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {safeFacts.map((fact) => (
              <li key={fact.key} className="rounded-xl border border-line bg-surface-2 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-ink">{fact.label}</p>
                  <span className="text-xs text-muted">confianza {formatPercent(fact.confidence)}</span>
                </div>
                <p className="mt-0.5 break-words text-sm text-ink">{formatFactValue(fact.value)}</p>
                {fact.evidenceText !== null && fact.evidenceText.trim() !== '' && (
                  <p className="mt-1 border-l-2 border-line pl-2 text-xs text-muted">{fact.evidenceText}</p>
                )}
                {arrayOrEmpty(fact.evidenceIds).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {arrayOrEmpty(fact.evidenceIds).map((id) => (
                      <Chip key={`${fact.key}-${id}`} title={fileName(id)}>
                        {fileName(id)}
                      </Chip>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ------------------------------------------------- Timeline */}
      <div className="mt-5">
        <SectionTitle>Línea de tiempo</SectionTitle>
        {safeTimeline.length === 0 ? (
          <p className="mt-1 text-sm text-muted">{DASH}</p>
        ) : (
          <ol className="mt-2 flex flex-col">
            {safeTimeline.map((entry, index) => (
              <li key={`${entry.event}-${index}`} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 rounded-full bg-brand" />
                  {index < safeTimeline.length - 1 && <span aria-hidden="true" className="w-px flex-1 bg-line" />}
                </div>
                <div className="min-w-0 flex-1 pb-4">
                  <p className="text-xs text-muted">{formatDate(entry.date)}</p>
                  <p className="text-sm text-ink">{entry.event}</p>
                  {arrayOrEmpty(entry.evidenceIds).length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {arrayOrEmpty(entry.evidenceIds).map((id) => (
                        <Chip key={`${index}-${id}`} title={fileName(id)}>
                          {fileName(id)}
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* ------------------------------------------------- Contradicciones */}
      <div className="mt-5">
        <SectionTitle>Contradicciones</SectionTitle>
        {safeConflicts.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No se detectaron contradicciones.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {safeConflicts.map((conflict, index) => (
              <li
                key={`${index}-${conflict.description}`}
                className="rounded-xl border border-warning/30 bg-warning/5 p-3"
              >
                <p className="text-sm text-ink">{conflict.description}</p>
                {arrayOrEmpty(conflict.evidenceIds).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {arrayOrEmpty(conflict.evidenceIds).map((id) => (
                      <Chip key={`${index}-${id}`} title={fileName(id)}>
                        {fileName(id)}
                      </Chip>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ------------------------------------------------- Evidencias utilizadas */}
      <div className="mt-5">
        <SectionTitle>Evidencias utilizadas</SectionTitle>
        {supportingEvidenceIds.length === 0 ? (
          <p className="mt-1 text-sm text-muted">{DASH}</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {supportingEvidenceIds.map((id) => (
              <Chip key={id} title={fileName(id)}>
                {fileName(id)}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {/* ------------------------------------------------- Procedure checks */}
      {hasProcedureChecks && (
        <div className="mt-5">
          <SectionTitle>Checks del procedimiento</SectionTitle>
          <div className="mt-2 flex flex-col gap-2">
            {procedureChecks.map((check, index) => (
              <div key={`${check.procedureSection}-${index}`} className="rounded-xl border border-line bg-surface-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">{check.procedureSection}</p>
                  <Badge tone={check.status === 'ACREDITADO' ? 'success' : check.status === 'NO_ACREDITADO' ? 'danger' : 'warning'}>
                    {check.status}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-ink"><span className="font-medium">Criterio:</span> {check.criterion}</p>
                <p className="mt-1 text-sm text-ink">{check.reasoning}</p>
                {arrayOrEmpty(check.observedValues).length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-xs text-muted">
                    {arrayOrEmpty(check.observedValues).map((value) => (
                      <li key={`${check.procedureSection}-${value.label}`}><span className="font-medium text-ink">{value.label}:</span> {value.value}</li>
                    ))}
                  </ul>
                )}
                {arrayOrEmpty(check.evidenceIds).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {arrayOrEmpty(check.evidenceIds).map((id) => (
                      <Chip key={`${check.procedureSection}-${id}`} title={fileName(id)}>{fileName(id)}</Chip>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------- Evidencias faltantes */}
      <div className="mt-5">
        <SectionTitle>Evidencias faltantes</SectionTitle>
        {missingEvidence.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No se identificaron evidencias faltantes.</p>
        ) : (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
            {missingEvidence.map((item) => (
              <li key={`${item.title}-${item.relatedProcedureSection}`}>{item.title}</li>
            ))}
          </ul>
        )}
      </div>

      {/* ------------------------------------------------- Observaciones */}
      <div className="mt-5">
        <SectionTitle>Observaciones</SectionTitle>
        {observations.length === 0 ? (
          <p className="mt-1 text-sm text-muted">{DASH}</p>
        ) : (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
            {observations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>

      {/* ------------------------------------------------- Modelo y uso */}
      <div className="mt-6 rounded-xl border border-line bg-surface-2 p-3">
        <SectionTitle>Ejecución</SectionTitle>
        <dl className="mt-1">
          <DataRow label="Modelo" value={`${model.provider}/${model.model}`} />
          <DataRow label="Proveedor" value={audit.provider} />
          <DataRow label="Latencia" value={formatLatency(audit.latencyMs)} />
          <DataRow label="Fecha" value={formatDateTime(audit.createdAt)} />
          <DataRow
            label="Uso de tokens"
            value={
              hasUsage
                ? `Tokens: ${usage.promptTokens ?? DASH} prompt · ${usage.completionTokens ?? DASH} completión · ${
                    usage.totalTokens ?? DASH
                  } total`
                : DASH
            }
          />
          <DataRow label="Coste estimado" value={hasUsage ? formatCost(usage.estimatedCostUSD) : DASH} />
        </dl>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge tone="neutral">Auditoría {audit.id ? shortId(audit.id) : DASH}</Badge>
        {assessment.result === 'EVIDENCIA_INSUFICIENTE' && (
          <Badge tone="warning">Requiere evidencia adicional</Badge>
        )}
      </div>
    </div>
  );
}

function arrayOrEmpty<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}
