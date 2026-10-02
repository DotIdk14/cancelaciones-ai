import type { AuthContext } from '../../src/server/auth';

export const FAKE_USER_SUB = '00000000-0000-0000-0000-000000000001';
export const FAKE_USER_EMAIL = 'test@example.com';

export function fakeAuthContext(role: AuthContext['role'] = 'user'): AuthContext {
  return {
    sub: FAKE_USER_SUB,
    email: FAKE_USER_EMAIL,
    role,
  };
}
