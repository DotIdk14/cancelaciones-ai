// =============================================================================
// Capacidades por rol — MÓDULO HOJA, sin imports de servidor.
//
// Vive separado de `auth.ts` por una razón concreta y ya conocida en este repo
// (LEAF_MODULES_HAVE_NO_SERVER_IMPORTS): los tests sustituyen `src/server/cases`
// y `src/server/reviews` por un store en memoria DENTRO de una fábrica de
// `vi.mock`. Si ese store importara `auth.ts` —que arrastra el SDK de InsForge y
// sus proprios mocks— el ciclo de módulos cuelga la suite antes del primer test,
// sin fallar. `errors.ts` y `derived.ts` existen por lo mismo.
//
// `auth.ts` reexporta TODO lo de aquí, así que `capabilitiesForRole` sigue
// siendo, para todo el código de producción, la misma función de `auth.ts`.
// =============================================================================

/**
 * Rol de aplicación persistido en `app_memberships`.
 *
 * `user` es el identificador que ya existe en la base y se presenta como
 * "Asesor". No se renombra ni se migra: renombrarlo sería reescribir filas sin
 * una necesidad funcional.
 */
export type AppRole = 'user' | 'coordinator' | 'manager';

const ROLES: AppRole[] = ['user', 'coordinator', 'manager'];

/** Las cuatro capacidades del contrato. Vocabulario cerrado. */
export interface AuthCapabilities {
  readonly canReadAllCases: boolean;
  readonly canReviewOwnCases: boolean;
  readonly canFinalizeAnyCase: boolean;
  readonly canWriteOwnedCases: boolean;
}

function freezeCapabilities(caps: AuthCapabilities): AuthCapabilities {
  return Object.freeze({ ...caps });
}

/** Todo negado: el estado fail-closed por defecto para roles no resueltos. */
export const DENY_ALL_CAPABILITIES: AuthCapabilities = freezeCapabilities({
  canReadAllCases: false,
  canReviewOwnCases: false,
  canFinalizeAnyCase: false,
  canWriteOwnedCases: false,
});

const CAPABILITIES_BY_ROLE: Record<AppRole, AuthCapabilities> = {
  // Asesor: lectura/escritura/revisión propias; nada global ni finalización.
  user: freezeCapabilities({
    canReadAllCases: false,
    canReviewOwnCases: true,
    canFinalizeAnyCase: false,
    canWriteOwnedCases: true,
  }),
  // Coordinador: lectura global y finalización; la revisión de un caso de Asesor
  // NO se le concede (default denegar), solo escribe los propios.
  coordinator: freezeCapabilities({
    canReadAllCases: true,
    canReviewOwnCases: false,
    canFinalizeAnyCase: true,
    canWriteOwnedCases: true,
  }),
  // Gerente: SOLO lectura global. No muta, no revisa, no finaliza.
  manager: freezeCapabilities({
    canReadAllCases: true,
    canReviewOwnCases: false,
    canFinalizeAnyCase: false,
    canWriteOwnedCases: false,
  }),
};

/**
 * Deriva las capacidades desde el rol verificado.
 *
 * Es la ÚNICA fuente para los guards de casos: ningún endpoint decide con un
 * `if (role === ...)` repartido. Rol no resuelto, desconocido, `null` o
 * `undefined` → todo negado (fail-closed). Nunca se escala privilegios por
 * contenido de la fila.
 */
export function capabilitiesForRole(role: AppRole | null | undefined): AuthCapabilities {
  if (role === null || role === undefined) return DENY_ALL_CAPABILITIES;
  return CAPABILITIES_BY_ROLE[role] ?? DENY_ALL_CAPABILITIES;
}

/** Guard de vocabulario: `true` solo para los tres roles persistidos. */
export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && ROLES.includes(value as AppRole);
}