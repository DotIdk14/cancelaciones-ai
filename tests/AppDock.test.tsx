// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capabilitiesForRole } from '../src/server/capabilities';
import { AppDock } from '../src/components/AppDock';

describe('AppDock — acceso a Calidad', () => {
  beforeEach(() => { window.location.hash = '#/'; });
  afterEach(() => { cleanup(); });

  it('muestra Calidad y Actividad y consumo al Coordinador', () => {
    render(<AppDock capabilities={capabilitiesForRole('coordinator')} />);
    expect(screen.getByRole('link', { name: 'Calidad' }).getAttribute('href')).toBe('#/calidad');
    expect(screen.getByRole('link', { name: 'Actividad y consumo' }).getAttribute('href')).toBe('#/ia-costos');
  });

  it('mantiene Calidad oculta al Asesor', () => {
    render(<AppDock capabilities={capabilitiesForRole('user')} />);
    expect(screen.queryByRole('link', { name: 'Calidad' })).toBeNull();
  });
});

it('no ofrece la bandeja administrativa retirada al Coordinador', () => {
  render(<AppDock capabilities={capabilitiesForRole('coordinator')} />);
  expect(screen.queryByRole('link', { name: 'Revisión Flokzu' })).toBeNull();
});
