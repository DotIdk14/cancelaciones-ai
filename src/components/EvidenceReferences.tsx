import type { ReactNode } from 'react';
import type { Evidence } from '../lib/api';

/** Solo tiempos explícitos MM:SS / HH:MM:SS; nunca se infieren posiciones. */
export function referencedSeconds(text: string): Array<{ label: string; seconds: number }> {
  return Array.from(text.matchAll(/(?<![\d:])(\d{1,2}:\d{2}(?::\d{2})?)(?![\d:])/g)).flatMap((match) => {
    const label = match[1]!;
    const parts = label.split(':').map(Number);
    if (parts.slice(1).some((value) => value > 59)) return [];
    return [{ label, seconds: parts.reduce((total, value) => total * 60 + value, 0) }];
  });
}
export function EvidenceReferences({ text, evidenceIds, evidences, onOpen }: {
  text: string; evidenceIds: string[]; evidences: Evidence[];
  onOpen: (id: string, seconds: number | null) => void;
}): ReactNode {
  const linked = evidences.filter((item) => (evidenceIds ?? []).includes(item.id));
  const audios = linked.filter((item) => item.mimeType.startsWith('audio/'));
  const times = referencedSeconds(text);
  return <div className="mt-2 flex flex-wrap gap-2">{linked.map((item) => <button key={item.id} type="button" className="rounded-md px-2 py-1 text-xs text-brand hover:bg-brand/10" onClick={() => onOpen(item.id, null)}>Ver {item.filename}</button>)}{audios.length === 1 && times.map((time, index) => <button key={`${time.label}-${index}`} type="button" className="rounded-md px-2 py-1 text-xs text-brand hover:bg-brand/10" onClick={() => onOpen(audios[0]!.id, time.seconds)}>Escuchar {time.label}</button>)}</div>;
}
