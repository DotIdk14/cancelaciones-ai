import type { AuditResult } from '../skills/audit/schema';
import { resolutionLabel } from '../lib/labels';

/** Solo presenta la orientación ya emitida por IA; nunca clasifica el expediente. */
export function ProvisionalResolutionNotice({ result }: { result: AuditResult }) {
  const { audit } = result;
  if (audit.result !== 'EVIDENCIA_INSUFICIENTE') return null;
  const proposal = audit.provisionalResolution;
  const missing = (audit.missingEvidence ?? []).filter(item => item.blocking);
  return <section aria-label="Resolución orientativa" className="space-y-3 border-t border-line pt-4 text-sm">
    <div>
      <h3 className="font-semibold text-ink">Resolución orientativa · provisional</h3>
      {proposal && <p className="mt-1 break-words font-semibold text-accent">{resolutionLabel(proposal.result)}</p>}
    </div>
    <p className="text-muted">El dictamen sigue siendo Evidencia insuficiente. Esta orientación no es una resolución confirmada ni sustituye la revisión humana.</p>
    {proposal ? <>
      <p className="whitespace-pre-wrap break-words text-ink">{proposal.rationale}</p>
      <p className="break-words text-muted">Procedimiento V5 · Sección {proposal.procedureSection}</p>
      {proposal.evidenceIds.length > 0 && <details>
        <summary className="cursor-pointer text-accent">Evidencias que apoyan esta orientación ({proposal.evidenceIds.length})</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{proposal.evidenceIds.map(id => <li className="break-all" key={id}>{result.evidenceSummary?.find(item => item.evidenceId === id)?.filename ?? 'Evidencia referenciada en el dictamen'}</li>)}</ul>
      </details>}
      {missing.length > 0 && <div>
        <p className="font-medium text-ink">Faltantes que impiden confirmarla</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">{missing.map((item, index) => <li className="break-words" key={`${item.title}-${index}`}>{item.title}</li>)}</ul>
      </div>}
    </> : <p className="text-muted">Esta auditoría no tiene una resolución orientativa registrada.</p>}
  </section>;
}
