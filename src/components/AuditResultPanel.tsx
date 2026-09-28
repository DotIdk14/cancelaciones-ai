// =============================================================================
// Panel de resultado de la auditoría (sección 23 del encargo).
// Muestra EXACTAMENTE lo que devolvió el modelo. Nunca inventa un dictamen:
// si `resultJson` es null, se dice que no hay resultado, nada más.
// =============================================================================

import type { ReactNode } from 'react';
import type { AuditResultType } from '../skills/audit/types';
import type { AuditDetail, Evidence } from '../lib/api';
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
import { RESULT_DESCRIPTIONS, RESULT_LABELS, errorCategoryLabel } from '../lib/labels';
import { Badge, Chip, DataRow, SectionTitle } from './ui';
import type { Tone } from './ui';

const RESULT_TONE: Record<AuditResultType, Tone> = {
  CANCELACION_VENTA: 'brand',
  BAJA: 'warning',
  CANCELACION_VENTA_OPERATIVA: 'brand',
  CANCELACION_MATRICULA: 'brand',
  DICTAMINACION: 'success',
  EVIDENCIA_INSUFICIENTE: 'warning',
};

export interface AuditResultPanelProps {
  audit: AuditDetail;
  evidences: Evidence[];
}

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
  const isInsufficient = assessment.result === 'EVIDENCIA_INSUFICIENTE';
  const tone: Tone = RESULT_TONE[assessment.result] ?? 'neutral';

  // Resuelve ids de evidencia -> nombre de archivo del caso.
  const namesById = new Map(evidences.map((item) => [item.id, item.filename]));
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
          <p className="font-semibold">No fue posible emitir un dictamen confiable.</p>
          <p className="mt-1 text-ink">
            La evidencia disponible no alcanza para determinar el trámite. A continuación se listan los
            documentos faltantes que permitirían concluir.
          </p>
          {assessment.missingEvidence.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-ink">
              {assessment.missingEvidence.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>
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

      {/* ------------------------------------------------- Hechos encontrados */}
      <div className="mt-5">
        <SectionTitle>Hechos encontrados</SectionTitle>
        {facts.length === 0 ? (
          <p className="mt-1 text-sm text-muted">{DASH}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {facts.map((fact) => (
              <li key={fact.key} className="rounded-xl border border-line bg-surface-2 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-ink">{fact.label}</p>
                  <span className="text-xs text-muted">confianza {formatPercent(fact.confidence)}</span>
                </div>
                <p className="mt-0.5 break-words text-sm text-ink">{formatFactValue(fact.value)}</p>
                {fact.evidenceText !== null && fact.evidenceText.trim() !== '' && (
                  <p className="mt-1 border-l-2 border-line pl-2 text-xs text-muted">{fact.evidenceText}</p>
                )}
                {fact.evidenceIds.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {fact.evidenceIds.map((id) => (
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
        {timeline.length === 0 ? (
          <p className="mt-1 text-sm text-muted">{DASH}</p>
        ) : (
          <ol className="mt-2 flex flex-col">
            {timeline.map((entry, index) => (
              <li key={`${entry.event}-${index}`} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 rounded-full bg-brand" />
                  {index < timeline.length - 1 && <span aria-hidden="true" className="w-px flex-1 bg-line" />}
                </div>
                <div className="min-w-0 flex-1 pb-4">
                  <p className="text-xs text-muted">{formatDate(entry.date)}</p>
                  <p className="text-sm text-ink">{entry.event}</p>
                  {entry.evidenceIds.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {entry.evidenceIds.map((id) => (
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
        {conflicts.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No se detectaron contradicciones.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {conflicts.map((conflict, index) => (
              <li
                key={`${index}-${conflict.description}`}
                className="rounded-xl border border-warning/30 bg-warning/5 p-3"
              >
                <p className="text-sm text-ink">{conflict.description}</p>
                {conflict.evidenceIds.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {conflict.evidenceIds.map((id) => (
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
        {assessment.supportingEvidenceIds.length === 0 ? (
          <p className="mt-1 text-sm text-muted">{DASH}</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {assessment.supportingEvidenceIds.map((id) => (
              <Chip key={id} title={fileName(id)}>
                {fileName(id)}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {/* ------------------------------------------------- Evidencias faltantes */}
      <div className="mt-5">
        <SectionTitle>Evidencias faltantes</SectionTitle>
        {assessment.missingEvidence.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No se identificaron evidencias faltantes.</p>
        ) : (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
            {assessment.missingEvidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>

      {/* ------------------------------------------------- Observaciones */}
      <div className="mt-5">
        <SectionTitle>Observaciones</SectionTitle>
        {assessment.observations.length === 0 ? (
          <p className="mt-1 text-sm text-muted">{DASH}</p>
        ) : (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
            {assessment.observations.map((item) => (
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
