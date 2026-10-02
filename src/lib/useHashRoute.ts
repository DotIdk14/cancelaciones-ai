// =============================================================================
// Enrutado por hash manual (sin react-router).
// Hash routing hace que un refresh funcione siempre en Vercel sin rewrites.
//
// Rutas:
//   `#/`            -> dashboard (Resumen)
//   `#/calidad`     -> quality    (Calidad)
//   `#/ia-costos`   -> ai-costs   (IA & Costos)
//   `#/nuevo`       -> new-case   (Nuevo caso)
//   `#/casos`       -> cases      (Casos)
//   `#/casos/:id`   -> case       (Detalle de caso)
// Cualquier hash desconocido cae en el dashboard.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';

export type AppRoute =
  | { name: 'dashboard' } // #/
  | { name: 'quality' } // #/calidad
  | { name: 'ai-costs' } // #/ia-costos
  | { name: 'new-case' } // #/nuevo
  | { name: 'cases' } // #/casos
  | { name: 'case'; caseId: string }; // #/casos/:id

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseHash(hash: string): AppRoute {
  const path = hash.replace(/^#/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (path === '') return { name: 'dashboard' };

  const segments = path.split('/').filter(Boolean).map(decodeSegment);
  const [root, id] = segments;

  if (root === 'casos') {
    if (segments.length === 1) return { name: 'cases' };
    // Exigimos EXACTAMENTE dos segmentos (`#/casos/:id`). Un hash con segmentos
    // de más (`#/casos/abc/extra`) no es una ruta de la app: antes se aceptaba
    // en silencio usando solo el id, de modo que `#/casos/a/b` y `#/calidad/b`
    // se comportaban de forma distinta. Ahora toda ruta no reconocida cae al
    // dashboard, como dice el contrato de este archivo.
    if (segments.length === 2 && typeof id === 'string' && id !== '') {
      return { name: 'case', caseId: id };
    }
    return segments.length > 2 ? { name: 'dashboard' } : { name: 'cases' };
  }
  if (segments.length !== 1) return { name: 'dashboard' };

  switch (root) {
    case 'calidad':
      return { name: 'quality' };
    case 'ia-costos':
      return { name: 'ai-costs' };
    case 'nuevo':
      return { name: 'new-case' };
    default:
      // Ruta desconocida: nunca dejamos al usuario en una pantalla rota.
      return { name: 'dashboard' };
  }
}

/** Ruta actual derivada de `location.hash`, reactiva a `hashchange`. */
export function useHashRoute(): AppRoute {
  const [hash, setHash] = useState<string>(() =>
    typeof window === 'undefined' ? '' : window.location.hash,
  );

  useEffect(() => {
    const onChange = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    // Sincroniza si el hash cambió antes de montar el listener.
    onChange();
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return useMemo(() => parseHash(hash), [hash]);
}

/** Navegación imperativa (mantiene el refresh seguro). */
function navigate(hash: string): void {
  const next = hash.startsWith('#') ? hash : `#${hash}`;
  if (window.location.hash === next) {
    // Fuerza el evento cuando la ruta no cambia.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  window.location.hash = next;
}

export function goToCases(): void {
  navigate('/casos');
}

export function goToCase(caseId: string): void {
  navigate(`/casos/${encodeURIComponent(caseId)}`);
}
