'use client';

import type { MissingItem } from './types';

// Panel de información faltante para concluir el dictamen.
export function MissingItemsPanel({ items = [], factLabels = {} }: { items?: MissingItem[]; factLabels?: Record<string, string> }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-warning/20 bg-warning/10 p-3">
      <p className="font-semibold text-warning">Información que falta para concluir</p>
      {items.map((item) => <p key={item.factType} className="mt-1 text-xs text-warning">{factLabels[item.factType] ?? item.factType}: {item.whyNeeded}</p>)}
    </div>
  );
}
