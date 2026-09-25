'use client';

import { useState } from 'react';

/**
 * Panel de trazabilidad de la decisión.
 *
 * QUÉ MUESTRA
 * El registro de lo que el motor YA decidió, leído de la base de datos.
 *
 * QUÉ NO HACE — y la diferencia con `PolicyEvaluationPanel` es deliberada
 *
 *   PolicyEvaluationPanel  -> POST /policy  -> EVALÚA y devuelve un resultado
 *   DecisionTracePanel     -> GET  /decision-trace -> LEE lo ya persistido
 *
 * Son cosas distintas y no intercambiables. Este panel no puede cambiar una
 * decisión, no dispara el motor y no recalcula nada: si el motor no persistó un
 * dato, aquí aparece como hueco declarado, no como estimación.
 *
 * Por eso el botón de recarga se llama "Actualizar lectura" y no "Evaluar".
 * Mezclar las dos cosas haría creer que releer el trace vuelve a decidir.
 */

interface TraceFactUsage { ruleId: string; conditionId: string; conditionState: string; observedValue: string | null }
interface TraceFact { id: string; type: string; value: unknown; source: unknown; extractionConfidence: number | null; usedBy: TraceFactUsage[]; reportedMissing: boolean }
interface TraceCondition { id: string; description: string; state: string; factIds: string[]; evidenceRefs: unknown[]; missingFacts: string[]; observedValue: string | null }
interface TraceRule {
  ruleId: string; category: string | null; status: string;
  source: { documentCode?: string; version?: string; section?: string; page?: number | string } | null;
  conditions: TraceCondition[]; factsUsed: string[]; missingFacts: string[]; evidenceRefs: unknown[];
  outcomeEffect: string | null; decisive: boolean; persistedStatus: string | null;
}
interface TraceDiagnostic { code: string; occurrences: number; refs: string[]; detail: string }
interface Trace {
  schemaVersion: string; readonly: boolean;
  execution: { engineRunId: string; factRunId: string | null; createdAt: string | null; status: string; policyCode: string; policyVersion: string; policySourceId: string | null; extractorVersion: string | null; factsFingerprint: string | null; rulesFingerprint: string | null; engineVersion: string | null };
  availableRuns: Array<{ engineRunId: string; createdAt: string | null; policyVersion: string; rulesFingerprint: string | null; outcomeStatus: string; suggestedOutcome: string | null; isSelected: boolean }>;
  facts: TraceFact[]; rules: TraceRule[];
  aggregation: { suggestedOutcome: string | null; outcomeStatus: string; decisionStatus: string; reviewRequired: boolean; decisiveRules: string[]; supportingRules: string[]; opposingRules: string[]; pendingRules: string[]; exclusions: string[]; unknownRules: string[]; notApplicableRules: string[] };
  coverage: { softwareCoverageGaps: string[]; missingNormativeSources: string[] };
  review: { required: boolean; missingFacts: string[]; missingData: Array<{ factType: string; whyNeeded: string; severity: string; rulesAffected: string[] }>; nextActions: Array<{ type: string; description: string; affectedRules: string[]; severity: string }>; reason: string | null };
  evidence: { evidenceRefs: unknown[]; missingEvidence: string[]; conflicts: unknown[] };
  diagnostics: TraceDiagnostic[];
  envelope: { schemaVersion: string; envelopeHash: string; createdAt: string | null } | null;
  comparison: { humanOutcome: string | null; humanPolicyVersion: string | null; comparison: string | null; classification: string | null; note: string };
}

const STATE_MARK: Record<string, string> = { TRUE: '✓', FALSE: '✗', UNKNOWN: '?', NOT_APPLICABLE: '–' };
const STATE_COLOR: Record<string, string> = {
  SATISFIED: 'text-success', TRUE: 'text-success',
  NOT_SATISFIED: 'text-red-600', FALSE: 'text-red-600',
  UNKNOWN: 'text-amber-600', NOT_APPLICABLE: 'text-muted', BLOCKED_BY_MISSING_NORMATIVE_SOURCE: 'text-purple-600',
};

export function DecisionTracePanel({ auditId }: { auditId: string }) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load(engineRunId?: string) {
    setLoading(true); setError('');
    try {
      const query = engineRunId ? `?engineRunId=${encodeURIComponent(engineRunId)}` : '';
      const response = await fetch(`/api/audits/${auditId}/decision-trace${query}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'No fue posible leer la trazabilidad.');
      setTrace(data as Trace);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Error desconocido.'); } finally { setLoading(false); }
  }

  return <div className="space-y-4 text-[11px] text-ink">
    <div>
      <h3 className="text-sm font-bold">¿Cómo se tomó esta decisión?</h3>
      <p className="mt-1 text-muted">
        Registro de lo que el motor ya decidió, leído de la base de datos. No vuelve a evaluar ni recalcula nada.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => load()} disabled={loading} className="rounded-md border border-line bg-surface-2 px-3 py-1.5 font-semibold disabled:opacity-60">
          {loading ? 'Leyendo…' : 'Actualizar lectura'}
        </button>
        {trace && <a href={`/api/audits/${auditId}/decision-trace?download=1${trace.availableRuns.length > 1 ? `&engineRunId=${trace.execution.engineRunId}` : ''}`} className="rounded-md border border-brand/30 bg-brand/10 px-3 py-1.5 font-semibold text-brand">
          ⇩ decision-trace.json
        </a>}
      </div>
      {error && <p className="mt-2 text-red-600">{error}</p>}
    </div>

    {!trace && !error && <p className="text-muted">Pulsa «Actualizar lectura» para ver la trazabilidad de esta auditoría.</p>}

    {trace && <div className="space-y-4">
      <Section title="Resultado">
        <p className="text-base font-bold">{trace.aggregation.suggestedOutcome ?? 'Sin resultado sugerible'}</p>
        <p className="mt-1">
          <strong>Estado:</strong>{' '}
          <span className={STATE_COLOR[trace.aggregation.decisionStatus] ?? 'text-ink'}>{trace.aggregation.decisionStatus}</span>
          {' · '}<span className={STATE_COLOR[trace.aggregation.outcomeStatus] ?? 'text-ink'}>{trace.aggregation.outcomeStatus}</span>
          {trace.aggregation.reviewRequired ? ' · REQUIERE REVISIÓN HUMANA' : ''}
        </p>
        {trace.review.reason && <p className="mt-1 text-muted">{trace.review.reason}</p>}

        <div className="mt-3 grid gap-1">
          <p className="font-semibold text-success">Contribuyeron:</p>
          {trace.aggregation.decisiveRules.length === 0 && <p className="text-muted">Ninguna regla decisiva.</p>}
          {trace.aggregation.decisiveRules.map((id) => <p key={id}>· {id} <span className="text-muted">— {describeEffect(trace, id)}</span></p>)}
          <p className="mt-2 font-semibold text-muted">No contribuyeron:</p>
          {trace.rules.filter((rule) => !rule.decisive).map((rule) => (
            <p key={rule.ruleId}>· {rule.source?.section ?? rule.ruleId}: <span className={STATE_COLOR[rule.status] ?? 'text-ink'}>{rule.status}</span></p>
          ))}
        </div>
      </Section>

      <Section title="Versiones (qué produjo este resultado)">
        <Row k="Corrida del motor" v={trace.execution.engineRunId} mono />
        <Row k="Fact Run" v={trace.execution.factRunId ?? 'no registrado'} mono />
        <Row k="Estado de la corrida" v={trace.execution.status} />
        <Row k="Política" v={`${trace.execution.policyCode} V${trace.execution.policyVersion}`} />
        <Row k="Fuente de la política" v={trace.execution.policySourceId ?? 'no registrada'} mono />
        <Row k="Extractor" v={trace.execution.extractorVersion ?? 'no registrado'} mono />
        <Row k="Versión del motor" v={trace.execution.engineVersion ?? 'no persistida'} />
        <Row k="factsFingerprint" v={trace.execution.factsFingerprint ?? '—'} mono />
        <Row k="rulesFingerprint" v={trace.execution.rulesFingerprint ?? '—'} mono />
        <Row k="Envelope" v={trace.envelope ? `${trace.envelope.schemaVersion} (${trace.envelope.envelopeHash.slice(0, 12)}…)` : 'no persistido'} mono />
        {trace.availableRuns.length > 1 && <>
          <p className="mt-2 font-semibold">Otras corridas de esta auditoría ({trace.availableRuns.length}):</p>
          {trace.availableRuns.map((run) => <button key={run.engineRunId} type="button" onClick={() => load(run.engineRunId)} className={`mt-1 block w-full rounded border px-2 py-1 text-left ${run.isSelected ? 'border-brand bg-brand/10' : 'border-line hover:bg-surface-2'}`}>
            {run.createdAt ?? '—'} · V{run.policyVersion} · {run.outcomeStatus} · {run.suggestedOutcome ?? '—'} · rules {(run.rulesFingerprint ?? '—').slice(0, 10)}…{run.isSelected ? ' ← mostrando' : ''}
          </button>)}
        </>}
      </Section>

      {trace.diagnostics.length > 0 && <Section title="Diagnóstico técnico (no es un juicio normativo)">
        {trace.diagnostics.map((d) => <div key={d.code} className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-900">
          <strong>{d.code}</strong> <span className="text-muted">({d.occurrences})</span>
          <p className="mt-0.5">{d.detail}</p>
          {d.refs.length > 0 && <p className="mt-0.5 text-muted">{d.refs.slice(0, 8).join(', ')}{d.refs.length > 8 ? ` … y ${d.refs.length - 8} más` : ''}</p>}
        </div>)}
      </Section>}

      <Section title={`Reglas evaluadas (${trace.rules.length})`}>
        {trace.rules.map((rule) => <RuleDetail key={rule.ruleId} rule={rule} />)}
      </Section>

      <Section title={`Hechos usados (${trace.facts.length})`}>
        {trace.facts.length === 0 && <p className="text-muted">No hay snapshot sellado para esta corrida. El motor evaluó sin hechos congelados; eso queda registrado como diagnóstico, no se rellena aquí.</p>}
        {trace.facts.map((fact) => <details key={fact.id} className="rounded border border-line px-2 py-1.5">
          <summary className="cursor-pointer">
            <span className="font-mono">{fact.type}</span>
            {fact.reportedMissing && <span className="ml-2 text-amber-600">reportado como faltante</span>}
          </summary>
          <p className="mt-1 break-all text-muted">valor: <span className="font-mono">{JSON.stringify(fact.value)}</span></p>
          <p className="text-muted">confianza: {fact.extractionConfidence ?? '—'}</p>
          {fact.usedBy.length === 0
            ? <p className="mt-1 text-muted">Ninguna condición persistida consumió este hecho.</p>
            : <ul className="mt-1 space-y-0.5">{fact.usedBy.map((usage) => <li key={`${usage.ruleId}-${usage.conditionId}`}>
                <span className={STATE_COLOR[usage.conditionState] ?? 'text-ink'}>{STATE_MARK[usage.conditionState] ?? '·'}</span>{' '}
                {usage.ruleId} / {usage.conditionId} → <strong>{usage.conditionState}</strong>
                {usage.observedValue && <span className="text-muted"> · {usage.observedValue}</span>}
              </li>)}</ul>}
        </details>)}
      </Section>

      {trace.evidence.missingEvidence.length > 0 && <Section title="Evidencia faltante">
        <ul className="list-disc pl-4">{trace.evidence.missingEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
        <p className="mt-1 text-muted">Referencias de evidencia persistidas: {trace.evidence.evidenceRefs.length}</p>      </Section>}

      {trace.review.missingFacts.length > 0 && <Section title="Hechos faltantes">
        <ul className="list-disc pl-4">{trace.review.missingFacts.map((item) => <li key={item}>{item}</li>)}</ul>
      </Section>}

      {trace.coverage.softwareCoverageGaps.length > 0 && <Section title="Cobertura de software (secciones aún no formalizadas)">
        <ul className="list-disc pl-4">{trace.coverage.softwareCoverageGaps.map((item) => <li key={item}>{item}</li>)}</ul>
      </Section>}

      {trace.review.nextActions.length > 0 && <Section title="Qué falta para cerrar el dictamen">
        <ol className="list-decimal space-y-1 pl-4">{trace.review.nextActions.map((action, index) => <li key={`${action.type}-${index}`}>
          {action.description} <span className="text-muted">({action.type} · {action.severity}{action.affectedRules.length > 0 ? ` · ${action.affectedRules.join(', ')}` : ''})</span>
        </li>)}</ol>
      </Section>}

      <Section title="Comparación con la decisión humana (separada)">
        <p><strong>Resultado de la máquina (inmutable):</strong> {trace.aggregation.suggestedOutcome ?? '—'}</p>
        <p><strong>Decisión humana:</strong> {trace.comparison.humanOutcome ?? '—'}</p>
        <p><strong>Coincidencia declarada por el motor:</strong> {trace.comparison.comparison ?? 'no calculada'}</p>
        <p className="mt-1 text-muted">{trace.comparison.note}</p>
      </Section>
    </div>}
  </div>;
}

function describeEffect(trace: Trace, ruleId: string): string {
  const rule = trace.rules.find((candidate) => candidate.ruleId === ruleId);
  if (!rule) return 'regla no encontrada en el registro';
  return rule.outcomeEffect ? `aporta ${rule.outcomeEffect}` : 'no aporta outcome';
}

function RuleDetail({ rule }: { rule: TraceRule }) {
  return <details className="rounded border border-line px-2 py-1.5">
    <summary className="cursor-pointer">
      <strong>{rule.source?.section ? `${rule.source.section} — ` : ''}{rule.ruleId}</strong>{' '}
      <span className={STATE_COLOR[rule.status] ?? 'text-ink'}>{rule.status}</span>
      {rule.decisive && <span className="ml-2 text-success">· decisiva</span>}
    </summary>
    {rule.source && <p className="mt-1 text-muted">{rule.source.documentCode} V{rule.source.version} · sección {rule.source.section} · pág. {rule.source.page}</p>}
    <p className="mt-1 text-muted">Estado persistido en engine_rule_results: {rule.persistedStatus ?? 'sin fila'}</p>
    <p className="mt-1">Efecto sobre el outcome: {rule.outcomeEffect ?? 'ninguno'}</p>
    <div className="mt-2 space-y-1">
      <p className="font-semibold">Condiciones:</p>
      {rule.conditions.map((condition) => <div key={condition.id} className="rounded bg-surface-2 px-2 py-1">
        <p><span className={STATE_COLOR[condition.state] ?? 'text-ink'}>{STATE_MARK[condition.state] ?? '·'}</span>{' '}{condition.id} — {condition.description}</p>
        {condition.observedValue && <p className="text-muted">observado: {condition.observedValue}</p>}
        {condition.missingFacts.length > 0 && <p className="text-amber-600">missing facts: {condition.missingFacts.join(', ')}</p>}
        {condition.factIds.length > 0 && <p className="text-muted">hechos: <span className="font-mono">{condition.factIds.join(', ')}</span></p>}
        {condition.evidenceRefs.length > 0 && <p className="text-muted">evidencia: {condition.evidenceRefs.length} referencia(s)</p>}
      </div>)}
      {rule.conditions.length === 0 && <p className="text-muted">El motor no persistió condiciones para esta regla.</p>}
    </div>
    {rule.missingFacts.length > 0 && <p className="mt-1 text-amber-600">Missing facts de la regla: {rule.missingFacts.join(', ')}</p>}
  </details>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border border-line bg-surface-1 p-3">
    <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{title}</h4>
    {children}
  </section>;
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <p className="flex gap-2"><span className="w-40 shrink-0 text-muted">{k}</span><span className={mono ? 'font-mono break-all' : ''}>{v}</span></p>;
}
