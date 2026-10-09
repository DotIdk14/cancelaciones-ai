import type { AppRole, AuthContext } from '../../src/server/auth';

export const FAKE_USER_SUB = '00000000-0000-0000-0000-0000-000000000001';
export const FAKE_USER_EMAIL = 'test@example.com';

/** Identidad del coordinador: mismo shape de sesión, `sub` DISTINTO al del asesor. */
export const FAKE_COORDINATOR_SUB = '00000000-0000-0000-0000-0000-000000000002';
export const FAKE_COORDINATOR_EMAIL = 'coord@example.com';

/**
 * Sesión simulada.
 *
 * El `sub` por defecto NO depende del rol a propósito: cambiarlo haría depender
 * de esta firma el resultado de los tests de alcance que ya existían. Los tests
 * que necesitan distinguir QUIÉN actuó (la atribución derivada del servidor en el
 * flujo de dos etapas) pasan `overrides: { sub, email }` explícito; si no lo
 * hicieran, un `created_by` equivocado pasaría por bueno.
 */
export function fakeAuthContext(
  role: AppRole = 'user',
  overrides: { sub?: string; email?: string } = {},
): AuthContext {
  return {
    sub: overrides.sub ?? FAKE_USER_SUB,
    email: overrides.email ?? FAKE_USER_EMAIL,
    role,
  };
}