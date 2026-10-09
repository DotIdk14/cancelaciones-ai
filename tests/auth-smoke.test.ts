// =============================================================================
// Frontera de sesión, de punta a punta del lado del cliente.
//
// Fija el contrato mínimo que la SPA necesita del servidor: `refreshSession()`
// devuelve un snapshot de sesión CON ROL, y ese rol es solo PRESENTACIÓN
// (`user` se presenta como Asesor). Lo que se fija aquí:
//
//   1. El helper de auth acepta los tres roles del contrato, sin tocar las
//      filas ya persistidas en `app_memberships`.
//   2. Un rol que el servidor no reconoce NO viaja a la UI como capacidad: el
//      snapshot lo degrada a `null` en vez de creerse un rol nuevo.
//   3. Sin sesión (401) el snapshot es `null`, como antes.
// =============================================================================

import { describe, expect, it, vi } from 'vitest';
import { capabilitiesForRole, type AppRole } from '../src/server/auth';
import { fakeAuthContext } from './helpers/auth';
import { isAppRole, refreshSession, type SessionSnapshot } from '../src/lib/api';
import { ROLE_LABELS, roleLabel } from '../src/lib/useSession';

/** Respuesta mínima con la forma que consume `refreshSession`. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('helper de auth de tests', () => {
  it('devuelve un contexto falso', () => {
    const auth = fakeAuthContext();
    expect(auth.sub).toBe('00000000-0000-0000-0000-0000-000000000001');
    expect(auth.role).toBe('user');
  });

  it('acepta los tres roles del contrato sin renombrar `user`', () => {
    for (const role of ['user', 'coordinator', 'manager'] as AppRole[]) {
      expect(fakeAuthContext(role).role).toBe(role);
    }
    expect(fakeAuthContext('user').role).toBe('user');
  });
});

describe('capacidades derivadas (servidor) vs. rol de presentación (cliente)', () => {
  it('el rol que viaja en la sesión NO habilita nada por sí solo en el servidor', () => {
    // La UI conoce el rol, pero la autorización se deriva del contexto que
    // resuelve `requireAuth`. Que ambos digan lo mismo no es una excepción que
    // se pueda abrir desde el cliente: `capabilitiesForRole` no acepta nada que
    // no esté en el vocabulario cerrado.
    expect(capabilitiesForRole('admin' as AppRole)).toEqual(
      capabilitiesForRole(undefined as unknown as AppRole),
    );
    expect(capabilitiesForRole('manager').canWriteOwnedCases).toBe(false);
  });

  it('`user` se presenta como Asesor; los demás rótulos son los del contrato', () => {
    expect(ROLE_LABELS.user).toBe('Asesor');
    expect(roleLabel('user')).toBe('Asesor');
    expect(roleLabel('coordinator')).toBe(ROLE_LABELS.coordinator);
    expect(roleLabel('manager')).toBe(ROLE_LABELS.manager);
  });

  it('sin rol no hay rótulo: la UI no inventa una identidad', () => {
    expect(roleLabel(null)).toBeNull();
  });
});

describe('refreshSession devuelve el rol que resolvió el servidor', () => {
  it('200 con role=user entrega ese rol en el snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { ok: true, role: 'user' })),
    );

    await expect(refreshSession()).resolves.toEqual({ role: 'user', capabilities: { canReadAllCases: false, canReviewOwnCases: false, canFinalizeAnyCase: false, canWriteOwnedCases: false, canManageCases: false } } satisfies SessionSnapshot);
  });

  it('200 con role=manager llega tal cual, sin traducción a etiqueta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { ok: true, role: 'manager' })),
    );

    await expect(refreshSession()).resolves.toEqual({ role: 'manager', capabilities: { canReadAllCases: false, canReviewOwnCases: false, canFinalizeAnyCase: false, canWriteOwnedCases: false, canManageCases: false } });
  });

  it('200 sin rol (o con un rol desconocido) deja el rol en null, no crea capacidades', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ok: true })));
    await expect(refreshSession()).resolves.toEqual({ role: null, capabilities: { canReadAllCases: false, canReviewOwnCases: false, canFinalizeAnyCase: false, canWriteOwnedCases: false, canManageCases: false } });

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ok: true, role: 'admin' })));
    await expect(refreshSession()).resolves.toEqual({ role: null, capabilities: { canReadAllCases: false, canReviewOwnCases: false, canFinalizeAnyCase: false, canWriteOwnedCases: false, canManageCases: false } });
  });

  it('401 (sin sesión) devuelve null, igual que antes del contrato de roles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: { category: 'UNAUTHENTICATED' } })));

    await expect(refreshSession()).resolves.toBeNull();
  });

  it('el guard de rol del cliente comparte vocabulario con el del servidor', () => {
    for (const role of ['user', 'coordinator', 'manager']) {
      expect(isAppRole(role)).toBe(true);
    }
    expect(isAppRole('asesor')).toBe(false);
    expect(isAppRole(null)).toBe(false);
  });
});
