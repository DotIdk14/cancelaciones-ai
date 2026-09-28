// =============================================================================
// Polling con reintentos encadenados (nunca setInterval: evita solapamientos).
// Se pausa cuando la pestaña no está visible y se cancela al desmontar.
// =============================================================================

import { useEffect, useRef } from 'react';

/**
 * Ejecuta `task` cada `intervalMs` mientras `intervalMs` no sea `null`.
 * Los errores se silencian a propósito: el siguiente tick reintenta solo.
 */
export function usePolling(task: () => Promise<void>, intervalMs: number | null): void {
  const taskRef = useRef(task);

  useEffect(() => {
    taskRef.current = task;
  });

  useEffect(() => {
    if (intervalMs === null) return;
    let cancelled = false;
    let timer: number | undefined;

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        try {
          await taskRef.current();
        } catch {
          // Silenciado: el siguiente tick reintenta.
        }
      }
      if (!cancelled) timer = window.setTimeout(() => void tick(), intervalMs);
    };

    timer = window.setTimeout(() => void tick(), intervalMs);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [intervalMs]);
}
