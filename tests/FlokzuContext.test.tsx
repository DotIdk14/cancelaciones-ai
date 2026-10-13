// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FlokzuContextBar, FlokzuEvidenceLinks } from '../src/components/FlokzuContext';
import { LOCAL_PREVIEW_FLOKZU } from '../src/lib/local-ui-preview';
import { normalizeFlokzuUrl } from '../src/lib/flokzu-links';

afterEach(cleanup);
describe('Contexto de Flokzu', () => {
  it('consulta las propiedades en un panel y conserva el expediente al cerrarlo', () => {
    render(<FlokzuContextBar externalCaseId="CaVe-1" assignedTo="advisor" assignedName="Ana Pérez" data={LOCAL_PREVIEW_FLOKZU} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Ver contexto' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Contexto de Flokzu' })).toBeTruthy();
    expect(screen.getByText('Ana Pérez')).toBeTruthy();
    expect(screen.getByText('Fecha Inicio administrativa · Flokzu')).toBeTruthy();
    expect(screen.getByText('Universidad')).toBeTruthy();
    const more = screen.getByRole('button', { name: 'Leer completo' });
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar contexto de Flokzu' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('oculta completamente referencias sin URL, incluida una URL peligrosa', () => {
    const { container } = render(<FlokzuEvidenceLinks references={[{ label: 'Acceso', value: 'archivo.png' }, { label: 'Tutor', value: 'javascript:alert(1)', url: 'javascript:alert(1)' }]} />);
    expect(container.innerHTML).toBe('');
  });
  it('restaura la posición de lectura del contenedor al cerrar', () => {
    const { container } = render(<div><FlokzuContextBar externalCaseId="CaVe-1" data={LOCAL_PREVIEW_FLOKZU} /></div>);
    const workspace = container.firstElementChild as HTMLElement;
    workspace.scrollTop = 120;
    const trigger = screen.getByRole('button', { name: 'Ver contexto' });
    trigger.focus();
    fireEvent.click(trigger);
    workspace.scrollTop = 240;
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar contexto de Flokzu' }));
    expect(workspace.scrollTop).toBe(120);
    expect(document.activeElement).toBe(trigger);
  });
  it('presenta solo enlaces descriptivos, seguros y únicos en una nueva pestaña', () => {
    render(<FlokzuEvidenceLinks references={[{ label: 'Acceso al aula', value: 'archivo.png', url: 'https://EXAMPLE.org/prueba' }, { label: 'Duplicado', value: 'https://example.org/prueba' }]} />);
    const link = screen.getByRole('link', { name: /Acceso al aula/ });
    expect(link.getAttribute('href')).toBe('https://example.org/prueba');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(link.textContent).toContain('Duplicado');
    expect(screen.queryByText('archivo.png')).toBeNull();
  });
  it.each(['file:///archivo.png', '//example.org', 'ftp://example.org', 'data:text/html,test', 'javascript:alert(1)', 'https://example.org/\narchivo', 'https:\\example.org'])('rechaza protocolo o formato inseguro: %s', (url) => {
    expect(normalizeFlokzuUrl(url)).toBeNull();
  });
});
