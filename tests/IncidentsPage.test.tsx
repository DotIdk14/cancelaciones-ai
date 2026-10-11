// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IncidentsPage } from '../src/components/IncidentsPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('IncidentsPage · preview local', () => {
  it('muestra datos ficticios y nunca consulta la API', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<IncidentsPage previewOnly />);

    expect(screen.getByText(/esta vista no consulta la api/i)).toBeTruthy();
    expect(screen.getByText(/INC-DEMO-001/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});
