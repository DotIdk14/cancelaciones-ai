// =============================================================================
// Enrutado por hash manual (sin react-router). `#/` y `#/casos/:id`.
// Hash routing hace que un refresh funcione siempre en Vercel sin rewrites.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';

export type AppRoute = { name: 'home' } | { name: 'case'; caseId: string };

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseHash(hash: string): AppRoute {
  const path = hash.replace(/^#/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (path === '') return { name: 'home' };

  const segments = path.split('/').filter(Boolean).map(decodeSegment);
  const [root, id] = segments;
  if (root === 'casos' && typeof id === 'string' && id !== '') return { name: 'case', caseId: id };
  return { name: 'home' };
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
export function navigate(hash: string): void {
  const next = hash.startsWith('#') ? hash : `#${hash}`;
  if (window.location.hash === next) {
    // Fuerza el evento cuando la ruta no cambia.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  window.location.hash = next;
}

export function goToCase(caseId: string): void {
  navigate(`/casos/${encodeURIComponent(caseId)}`);
}

export function goHome(): void {
  navigate('/');
}
