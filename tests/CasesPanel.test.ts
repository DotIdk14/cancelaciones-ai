// @vitest-environment jsdom

// =============================================================================
// Listado de casos: resolución efectiva y su origen.
//
// Lo que estos tests fijan:
//   1. Un caso con revisión muestra el distintivo `Humano`; uno sin ella, `IA`.
//   2. El distintivo es la MISMA señal para las dos fuentes, y acompaña siempre al
//      resultado, porque una resolución sin origen no es auditable.
//   3. Un caso sin resolución efectiva se ve EXACTAMENTE como antes: no se
//      inventa un distintivo ni un resultado que el servidor no envió.
// =============================================================================

import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaseSummary } from '../src/lib/api';
import { shortId } from '../src/lib/format';
import { CasesPanel } from '../src/components/CasesPanel';

function fakeResponse(status: number, body: unknown): Response {
  return { status, json: async () => body } as unknown as Response;
}

function makeCase(overrides: Partial<CaseSummary> = {}): CaseSummary {
  return {
    id: 'case-1',
    status: 'COMPLETED',
    studentIdentifier: 'UTEL-2026-001',
    evidenceCount: 2,
    createdAt: '2026-02-01T10:00:00Z',
    updatedAt: '2026-02-03T09:00:00Z',
    ...overrides,
  };
}

async function renderList(cases: CaseSummary[]): Promise<void> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => fakeResponse(200, { cases })),
  );
  const view = render(createElement(CasesPanel));
  // Espera a que la lista llegue del servidor.
  await vi.waitFor(() => {
    if (cases.length > 0) expect(view.container.querySelector('li')).not.toBeNull();
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CasesPanel — resolución efectiva', () => {
  it('muestra Humano para el caso revisado y IA para el que sólo tiene dictamen', async () => {
    await renderList([
      makeCase({ id: 'case-human', effectiveResolution: { result: 'DICTAMINACION', source: 'HUMAN' } }),
      makeCase({ id: 'case-ai', effectiveResolution: { result: 'CANCELACION_VENTA', source: 'AI' } }),
    ]);

    expect(screen.getByText('Humano')).toBeTruthy();
    expect(screen.getByText('IA')).toBeTruthy();
    // El resultado viaja con su origen: "Dictaminación" sin más sería ambiguo.
    expect(screen.getByText('Dictaminación')).toBeTruthy();
    expect(screen.getByText('Cancelación de venta')).toBeTruthy();
  });

  it('enlaza a la revisión de cada caso', async () => {
    await renderList([makeCase({ id: 'case-human', effectiveResolution: { result: 'BAJA', source: 'HUMAN' } })]);

    const link = screen.getByRole('link', { name: /ver revisión/i });
    expect(link.getAttribute('href')).toBe('#/casos/case-human');
  });

  it('un caso sin revisión se ve exactamente como antes: sin distintivo de origen', async () => {
    await renderList([makeCase({ id: 'case-plain' })]);

    expect(screen.queryByText('Humano')).toBeNull();
    expect(screen.queryByText('IA')).toBeNull();
    expect(screen.queryByRole('link', { name: /ver revisión/i })).toBeNull();
    // La fila conserva exactamente su forma actual.
    // El id se acorta con `shortId`, que es lo que pinta la fila: escribir el id
    // entero aquí haría que esta aserción pasara por accidente o fallara por el
    // truncado, según la longitud, en lugar de fijar el comportamiento real.
    const row = screen.getByRole('link', { name: new RegExp(`Caso ${shortId('case-plain')}`, 'i') });
    expect(row.textContent).toContain('UTEL-2026-001');
    expect(row.textContent).toContain('2 evidencias');
    expect(screen.getByText('Completado')).toBeTruthy();
  });

  it('no inventa resolución cuando el servidor no envía ninguna', async () => {
    await renderList([makeCase({ id: 'case-null', effectiveResolution: null })]);

    expect(screen.queryByText('Humano')).toBeNull();
    expect(screen.queryByText('IA')).toBeNull();
    expect(screen.queryByRole('link', { name: /ver revisión/i })).toBeNull();
  });
});
