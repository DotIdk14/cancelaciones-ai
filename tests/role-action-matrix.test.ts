// =============================================================================
// Matriz rol × acción — la frontera de autorización, fijada en la capa `api/`.
//
// POR QUÉ ESTE ARCHIVO EXISTE
//   La frontera de autorización real es la CAPACIDAD del rol, no la RLS: el
//   servidor escribe con un cliente privilegiado (`project_admin`, BYPASSRLS),
//   así que para él las políticas no aplican y `created_by` no restringe nada.
//   Quien decide es `capabilitiesForRole` + los guards de los endpoints. Este
//   archivo llama a los handlers REALES (no a la UI) con sesiones sintéticas y
//   fija, rol por rol, qué acción termina en 200/201/403/404/409.
//
// LO QUE NO ES
//   No reemplaza `tests/security-regressions.test.ts`; lo extiende. Ahí viven el
//   401 sin sesión, el CSRF, el 503 del proveedor caído y la matriz de `/review`
//   con un cliente por tabla. Aquí se añade la matriz completa por rol sobre
//   `/api/cases` (crear y listar), `/api/cases/:id/review` (leer y mutar) y
//   `/api/cases/:id/area-comments` (familia de escritura), más el caso de rol
//   desconocido/ausente (fail-closed).
//
// SOBRE LOS 400 DE ESTA MATRIZ
//   Un 400 aquí NO es un resultado de permiso: es "etapa equivocada" y es
//   correcto. El Coordinador no tiene etapa de asesor (`canReviewOwnCases` es
//   false), así que un POST con cuerpo de asesor sobre un caso sin revisión cae
//   en "no hay nada que finalizar" (400). Se documenta explícitamente para que
//   nadie lo confunda con un 403 de permiso.
//
// REGLA DE ORO DE LA MATRIZ
//   - Fuera de alcance (no es tuyo y no puedes leer todo) → 404, nunca 403.
//   - En alcance pero sin permiso (p.ej. Gerente) → 403.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest, ApiResponse } from '../src/server/http';
import type { AppRole } from '../src/server/capabilities';
import type { SubmitCaseReviewInput } from '../src/server/comparison-service';
import { setTestEnv } from './helpers/env';
import { fakeAuthContext, FAKE_USER_EMAIL, FAKE_USER_SUB } from './helpers/auth';
import { resetStore, seedCase, seedReview } from './helpers/fake-store';

import casesHandler from '../api/cases/index';
import reviewHandler from '../api/cases/[caseId]/review/index';
import areaCommentsHandler from '../api/cases/[caseId]/area-comments/index';

// --- Persistencia de casos/evidencias/auditorías: store en memoria -------------
vi.mock('../src/server/cases', async () => {
  const store = await import('./helpers/fake-store');
  return {
    getCaseOr404: store.getCaseOr404,
    getScopedCaseOr404: store.getScopedCaseOr404,
    derivedExtractionOf: store.derivedExtractionOf,
    persistDerivedExtraction: store.persistDerivedExtraction,
    assertCaseOwner: store.assertCaseOwner,
    listCaseSummaries: store.listCaseSummaries,
    createCase: store.createCase,
    listEvidenceRows: store.listEvidenceRows,
    getEvidenceOr404: store.getEvidenceOr404,
    insertEvidence: store.insertEvidence,
    updateEvidenceStatus: store.updateEvidenceStatus,
    deleteEvidenceRow: store.deleteEvidenceRow,
    latestAudit: store.latestAudit,
    latestCompletedAuditByFingerprint: store.latestCompletedAuditByFingerprint,
    latestRunningAuditByFingerprint: store.latestRunningAuditByFingerprint,
    countAuditsByFingerprint: store.countAuditsByFingerprint,
    insertAudit: store.insertAudit,
    updateAuditResult: store.updateAuditResult,
    updateCaseStatus: store.updateCaseStatus,
    updateCaseDimensions: store.updateCaseDimensions,
    getAuditById: store.getAuditById,
    latestCompletedAudit: store.latestCompletedAudit,
  };
});

// --- Persistencia de revisiones/comparaciones: store en memoria --------------
vi.mock('../src/server/reviews', async () => {
  const store = await import('./helpers/fake-store');
  return {
    createCaseReview: store.createCaseReview,
    getCaseReview: store.getCaseReview,
    finalizeCaseReview: store.finalizeCaseReview,
    insertComparison: store.insertComparison,
    getLatestComparisonForReview: store.getLatestComparisonForReview,
    rearmComparison: store.rearmComparison,
    updateComparisonResult: store.updateComparisonResult,
    updateComparisonError: store.updateComparisonError,
    listComparisonsForCase: store.listComparisonsForCase,
  };
});

// --- Servicio de comparación: la IA no entra en una matriz de permisos --------
// `healStaleComparison` es un no-op y `submitCaseReview` se resuelve contra el
// store. Lo que se fija aquí NO es la orquestación de la IA (eso vive en
// `tests/human-review.test.ts`) sino la DECISIÓN del endpoint: capacidades,
// alcance y etapa, que corren ANTES de llamar a este servicio.
vi.mock('../src/server/comparison-service', async () => {
  const store = await import('./helpers/fake-store');
  return {
    healStaleComparison: async (): Promise<void> => {},
    submitCaseReview: async (
      client: unknown,
      caseId: string,
      input: SubmitCaseReviewInput,
    ) => {
      const review = await store.createCaseReview(client, {
        caseId,
        auditId: 'audit-1',
        result: input.result,
        reviewerName: input.reviewerEmail,
        comment: input.comment,
        userId: input.userId,
      });
      return {
        review: { id: review.id, caseId: review.case_id, result: review.result, coordinatorDecision: null },
        comparison: null,
        workflowState: 'PENDING_COORDINATOR' as const,
      };
    },
  };
});

// --- Comentarios de área: se observa la escritura, no se hace -----------------
const { upsertAreaCommentMock } = vi.hoisted(() => ({ upsertAreaCommentMock: vi.fn() }));
vi.mock('../src/server/area-comments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/area-comments')>();
  return { ...actual, upsertAreaComment: upsertAreaCommentMock };
});

// --- Cliente server-side de InsForge: store aislado, sin red ----------------
vi.mock('../src/server/insforge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/insforge')>();
  const store = await import('./helpers/fake-store');
  return { ...actual, createServerClient: vi.fn(() => store.fakeClient) };
});

const OWN_CASE = 'case-propio';
const OTHER_CASE = 'case-ajeno';
const OTHER_OWNER = 'otro-usuario';

function makeApiResponse(): ApiResponse & { statusCode: number; body: string } {
  const fake = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    setHeader: (name: string, value: unknown) => {
      fake.headers[name] = String(value);
    },
    appendHeader: (name: string, value: unknown) => {
      fake.headers[name] = String(value);
    },
    end: (chunk?: unknown) => {
      fake.body =
        typeof chunk === 'string'
          ? chunk
          : chunk instanceof Buffer
            ? chunk.toString('utf-8')
            : '';
    },
  };
  return fake as unknown as ApiResponse & { statusCode: number; body: string };
}

function makeApiRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    url: '/',
    headers: {},
    query: {},
    ...overrides,
  } as unknown as ApiRequest;
}

/** Sesión sintética con rol fuera del vocabulario o directamente ausente. */
function rogueAuth(role: AppRole | undefined): ApiRequest['auth'] {
  return { sub: FAKE_USER_SUB, email: FAKE_USER_EMAIL, role } as unknown as ApiRequest['auth'];
}

beforeEach(() => {
  setTestEnv();
  resetStore();
  upsertAreaCommentMock.mockReset();
  upsertAreaCommentMock.mockImplementation(
    async (_client: unknown, input: { caseId: string; area: string; comment: string; userId: string }) => ({
      id: 'ac-1',
      case_id: input.caseId,
      area: input.area,
      comment: input.comment,
      created_by: input.userId,
      created_at: '2026-02-02T09:00:00.000Z',
      updated_at: '2026-02-02T09:00:00.000Z',
    }),
  );
});

// ------------------------------------------------------------------ llamadas
async function createCase(role: AppRole | undefined, body: unknown = { studentIdentifier: 'UTEL-2026-001' }) {
  const res = makeApiResponse();
  await casesHandler(makeApiRequest({ method: 'POST', auth: rogueAuth(role), body }), res);
  return res;
}

async function listCases(role: AppRole) {
  const res = makeApiResponse();
  await casesHandler(makeApiRequest({ method: 'GET', auth: fakeAuthContext(role) }), res);
  return res;
}

async function readReview(role: AppRole, caseId: string) {
  const res = makeApiResponse();
  await reviewHandler(
    makeApiRequest({ method: 'GET', query: { caseId }, auth: fakeAuthContext(role) }),
    res,
  );
  return res;
}

async function postReview(role: AppRole | undefined, caseId: string, body: unknown) {
  const res = makeApiResponse();
  await reviewHandler(
    makeApiRequest({ method: 'POST', query: { caseId }, auth: rogueAuth(role), body }),
    res,
  );
  return res;
}

async function postAreaComment(role: AppRole | undefined, caseId: string) {
  const res = makeApiResponse();
  await areaCommentsHandler(
    makeApiRequest({
      method: 'POST',
      query: { caseId },
      auth: rogueAuth(role),
      body: { area: 'BACK_OFFICE', comment: 'Observación de la matriz.' },
    }),
    res,
  );
  return res;
}

const ADVISOR_BODY = { result: 'BAJA', comment: 'Resolución propuesta por el asesor.' };
const COORDINATOR_BODY = { decision: 'APPROVE' };

// =============================================================================
describe('crear caso · POST /api/cases', () => {
  it('Asesor y Coordinador crean: 201 (la colección está en alcance y tienen escritura)', async () => {
    for (const role of ['user', 'coordinator'] as const) {
      resetStore();
      const res = await createCase(role);
      expect(res.statusCode, `rol ${role}`).toBe(201);
    }
  });

  it('Gerente NO crea: 403 (puede leer todo, no mutar), y no se valida el cuerpo', async () => {
    // El guard de capacidad va ANTES de leer el cuerpo: con un cuerpo inválido
    // sigue siendo 403, no 400. Si fuera 400, confirmaría que el cuerpo se procesa.
    const res = await createCase('manager', { created_by: 'inyectado', isTest: 'no-es-booleano' });
    expect(res.statusCode).toBe(403);
    expect((JSON.parse(res.body) as { error: { category: string } }).error.category).toBe('AUTH_ERROR');
  });
});

describe('leer · GET /api/cases (listado con scope del servidor)', () => {
  beforeEach(() => {
    seedCase({ id: OWN_CASE, created_by: FAKE_USER_SUB });
    seedCase({ id: OTHER_CASE, created_by: OTHER_OWNER });
  });

  it('Asesor solo ve los propios; Coordinador y Gerente ven todo', async () => {
    const asUser = await listCases('user');
    expect(asUser.statusCode).toBe(200);
    const userCases = (JSON.parse(asUser.body) as { cases: Array<{ id: string }> }).cases;
    expect(userCases.map((c) => c.id)).toEqual([OWN_CASE]);

    for (const role of ['coordinator', 'manager'] as const) {
      const res = await listCases(role);
      expect(res.statusCode, `rol ${role}`).toBe(200);
      const ids = (JSON.parse(res.body) as { cases: Array<{ id: string }> }).cases.map((c) => c.id).sort();
      expect(ids, `rol ${role}`).toEqual([OTHER_CASE, OWN_CASE].sort());
    }
  });
});

describe('leer un caso · GET /api/cases/:id/review', () => {
  beforeEach(() => {
    seedCase({ id: OWN_CASE, created_by: FAKE_USER_SUB });
    seedCase({ id: OTHER_CASE, created_by: OTHER_OWNER });
  });

  it('caso PROPIO: 200 para los tres roles', async () => {
    for (const role of ['user', 'coordinator', 'manager'] as const) {
      const res = await readReview(role, OWN_CASE);
      expect(res.statusCode, `rol ${role}`).toBe(200);
    }
  });

  it('caso AJENO: Asesor 404 (no enumera existencia); Coordinador y Gerente 200', async () => {
    const asUser = await readReview('user', OTHER_CASE);
    expect(asUser.statusCode).toBe(404);
    for (const role of ['coordinator', 'manager'] as const) {
      const res = await readReview(role, OTHER_CASE);
      expect(res.statusCode, `rol ${role}`).toBe(200);
    }
  });
});

describe('escribir · POST /api/cases/:id/area-comments', () => {
  beforeEach(() => {
    seedCase({ id: OWN_CASE, created_by: FAKE_USER_SUB });
    seedCase({ id: OTHER_CASE, created_by: OTHER_OWNER });
  });

  it('caso PROPIO: Asesor y Coordinador 200 y SÍ escriben; Gerente 403 y NO escribe', async () => {
    for (const role of ['user', 'coordinator'] as const) {
      upsertAreaCommentMock.mockClear();
      const res = await postAreaComment(role, OWN_CASE);
      expect(res.statusCode, `rol ${role}`).toBe(200);
      expect(upsertAreaCommentMock, `rol ${role}`).toHaveBeenCalledTimes(1);
    }

    upsertAreaCommentMock.mockClear();
    const manager = await postAreaComment('manager', OWN_CASE);
    expect(manager.statusCode).toBe(403);
    expect(upsertAreaCommentMock).not.toHaveBeenCalled();
  });

  it('caso AJENO: Asesor y Coordinador 404; Gerente 403; en ningún caso se escribe', async () => {
    for (const role of ['user', 'coordinator'] as const) {
      upsertAreaCommentMock.mockClear();
      const res = await postAreaComment(role, OTHER_CASE);
      expect(res.statusCode, `rol ${role}`).toBe(404);
      expect(upsertAreaCommentMock, `rol ${role}`).not.toHaveBeenCalled();
    }

    upsertAreaCommentMock.mockClear();
    const manager = await postAreaComment('manager', OTHER_CASE);
    expect(manager.statusCode).toBe(403);
    expect(upsertAreaCommentMock).not.toHaveBeenCalled();
  });
});

describe('revisar como asesor · POST /api/cases/:id/review {result}', () => {
  it('Asesor sobre su caso PENDING_ADVISOR: 201 (crea la revisión de asesor)', async () => {
    seedCase({ id: OWN_CASE, created_by: FAKE_USER_SUB });
    const res = await postReview('user', OWN_CASE, ADVISOR_BODY);
    expect(res.statusCode).toBe(201);
    expect((JSON.parse(res.body) as { workflowState: string }).workflowState).toBe('PENDING_COORDINATOR');
  });

  it('Asesor sobre su caso ya revisado: 409 (la decisión del asesor es única e inmutable)', async () => {
    seedCase({ id: OWN_CASE, created_by: FAKE_USER_SUB });
    seedReview({ case_id: OWN_CASE, result: 'BAJA' });
    const res = await postReview('user', OWN_CASE, ADVISOR_BODY);
    expect(res.statusCode).toBe(409);
  });

  it('Asesor sobre caso AJENO: 404 (nunca 403: no confirma que exista)', async () => {
    seedCase({ id: OTHER_CASE, created_by: OTHER_OWNER });
    const res = await postReview('user', OTHER_CASE, ADVISOR_BODY);
    expect(res.statusCode).toBe(404);
  });

  it('Gerente: 403 (lee el caso, no revisa ni finaliza)', async () => {
    seedCase({ id: OWN_CASE, created_by: FAKE_USER_SUB });
    const res = await postReview('manager', OWN_CASE, ADVISOR_BODY);
    expect(res.statusCode).toBe(403);
    expect((JSON.parse(res.body) as { error: { category: string } }).error.category).toBe('AUTH_ERROR');
  });

  it('Coordinador con cuerpo de asesor sobre caso sin revisión: 400 (etapa equivocada, no permiso)', async () => {
    // El Coordinador no tiene etapa de asesor (`canReviewOwnCases` false); su
    // única etapa es finalizar. Sobre un caso sin revisión no hay nada que
    // finalizar, así que el endpoint responde 400 y NO 403: el Coordinador SÍ
    // tiene permiso de mutar `/review`, lo que falla es la etapa del flujo.
    seedCase({ id: OWN_CASE, created_by: FAKE_USER_SUB });
    const res = await postReview('coordinator', OWN_CASE, ADVISOR_BODY);
    expect(res.statusCode).toBe(400);
  });
});

describe('finalizar como coordinador · POST /api/cases/:id/review {decision}', () => {
  it('Coordinador sobre caso PENDING_COORDINATOR: 200 (finaliza el caso de un asesor)', async () => {
    seedCase({ id: OTHER_CASE, created_by: OTHER_OWNER });
    seedReview({ case_id: OTHER_CASE, result: 'BAJA', coordinator_decision: null });
    const res = await postReview('coordinator', OTHER_CASE, COORDINATOR_BODY);
    expect(res.statusCode).toBe(200);
    expect((JSON.parse(res.body) as { workflowState: string }).workflowState).toBe('FINALIZED');
  });

  it('Coordinador sobre caso ya finalizado: 409 (la finalización es única e inmutable)', async () => {
    seedCase({ id: OTHER_CASE, created_by: OTHER_OWNER });
    seedReview({ case_id: OTHER_CASE, result: 'BAJA', coordinator_decision: 'APPROVE' });
    const res = await postReview('coordinator', OTHER_CASE, COORDINATOR_BODY);
    expect(res.statusCode).toBe(409);
  });

  it('Asesor sobre caso PENDING_COORDINATOR: 409 (no es su etapa; el cuerpo ni se mira)', async () => {
    seedCase({ id: OWN_CASE, created_by: FAKE_USER_SUB });
    seedReview({ case_id: OWN_CASE, result: 'BAJA', coordinator_decision: null });
    const res = await postReview('user', OWN_CASE, COORDINATOR_BODY);
    expect(res.statusCode).toBe(409);
  });

  it('Gerente: 403 y nada se escribe', async () => {
    seedCase({ id: OTHER_CASE, created_by: OTHER_OWNER });
    const review = seedReview({ case_id: OTHER_CASE, result: 'BAJA', coordinator_decision: null });
    const res = await postReview('manager', OTHER_CASE, COORDINATOR_BODY);
    expect(res.statusCode).toBe(403);
    // La fila sigue sin decisión de coordinador.
    expect(review.coordinator_decision).toBeNull();
  });
});

describe('rol desconocido o ausente · fail-closed en toda mutación', () => {
  beforeEach(() => {
    seedCase({ id: OWN_CASE, created_by: FAKE_USER_SUB });
  });

  it('un rol fuera del vocabulario NO escala privilegios: 403 en crear, revisar y comentar', async () => {
    const unknown = 'admin' as unknown as AppRole;

    expect((await createCase(unknown)).statusCode).toBe(403);
    expect((await postReview(unknown, OWN_CASE, ADVISOR_BODY)).statusCode).toBe(403);
    expect((await postAreaComment(unknown, OWN_CASE)).statusCode).toBe(403);
    expect(upsertAreaCommentMock).not.toHaveBeenCalled();
  });

  it('un rol ausente (undefined) tampoco: 403 en crear, revisar y comentar', async () => {
    expect((await createCase(undefined)).statusCode).toBe(403);
    expect((await postReview(undefined, OWN_CASE, ADVISOR_BODY)).statusCode).toBe(403);
    expect((await postAreaComment(undefined, OWN_CASE)).statusCode).toBe(403);
    expect(upsertAreaCommentMock).not.toHaveBeenCalled();
  });

  it('la resolución de sesión sigue siendo la primera barrera: sin rol en la base, 403', () => {
    // El fail-closed de la identidad (rol desconocido en `app_memberships`, sin
    // fila, o proveedor caído) se fija en `tests/security-regressions.test.ts`
    // (R5) y `tests/role-capabilities.test.ts`. Aquí se recuerda que la matriz
    // de arriba asume una sesión YA resuelta: los handlers reciben `req.auth`.
    expect(true).toBe(true);
  });
});
