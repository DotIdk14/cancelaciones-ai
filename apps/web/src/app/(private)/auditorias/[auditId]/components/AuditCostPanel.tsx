'use client';

import { useState } from 'react';

/**
 * Panel de coste de IA de una auditoría.
 *
 * LA REGLA QUE GOBIERNA ESTE COMPONENTE
 *
 *     NULL != 0
 *
 * Si hay una operación cuyo coste no se conoce, el panel NO dice "$0.05 USD"
 * como si fuera el total. Dice "$0.05 USD conocidos + 1 operación con coste
 * desconocido". Un total único sería una afirmación falsa, y una afirmación
 * falsa en la UI de coste es peor que no tener la cifra: hace creer que se
 * controló el gasto cuando sólo seMidió parte.
 *
 * El coste NUNCA alimenta una decisión. No lee `suggestedOutcome`, ni
 * `decisionStatus`, ni ninguna regla: es sólo lectura de `ai_usage`, que es
 * telemetría y no entrada del motor.
 */

interface CostEvent {
  id: string;
  provider: string;
  operation: string;
  model: string | null;
  inputUnits: number | null;
  outputUnits: number | null;
  unitType: string | null;
  costUsd: number | null;
  costKnown: boolean;
  /**
   * De dónde sale la cifra. Sin esto, un número no tiene procedencia y no se
   * puede distinguir lo que reportó el proveedor de lo que suponer el sistema.
   */
  costSource: string | null;
  recordedAt: string | null;
}

/**
 * Etiqueta legible de la procedencia del coste.
 *
 * `UNKNOWN` NO se traduce por "estimado": no hubo estimación. Se traduce por
 * "procedencia desconocida", que es lo que realmente quiere decir, y en
 * particular NO dice "gratis".
 */
function costSourceLabel(source: string | null): string {
  switch (source) {
    case 'PROVIDER_REPORTED': return 'reportado por el proveedor';
    case 'CALCULATED': return 'calculado con pricing configurado';
    case 'ESTIMATED': return 'estimado explícitamente';
    case 'UNKNOWN': return 'procedencia del coste desconocida';
    default: return 'procedencia no registrada';
  }
}

interface CostSummary {
  auditId: string;
  knownCostUsd: number;
  unknownCostEvents: number;
  providerCallCount: number;
  providers: string[];
  models: string[];
  /**
   * `true` si el servidor no pudo leer el ledger. Entonces las cifras de arriba
   * NO son un dato y la UI debe decirlo, en vez de pintar $0.00.
   */
  readFailed: boolean;
  events: CostEvent[];
}

function usd(value: number): string {
  return `$${value.toFixed(4)} USD`;
}

export function AuditCostPanel({ auditId }: { auditId: string }) {
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/audits/${auditId}/cost`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'No fue posible leer el coste.');
      setSummary(data as CostSummary);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Error desconocido.'); } finally { setLoading(false); }
  }

  if (!summary) {
    return <div className="rounded-lg border border-line bg-surface-1 p-3 text-[11px]">
      <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Costo IA</h4>
      <button type="button" onClick={() => void load()} disabled={loading} className="rounded-md border border-line bg-surface-2 px-3 py-1.5 font-semibold disabled:opacity-60">
        {loading ? 'Leyendo…' : 'Ver costo'}
      </button>
      {error && <p className="mt-2 text-red-600">{error}</p>}
    </div>;
  }

  if (summary.providerCallCount === 0) {
    return <div className="rounded-lg border border-line bg-surface-1 p-3 text-[11px]">
      <h4 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Costo IA</h4>
      <p className="text-muted">Sin operaciones de proveedor registradas para esta auditoría.</p>
      <button type="button" onClick={() => void load()} disabled={loading} className="mt-2 rounded-md border border-line bg-surface-2 px-3 py-1.5 font-semibold disabled:opacity-60">Actualizar</button>
    </div>;
  }

  return <div className="rounded-lg border border-line bg-surface-1 p-3 text-[11px]">
    <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Costo IA</h4>

    <div className="rounded bg-surface-2 p-2">
      {summary.readFailed
        ? <p className="font-semibold text-red-700">
            No fue posible leer el coste de esta auditoría. No se muestra ninguna cifra porque no se midió nada.
          </p>
        : <>
            <p className="text-sm font-bold">{usd(summary.knownCostUsd)} conocidos</p>
            {summary.unknownCostEvents > 0
              ? <>
                  <p className="mt-0.5 font-semibold text-amber-700">
                    + {summary.unknownCostEvents} {summary.unknownCostEvents === 1 ? 'operación' : 'operaciones'} con coste desconocido
                  </p>
                  <p className="mt-1 text-muted">La cifra conocida no es el total mientras queden operaciones sin coste conocido. No se inventa un total.</p>
                </>
              : <p className="mt-1 text-muted">Todas las operaciones registradas tienen coste conocido.</p>}
          </>}
    </div>

    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
      <dt className="text-muted">Operaciones</dt><dd className="font-semibold">{summary.providerCallCount}</dd>
      <dt className="text-muted">Proveedores</dt><dd className="font-semibold">{summary.providers.join(', ') || '—'}</dd>
      {summary.models.length > 0 && <><dt className="text-muted">Modelos</dt><dd className="font-semibold break-all">{summary.models.join(', ')}</dd></>}
    </dl>

    <details className="mt-2">
      <summary className="cursor-pointer font-semibold">Ver detalle</summary>
      <div className="mt-2 space-y-1">
        {summary.events.map((event) => <div key={event.id} className="rounded border border-line px-2 py-1">
          <div className="flex justify-between gap-2">
            <span className="font-semibold">{event.provider}</span>
            <span className={event.costKnown ? 'text-success' : 'text-amber-700'}>
              {event.costKnown ? usd(event.costUsd!) : 'coste desconocido'}
            </span>
          </div>
          <p className="text-muted">
            {event.operation}
            {event.model && ` · ${event.model}`}
          </p>
          <p className="text-muted">
            {event.unitType === 'TOKENS'
              ? `${event.inputUnits ?? '—'} in / ${event.outputUnits ?? '—'} out tokens`
              : event.unitType === 'AUDIO_SECONDS'
              ? `${event.inputUnits ?? '—'} s de audio`
              : `${event.inputUnits ?? '—'} ${event.unitType ?? 'unidades'}`}
          </p>
          <p className="text-muted">Origen del coste: {costSourceLabel(event.costSource)}</p>
          {event.recordedAt && <p className="text-muted">{new Date(event.recordedAt).toLocaleString('es-MX')}</p>}
        </div>)}
      </div>
    </details>

    <button type="button" onClick={() => void load()} disabled={loading} className="mt-2 rounded-md border border-line bg-surface-2 px-3 py-1.5 font-semibold disabled:opacity-60">Actualizar</button>
  </div>;
}
