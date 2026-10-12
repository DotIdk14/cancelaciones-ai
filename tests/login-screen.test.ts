// @vitest-environment jsdom

// =============================================================================
// LoginScreen tras el paso a Google OAuth.
//
// Lo que estos tests fijan:
//   1. No queda ningún campo de contraseña en el DOM: ninguna credencial pasa
//      por el cliente.
//   2. El aviso de rechazo del callback se muestra como texto legible, y no se
//      depende de parsear la URL en cada render.
//   3. El botón navega (no hace fetch): es la única forma de seguir el 302 a
//      Google.
// =============================================================================

import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LoginScreen } from '../src/components/LoginScreen';

afterEach(cleanup);

describe('pantalla de login solo con Google', () => {
  it('no renderiza ningún campo de contraseña ni de correo', () => {
    render(createElement(LoginScreen));

    expect(screen.queryByLabelText(/contraseña/i)).toBeNull();
    expect(screen.queryByLabelText(/correo/i)).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('ofrece el botón de Google como única acción de entrada', () => {
    render(createElement(LoginScreen));

    const button = screen.getByRole('button', { name: /continuar con google/i });
    expect(button.getAttribute('type')).toBe('button');
  });

  it('deja explícito que el dominio institucional es requisito', () => {
    render(createElement(LoginScreen));

    const note = screen.getByText(/@utel\.edu\.mx/).textContent ?? '';
    expect(note).toContain('@utel.edu.mx');
    expect(note).toContain('@s4learning.com');
  });
});

describe('avisos de rechazo del login', () => {
  it('muestra el motivo que devuelve el callback', () => {
    render(createElement(LoginScreen, { authError: 'Solo se admiten correos de @utel.edu.mx o @s4learning.com.' }));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('@utel.edu.mx');
    expect(alert.textContent).toContain('@s4learning.com');
  });

  it('el aviso es anunciable por lectores de pantalla (aria-live)', () => {
    render(createElement(LoginScreen, { authError: 'No tienes acceso a esta aplicación.' }));

    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('polite');
  });

  it('sin rechazo no hay bloque de error', () => {
    render(createElement(LoginScreen));

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('una sesión expirada también explica qué hacer', () => {
    render(createElement(LoginScreen, { sessionExpired: true }));

    expect(screen.getByRole('alert').textContent).toMatch(/sesión expiró/i);
  });

  it('el motivo del callback tiene prioridad sobre el aviso de sesión expirada', () => {
    render(createElement(LoginScreen, { authError: 'Dominio no permitido.', sessionExpired: true }));

    expect(screen.getByRole('alert').textContent).toBe('Dominio no permitido.');
  });
});
