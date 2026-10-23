import type { Evidence } from '../lib/api';
import type { ReliabilityReview } from '../skills/audit/grounding-schema';
import { EvidenceReferences } from './EvidenceReferences';
import { factSupportLabel } from '../lib/labels';

export function FactGroundingDetails({ grounding, evidences, onOpen }: {
  grounding: ReliabilityReview['factGrounding'][number] | undefined;
  evidences: Evidence[]; onOpen: (id: string, seconds: number | null) => void;
}) {
  if (!grounding) return null;
  return <details className="mt-2 text-sm"><summary className="cursor-pointer text-brand">Ver sustento contrastado por IA</summary>
    <p className="mt-2">{factSupportLabel(grounding.support)}: {grounding.explanation}</p>
    {grounding.citations.map((citation,index)=><blockquote className="mt-2 border-l border-line pl-3" key={index}>
      <p>{citation.quote}</p><small className="text-muted">{citation.locator}</small>
      <EvidenceReferences text={citation.locator} evidenceIds={[citation.evidenceId]} evidences={evidences} onOpen={onOpen} />
    </blockquote>)}
  </details>;
}
