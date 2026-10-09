// =============================================================================
// Contrato de ROLES Y CAPACIDADES del flujo de revisión humana.
//
// Este archivo fija el vocabulario cerrado que gobierna "qué puede hacer cada
// rol", para que los guards de casos (Task 3/4) tengan un único origen y no
// decidan con `if (role === ...)` repartido por los endpoints.
//
// Decisiones que quedan escritas aquí (cambiar cualquiera obliga a cambiar el
// test a propósito, no por descuido):
//   1. `user` es el identificador PERSISTIDO en `app_memberships` y se presenta
//      como "Asesor". No se renombra ni se migra: la base ya tiene filas.
//   2. `coordinator` lee todos los casos y finaliza cualquiera, pero NO revisa
//      casos de Asesor: la revisión es del Asesor y el default es denegar.
//   3. `coordinator` sí puede escribir un caso que sea PROPIO. Lo que abre la
//      escritura es la propiedad del caso, no el rol
//      (AREA_COMMENTS_ARE_WRITABLE_BY_OWNER_ONLY → `assertCaseOwner`).
//   4. `manager` lee todo y tiene mantenimiento administrativo, pero no escribe
//      casos propios, revisa ni finaliza.
//   5. Rol desconocido, `null` o `undefined` → todas las capacidades en false.
//      Nunca se escala privilegios por contenido de la fila.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  capabilitiesForRole,
  DENY_ALL_CAPABILITIES,
  isAppRole,
  type AppRole,
} from '../src/server/auth';
import { FAKE_USER_SUB } from './helpers/auth';
import { setTestEnv } from './helpers/env';

// `requireAuth` → `getCurrentUserFromCookies` → `getEnv()` exige las variables de
// entorno; el bloque "se resuelve desde app_memberships" monta `requireAuth` real.
beforeEach(() => setTestEnv());

/** Capacidades del contrato. Lista explícita: añadir una obliga a decidir. */
const CAPABILITIES = [
  'canReadAllCases',
  'canReviewOwnCases',
  'canFinalizeAnyCase',
  'canWriteOwnedCases',
  'canManageCases',
] as const;

describe('mapeo rol -> capacidades (derivado en el servidor)', () => {
  it('user (Asesor): lectura, escritura y revisión propias; nada global ni finalización', () => {
    expect(capabilitiesForRole('user')).toEqual({
      canReadAllCases: false,
      canReviewOwnCases: true,
      canFinalizeAnyCase: false,
      canWriteOwnedCases: true,
      canManageCases: false,
    });
  });

  it('coordinator: lectura global y finalización de cualquier caso, sin revisar los de Asesor', () => {
    expect(capabilitiesForRole('coordinator')).toEqual({
      canReadAllCases: true,
      canFinalizeAnyCase: true,
      canReviewOwnCases: false,
      // Default denegar: la revisión de un caso de Asesor no se le concede.
      canWriteOwnedCases: true,
      canManageCases: false,
    });
  });

  it('manager: lectura global y mantenimiento administrativo, sin permisos operativos', () => {
    expect(capabilitiesForRole('manager')).toEqual({
      canReadAllCases: true,
      canReviewOwnCases: false,
      canFinalizeAnyCase: false,
      canWriteOwnedCases: false,
      canManageCases: true,
    });
  });

  it('manager no muta, no revisa y no finaliza NUNCA, ni sobre un caso propio', () => {
    const caps = capabilitiesForRole('manager');
    expect(caps.canWriteOwnedCases).toBe(false);
    expect(caps.canReviewOwnCases).toBe(false);
    expect(caps.canFinalizeAnyCase).toBe(false);
  });

  it('solo coordinator lee y finalize globalmente', () => {
    for (const role of ['user', 'coordinator', 'manager'] as AppRole[]) {
      const caps = capabilitiesForRole(role);
      const isCoordinator = role === 'coordinator';
      // Lectura global: coordinador Y gerente. Finalización: solo coordinador.
      expect(caps.canReadAllCases).toBe(isCoordinator || role === 'manager');
      expect(caps.canFinalizeAnyCase).toBe(isCoordinator);
    }
  });

  it('el vocabulario de capacidades es cerrado', () => {
    for (const role of ['user', 'coordinator', 'manager'] as AppRole[]) {
      expect(Object.keys(capabilitiesForRole(role)).sort()).toEqual([...CAPABILITIES].sort());
    }
    expect(Object.keys(DENY_ALL_CAPABILITIES).sort()).toEqual([...CAPABILITIES].sort());
  });

  it('rol desconocido, null o undefined NO escala privilegios: todo false (fail-closed)', () => {
    const unknown = capabilitiesForRole('admin' as AppRole);
    expect(unknown).toEqual(DENY_ALL_CAPABILITIES);
    for (const capability of CAPABILITIES) {
      expect(unknown[capability]).toBe(false);
      expect(capabilitiesForRole(null)[capability]).toBe(false);
      expect(capabilitiesForRole(undefined)[capability]).toBe(false);
    }
  });

  it('las capacidades son inmutables: nadie las abre en caliente para un caso concreto', () => {
    expect(Object.isFrozen(DENY_ALL_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(capabilitiesForRole('coordinator'))).toBe(true);
    expect(Object.isFrozen(capabilitiesForRole('manager'))).toBe(true);
  });

  it('isAppRole acepta el vocabulario persistido y rechaza todo lo demás', () => {
    for (const role of ['user', 'coordinator', 'manager']) {
      expect(isAppRole(role)).toBe(true);
    }
    for (const value of ['admin', 'asesor', '', 'USER', null, undefined, 7, {}]) {
      expect(isAppRole(value)).toBe(false);
    }
  });
});

describe('el rol se resuelve desde app_memberships, sin migrar filas existentes', () => {
  /** Monta `requireAuth` con identidad y membership simulados. */
  async function requireAuthWithMembership(membership: {
    row: unknown;
    error: { statusCode?: number; code?: string; message: string } | null;
  }): Promise<{ ok: true; role: string } | { ok: false; status: number }> {
    vi.resetModules();
    vi.doMock('@insforge/sdk', () => ({
      createClient: () => ({
        auth: {
          getCurrentUser: async () => ({
            data: { user: { id: FAKE_USER_SUB, email: 'u@example.com' } },
            error: null,
          }),
        },
      }),
      createAdminClient: () => ({}),
    }));
    vi.doMock('../src/server/insforge', () => ({
      createServerClient: () => ({
        database: {
          from: () => {
            const chain = {
              select: () => chain,
              eq: () => chain,
              single: () => Promise.resolve({ data: membership.row, error: membership.error }),
            };
            return chain;
          },
        },
      }),
    }));
    try {
      const { requireAuth } = await import('../src/server/auth');
      const context = await requireAuth({ headers: { cookie: 'insforge_access_token=token' } });
      return { ok: true, role: context.role };
    } catch (error) {
      return { ok: false, status: (error as { status?: number }).status ?? 0 };
    } finally {
      vi.doUnmock('@insforge/sdk');
      vi.doUnmock('../src/server/insforge');
      vi.resetModules();
    }
  }

  it('una fila con role=manager abre sesión como manager', async () => {
    const result = await requireAuthWithMembership({ row: { role: 'manager' }, error: null });
    expect(result).toEqual({ ok: true, role: 'manager' });
  });

  it('las filas existentes (user y coordinator) siguen resolviendo sin cambios', async () => {
    expect(await requireAuthWithMembership({ row: { role: 'user' }, error: null })).toEqual({
      ok: true,
      role: 'user',
    });
    expect(await requireAuthWithMembership({ row: { role: 'coordinator' }, error: null })).toEqual({
      ok: true,
      role: 'coordinator',
    });
  });

  it('un rol fuera del vocabulario sigue siendo 403, no un manager implícito', async () => {
    const result = await requireAuthWithMembership({ row: { role: 'admin' }, error: null });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it('sin fila de membership sigue siendo 403', async () => {
    const result = await requireAuthWithMembership({
      row: null,
      error: { code: 'PGRST116', message: '0 filas' },
    });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });
});
