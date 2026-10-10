// =============================================================================
// PATCH /api/cases/:caseId — la fecha de inicio de clases que aporta una persona.
//
// Por qué existe: el dictamen a veces no puede acreditar la fecha de inicio con
// la evidencia del expediente. Cuando eso pasa, una persona la escribe a mano y
// queda guardada CON PROCEDENCIA (autor y hora). Es un dato humano, no evidencia
// (POLICY_IS_IMMUTABLE) y no re-audita nada (DO_NOT_REPROCESS_AI_UNNECESSARILY).
//
// Lo que fijan estos tests, en el orden en que puede fallar:
//
//   1. VALIDATE_BEFORE_EFFECT: nada que no sea fecha real se escribe. Formato
//      `dd/mm/aaaa`, fecha imposible, año fuera de rango, fecha futura y nombre
//      vacío o desmedido son 400 y NO dejan fila. Un 500 aquí sería la base
//      rechazando `2026-02-30` después de que el endpoint aceptara el body.
//   2. NO_RESOURCE_EXISTENCE_LEAK: un caso ajeno responde 404, nunca 403, y no
//      se escribe nada. El alcance lo resuelve el SERVIDOR (`getScopedCaseOr404`
//      + `assertCaseOwner`), no la RLS: el cliente de la base es superusuario.
//      Por eso el 404 tiene que ocurrir ANTES de validar el cuerpo: un 400 en un
//      caso ajeno confirmaría que el caso existe.
//   3. Guardar es un UPSERT: dos escrituras dejan UNA fila con la última fecha,
//      el último autor y el último nombre, no un histórico.
//   4. La marca de tiempo y el autor los pone el SERVIDOR: el cuerpo solo lleva
//      la fecha y el nombre.
//   5. HOBBY_FUNCTION_BUDGET: esto no es un archivo nuevo en `api/`, es el método
//      `PATCH` y `DELETE` comparten `GET`. Por eso el `Allow` incluye los tres.
//
// Sobre `updated_at`: lo mueve el disparador `cases_set_updated_at` del baseline,
// igual que en cualquier otra escritura sobre `cases` (ver la migración). El
// cliente fake de PostgREST no dispara triggers, así que aquí se comprueba que la
// escritura ES un UPDATE del caso y que no toca otros campos, no el reloj.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest, ApiResponse } from '../src/server/http';
import caseHandler from '../api/cases/[caseId]/index';
import { createServerClient } from '../src/server/insforge';
import { fakeAuthContext, FAKE_USER_SUB } from './helpers/auth';
import { createFakeDatabase } from './helpers/fake-database';
import type { FakeDatabase } from './helpers/fake-database';
import { setTestEnv } from './helpers/env';

// --- Cliente InsForge: base en memoria compartida ------------------------------
// La implementación de la factories NO necesita el store: el test inyecta el
// cliente en `beforeEach`, que es lo que permite observar lo que escribe el
// handler de verdad.
vi.mock('../src/server/insforge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/insforge')>();
  return { ...actual, createServerClient: vi.fn() };
});

const db: FakeDatabase = createFakeDatabase();

/** Fila de `cases` tal como la devuelve el cliente. */
type CaseRowFake = Record<string, unknown>;

function seedCase(overrides: Partial<CaseRowFake> = {}): CaseRowFake {
  const row: CaseRowFake = {
    id: 'case-1',
    status: 'COMPLETED',
    student_identifier: 'UTEL-2026-001',
    created_by: FAKE_USER_SUB,
    created_at: '2026-02-01T10:00:00Z',
    updated_at: '2026-02-01T10:00:00Z',
    cycle_start_date: null,
    cycle_start_date_by: null,
    cycle_start_date_at: null,
    cycle_start_date_by_name: null,
    ...overrides,
  };
  // `rows()` devuelve COPIAS: sembrar tiene que pasar por `seed`, o el handler
  // se encontraría con un `cases` vacío y todo sería un 404 sin explicación.
  db.seed('cases', row);
  return row;
}

function casesRows(): CaseRowFake[] {
  return db.rows('cases');
}

function makeApiResponse(): ApiResponse & { statusCode: number; headers: Record<string, string>; body: string } {
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
      fake.body = typeof chunk === 'string' ? chunk : chunk instanceof Buffer ? chunk.toString('utf-8') : '';
    },
  };
  return fake as unknown as ApiResponse & { statusCode: number; headers: Record<string, string>; body: string };
}

function makeApiRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    // `auth` inyectado es el bypass de tests: salta sesión y CSRF para aislar la
    // validación y el alcance, que es lo que se está probando.
    method: 'PATCH',
    url: '/',
    headers: {},
    query: { caseId: 'case-1' },
    auth: fakeAuthContext(),
    ...overrides,
  } as unknown as ApiRequest;
}

interface CasePayload {
  id: string;
  cycleStartDate: string | null;
  cycleStartDateByName: string | null;
  cycleStartDateAt: string | null;
  [key: string]: unknown;
}

async function patchCase(
  body: unknown,
  overrides: Partial<ApiRequest> = {},
): Promise<{ res: ReturnType<typeof makeApiResponse>; payload: { case?: CasePayload; error?: { category: string; message: string } } }> {
  const res = makeApiResponse();
  await caseHandler(makeApiRequest({ body, ...overrides }), res);
  return { res, payload: JSON.parse(res.body) as { case?: CasePayload; error?: { category: string; message: string } } };
}

const FECHA = '2026-08-21';

beforeEach(() => {
  setTestEnv();
  db.reset();
  vi.mocked(createServerClient).mockReturnValue(db.client);
});

// ------------------------------------------------------------------ validación

describe('PATCH /api/cases/:id · la fecha se valida antes de escribir', () => {
  it('rechaza un formato que no es ISO (dd/mm/aaaa): 400 y nada escrito', async () => {
    seedCase();

    const { res, payload } = await patchCase({ cycleStartDate: '21/08/2026', cycleStartDateByName: 'Ana' });

    expect(res.statusCode).toBe(400);
    expect(payload.error?.category).toBe('VALIDATION_ERROR');
    expect(casesRows()[0]?.cycle_start_date).toBeNull();
  });

  it('rechaza una fecha que no existe en el calendario: 400, no un 500 de la base', async () => {
    // `date` de Postgres rechaza `2026-02-30` con 22007. Si el endpoint lo
    // aceptara, eso llegaría al cliente como 500 y no como un 400 con mensaje.
    seedCase();

    const { res } = await patchCase({ cycleStartDate: '2026-02-30', cycleStartDateByName: 'Ana' });

    expect(res.statusCode).toBe(400);
    expect(casesRows()[0]?.cycle_start_date).toBeNull();
  });

  it('rechaza una fecha futura: 400 y nada escrito', async () => {
    seedCase();

    const { res, payload } = await patchCase({ cycleStartDate: '2999-12-31', cycleStartDateByName: 'Ana' });

    expect(res.statusCode).toBe(400);
    expect(payload.error?.category).toBe('VALIDATION_ERROR');
    expect(casesRows()[0]?.cycle_start_date).toBeNull();
  });

  it('acepta hoy: el corte de "futura" es el día, no una fecha anterior', async () => {
    seedCase();
    const hoy = new Date().toISOString().slice(0, 10);

    const { res } = await patchCase({ cycleStartDate: hoy, cycleStartDateByName: 'Ana' });

    expect(res.statusCode).toBe(200);
    expect(casesRows()[0]?.cycle_start_date).toBe(hoy);
  });

  it.each([
    ['1999-12-31', 'año anterior a 2000'],
    ['2101-01-01', 'año posterior a 2100'],
  ])('rechaza %s (%s): 400 y nada escrito', async (fecha) => {
    seedCase();

    const { res } = await patchCase({ cycleStartDate: fecha, cycleStartDateByName: 'Ana' });

    expect(res.statusCode).toBe(400);
    expect(casesRows()[0]?.cycle_start_date).toBeNull();
  });

  it('acepta el primer año del rango de coherencia', async () => {
    seedCase();

    const { res } = await patchCase({ cycleStartDate: '2000-01-01', cycleStartDateByName: 'Ana' });

    expect(res.statusCode).toBe(200);
  });

  it('el tope del rango es 2100, no "el año que viene"', async () => {
    // El reloj se fija porque `2100-12-31` es hoy una FECHA FUTURA: sin esto el
    // tope superior del rango sería intestable, no inexistente.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2100-12-31T18:00:00.000Z'));
    try {
      seedCase({ id: 'c-2100' });
      seedCase({ id: 'c-2101' });

      const tope = await patchCase(
        { cycleStartDate: '2100-12-31', cycleStartDateByName: 'Ana' },
        { query: { caseId: 'c-2100' } },
      );
      const fuera = await patchCase(
        { cycleStartDate: '2101-01-01', cycleStartDateByName: 'Ana' },
        { query: { caseId: 'c-2101' } },
      );

      expect(tope.res.statusCode).toBe(200);
      expect(fuera.res.statusCode).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rechaza un nombre vacío o de solo espacios: 400 y nada escrito', async () => {
    seedCase();

    const vacio = await patchCase({ cycleStartDate: FECHA, cycleStartDateByName: '' });
    const espacios = await patchCase({ cycleStartDate: FECHA, cycleStartDateByName: '     ' });

    expect(vacio.res.statusCode).toBe(400);
    expect(espacios.res.statusCode).toBe(400);
    expect(casesRows()[0]?.cycle_start_date).toBeNull();
  });

  it('rechaza un nombre de más de 120 caracteres: 400 y nada escrito', async () => {
    seedCase();

    const { res } = await patchCase({ cycleStartDate: FECHA, cycleStartDateByName: 'x'.repeat(121) });

    expect(res.statusCode).toBe(400);
    expect(casesRows()[0]?.cycle_start_date).toBeNull();
  });

  it('acepta un nombre de exactamente 120 caracteres', async () => {
    seedCase();

    const { res } = await patchCase({ cycleStartDate: FECHA, cycleStartDateByName: 'x'.repeat(120) });

    expect(res.statusCode).toBe(200);
  });

  it('recorta el nombre antes de guardarlo', async () => {
    seedCase();

    await patchCase({ cycleStartDate: FECHA, cycleStartDateByName: '  Ana Pérez  ' });

    expect(casesRows()[0]?.cycle_start_date_by_name).toBe('Ana Pérez');
  });

  it('rechaza un cuerpo con campos que el contrato no declara', async () => {
    // En particular `cycleStartDateBy`: el autor lo pone el servidor desde la
    // sesión. Aceptarlo sería permitir que el cliente elija quién escribió.
    seedCase();

    const { res } = await patchCase({
      cycleStartDate: FECHA,
      cycleStartDateByName: 'Ana',
      cycleStartDateBy: 'uuid-de-otra-persona',
    });

    expect(res.statusCode).toBe(400);
    expect(casesRows()[0]?.cycle_start_date).toBeNull();
  });

  it('un body que no es un objeto es 400, no un 500', async () => {
    seedCase();

    const { res } = await patchCase('2026-08-21');

    expect(res.statusCode).toBe(400);
  });

  it('un formato mal tecleado reporta SOLO el formato, no los fallos derivados', async () => {
    // `21/08/2026` es el error más probable de todos porque es el de teclear. Con
    // una cadena de `.refine()` el mensaje traía tres avisos a la vez: el de
    // formato, "no existe en el calendario" y "no puede ser futura". Los dos
    // últimos son FALSOS (derivan de no ser ISO) y hacen que la persona dude de
    // qué corregir. Aquí se exige que el mensaje sea el del primer fallo.
    seedCase();

    const { res, payload } = await patchCase({ cycleStartDate: '21/08/2026', cycleStartDateByName: 'Ana' });

    expect(res.statusCode).toBe(400);
    const message = payload.error?.message ?? '';
    expect(message).toContain('formato');
    expect(message).not.toContain('calendario');
    expect(message).not.toContain('futura');
  });

  it('una fecha que no existe en el calendario reporta solo el calendario', async () => {
    // El orden de los requisitos no cambia: cada uno se sigue evaluando, pero
    // solo se reporta el primero que falla.
    seedCase();

    const { payload } = await patchCase({ cycleStartDate: '2026-02-30', cycleStartDateByName: 'Ana' });

    const message = payload.error?.message ?? '';
    expect(message).toContain('calendario');
    expect(message).not.toContain('formato');
  });

  it('una fecha futura reporta solo que es futura', async () => {
    seedCase();
    // Futura PERO dentro del rango: hay que mover el reloj, porque `2999` es
    // también "año fuera de rango" y el mensaje que se lee es el del primer
    // fallo, que en ese orden es el del año. Sin esto la prueba no distinguiría
    // "reporta el primer fallo" de "reporta el futuro".
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'));
    try {
      const { payload } = await patchCase({ cycleStartDate: '2026-10-02', cycleStartDateByName: 'Ana' });

      const message = payload.error?.message ?? '';
      expect(message).toContain('futura');
      expect(message).not.toContain('calendario');
      expect(message).not.toContain('formato');
    } finally {
      vi.useRealTimers();
    }
  });

  it('una fecha futura fuera de rango reporta el año, no el futuro (primer fallo)', async () => {
    // El orden de los requisitos es explícito: formato, calendario, año,
    // futuro. `2999-12-31` falla en dos, y el que se reporta es el primero.
    seedCase();

    const { payload } = await patchCase({ cycleStartDate: '2999-12-31', cycleStartDateByName: 'Ana' });

    const message = payload.error?.message ?? '';
    expect(message).toContain('2000');
    expect(message).not.toContain('futura');
    expect(message).not.toContain('calendario');
  });

  it('el año fuera de rango reporta el rango, no el calendario', async () => {
    seedCase();

    const { payload } = await patchCase({ cycleStartDate: '1999-12-31', cycleStartDateByName: 'Ana' });

    const message = payload.error?.message ?? '';
    expect(message).toContain('2000');
    expect(message).toContain('2100');
    expect(message).not.toContain('calendario');
  });
});

// --------------------------------------------------------------------- alcance

describe('PATCH /api/cases/:id · un caso ajeno no existe para quien escribe', () => {
  it('un coordinador no escribe en un caso ajeno: 404 y nada escrito', async () => {
    // El coordinador PUEDE leer cualquier caso (visibilidad global de auditoría),
    // así que el alcance de escritura no se resuelve solo al leer: hace falta el
    // `assertCaseOwner` del endpoint. Un 403 confirmaría que el caso existe.
    seedCase({ id: 'c-ajeno', created_by: 'otro-usuario' });

    const { res, payload } = await patchCase(
      { cycleStartDate: FECHA, cycleStartDateByName: 'Ana' },
      { query: { caseId: 'c-ajeno' }, auth: fakeAuthContext('coordinator') },
    );

    expect(res.statusCode).toBe(404);
    expect(payload.error?.category).toBe('NOT_FOUND');
    expect(casesRows().find((row) => row.id === 'c-ajeno')?.cycle_start_date).toBeNull();
  });

  it('un rol user tampoco escribe en un caso ajeno: 404 y nada escrito', async () => {
    seedCase({ id: 'c-ajeno', created_by: 'otro-usuario' });

    const { res } = await patchCase(
      { cycleStartDate: FECHA, cycleStartDateByName: 'Ana' },
      { query: { caseId: 'c-ajeno' }, auth: fakeAuthContext('user') },
    );

    expect(res.statusCode).toBe(404);
  });

  it('el alcance se resuelve ANTES de validar el cuerpo (un 400 confirmaría existencia)', async () => {
    seedCase({ id: 'c-ajeno', created_by: 'otro-usuario' });

    const { res } = await patchCase(
      { cycleStartDate: 'basura', cycleStartDateByName: '' },
      { query: { caseId: 'c-ajeno' }, auth: fakeAuthContext('coordinator') },
    );

    expect(res.statusCode).toBe(404);
  });

  it('un caso inexistente responde el mismo 404 que uno ajeno', async () => {
    const { res } = await patchCase(
      { cycleStartDate: FECHA, cycleStartDateByName: 'Ana' },
      { query: { caseId: 'c-inexistente' } },
    );

    expect(res.statusCode).toBe(404);
  });
});

// ------------------------------------------------------------------ persistencia

describe('PATCH /api/cases/:id · guardar la fecha con autor y hora', () => {
  it('escribe la fecha, el autor de la sesión, el nombre y la marca de tiempo', async () => {
    seedCase();

    const { res, payload } = await patchCase({ cycleStartDate: FECHA, cycleStartDateByName: 'Ana' });

    expect(res.statusCode).toBe(200);
    expect(payload.case?.cycleStartDate).toBe(FECHA);
    expect(payload.case?.cycleStartDateByName).toBe('Ana');
    // La hora la pone el servidor: es una marca de auditoría, no un dato del
    // cliente. Solo se comprueba que es un ISO reciente.
    expect(typeof payload.case?.cycleStartDateAt).toBe('string');
    expect(Number.isNaN(Date.parse(payload.case?.cycleStartDateAt ?? ''))).toBe(false);

    const row = casesRows()[0];
    expect(row?.cycle_start_date).toBe(FECHA);
    // El autor real es el uuid de la sesión, no el nombre escrito.
    expect(row?.cycle_start_date_by).toBe(FAKE_USER_SUB);
    expect(row?.cycle_start_date_by_name).toBe('Ana');
    expect(typeof row?.cycle_start_date_at).toBe('string');
  });

  it('el autor es quien escribe, no quien está en el cuerpo', async () => {
    seedCase({ id: 'c-1' });
    seedCase({ id: 'c-2', created_by: 'otro-usuario' });

    await patchCase(
      { cycleStartDate: FECHA, cycleStartDateByName: 'Ana' },
      { query: { caseId: 'c-1' }, auth: fakeAuthContext('user') },
    );

    expect(casesRows().find((row) => row.id === 'c-1')?.cycle_start_date_by).toBe(FAKE_USER_SUB);
  });

  it('no toca otros campos del caso', async () => {
    seedCase();

    const { res } = await patchCase({ cycleStartDate: FECHA, cycleStartDateByName: 'Ana' });

    expect(res.statusCode).toBe(200);
    const row = casesRows()[0];
    expect(row?.status).toBe('COMPLETED');
    expect(row?.student_identifier).toBe('UTEL-2026-001');
    expect(row?.created_by).toBe(FAKE_USER_SUB);
  });

  it('escribe SOLO en el caso pedido: otro caso tuyo no se toca', async () => {
    // El alcance del UPDATE (`.eq('id', caseId)`) es lo que impide que la fecha
    // capturada en un caso se proyecte a todos los casos del mismo dueño. Sin
    // este filtro, la fila del otro caso también habría quedado con fecha,
    // autor y hora, y no habría forma de notarlo.
    seedCase({ id: 'c-1' });
    seedCase({ id: 'c-2' });

    const { res } = await patchCase(
      { cycleStartDate: FECHA, cycleStartDateByName: 'Ana' },
      { query: { caseId: 'c-1' } },
    );

    expect(res.statusCode).toBe(200);
    const escrito = casesRows().find((row) => row.id === 'c-1');
    const intacto = casesRows().find((row) => row.id === 'c-2');
    expect(escrito?.cycle_start_date).toBe(FECHA);
    expect(escrito?.cycle_start_date_by).toBe(FAKE_USER_SUB);
    expect(intacto?.cycle_start_date).toBeNull();
    expect(intacto?.cycle_start_date_by).toBeNull();
    expect(intacto?.cycle_start_date_at).toBeNull();
    expect(intacto?.cycle_start_date_by_name).toBeNull();
  });

  it('escribir dos veces pisa fecha, autor y nombre, y NO duplica nada', async () => {
    // Guardar es un UPSERT sobre la fila del caso: no hay tabla de histórico y
    // la fila del caso es una sola. Es el caso de uso real de "corregí la
    // fecha": la segunda escritura replaces la primera, no la convive.
    seedCase();

    await patchCase({ cycleStartDate: FECHA, cycleStartDateByName: 'Ana' });
    const { res, payload } = await patchCase({ cycleStartDate: '2026-09-01', cycleStartDateByName: 'Luis' });

    expect(res.statusCode).toBe(200);
    // Una sola fila: no puede quedar la anterior con otra fecha y otro autor.
    expect(casesRows()).toHaveLength(1);
    const row = casesRows()[0];
    expect(row?.cycle_start_date).toBe('2026-09-01');
    expect(row?.cycle_start_date_by).toBe(FAKE_USER_SUB);
    expect(row?.cycle_start_date_by_name).toBe('Luis');
    expect(payload.case?.cycleStartDate).toBe('2026-09-01');
    expect(payload.case?.cycleStartDateByName).toBe('Luis');
  });

  it('la fecha capturada no reinterpretada un dictamen ya emitido', async () => {
    // PROJECTION_IS_NOT_THE_DICTAMEN: el PATCH solo escribe columnas del caso.
    // No hay `audits` que tocar.
    seedCase();

    await patchCase({ cycleStartDate: FECHA, cycleStartDateByName: 'Ana' });

    expect(db.rows('audits')).toHaveLength(0);
  });
});

// -------------------------------------------------------------------- métodos

describe('/api/cases/:id · métodos consolidados en una Function', () => {
  it('un método no admitido responde 405 con el Allow correcto', async () => {
    seedCase();

    const res = makeApiResponse();
    await caseHandler(makeApiRequest({ method: 'POST', body: {} }), res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET, PATCH, DELETE');
  });

  it('GET sigue funcionando: la ruta no se rompió al añadir PATCH', async () => {
    seedCase();

    const res = makeApiResponse();
    await caseHandler(makeApiRequest({ method: 'GET' }), res);

    expect(res.statusCode).toBe(200);
  });
});

describe('PATCH y DELETE administrativos en /api/cases/:id', () => {
  it('solo la capacidad de Gerencia puede clasificar el caso como prueba', async () => {
    seedCase({ status: 'DRAFT' });
    const denied = await patchCase({ isTest: true });
    expect(denied.res.statusCode).toBe(403);
    expect(casesRows()[0]?.is_test).toBeUndefined();

    const allowed = await patchCase({ isTest: true }, { auth: fakeAuthContext('manager') });
    expect(allowed.res.statusCode).toBe(200);
    expect(casesRows()[0]?.is_test).toBe(true);
  });

  it('borra borradores vacíos y bloquea los que ya tienen evidencia', async () => {
    seedCase({ status: 'DRAFT' });
    const emptyDraft = makeApiResponse();
    await caseHandler(makeApiRequest({ method: 'DELETE', body: { target: 'draft' }, auth: fakeAuthContext('manager') }), emptyDraft);
    expect(emptyDraft.statusCode).toBe(200);
    expect(casesRows()).toHaveLength(0);

    seedCase({ id: 'case-with-evidence', status: 'DRAFT' });
    db.seed('evidence', { id: 'evidence-1', case_id: 'case-with-evidence' });
    const protectedDraft = makeApiResponse();
    await caseHandler(makeApiRequest({ method: 'DELETE', query: { caseId: 'case-with-evidence' }, body: { target: 'draft' }, auth: fakeAuthContext('manager') }), protectedDraft);
    expect(protectedDraft.statusCode).toBe(409);
    expect(casesRows()).toHaveLength(1);
  });

  it('borra un dictamen sin revisión y conserva los dictámenes revisados', async () => {
    seedCase();
    db.seed('audits', { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', case_id: 'case-1', status: 'COMPLETED' });
    db.seed('evidence', { id: 'evidence-1', case_id: 'case-1', storage_path: 'case-1/file-1' });
    const deleted = makeApiResponse();
    await caseHandler(makeApiRequest({ method: 'DELETE', body: { target: 'audit', auditId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, auth: fakeAuthContext('manager') }), deleted);
    expect(deleted.statusCode).toBe(200);
    expect(db.rows('audits')).toHaveLength(0);
    expect(db.rows('evidence')).toHaveLength(0);
    expect(db.removedStoragePaths).toEqual(['case-1/file-1']);
    expect(casesRows()[0]?.status).toBe('DRAFT');

    db.seed('audits', { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', case_id: 'case-1', status: 'COMPLETED' });
    db.seed('case_reviews', { id: 'review-1', audit_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    const protectedAudit = makeApiResponse();
    await caseHandler(makeApiRequest({ method: 'DELETE', body: { target: 'audit', auditId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, auth: fakeAuthContext('manager') }), protectedAudit);
    expect(protectedAudit.statusCode).toBe(409);
    expect(db.rows('audits')).toHaveLength(1);
  });

  it('Asesor no puede borrar aunque tenga el caso propio', async () => {
    seedCase({ status: 'DRAFT' });
    const res = makeApiResponse();
    await caseHandler(makeApiRequest({ method: 'DELETE', body: { target: 'draft' }, auth: fakeAuthContext('user') }), res);
    expect(res.statusCode).toBe(403);
    expect(casesRows()).toHaveLength(1);
  });
});

// ------------------------------------------------------------------- privacidad

/**
 * Lo que la interfaz puede ver de la captura, y lo que no.
 *
 * `cycle_start_date_by` es el AUTOR REAL y es dato interno con sello de
 * auditoría: sirve para auditar quién escribió, no para mostrarse. Publicarlo
 * convertiría un identificador de identidad en un dato de pantalla, y la
 * vista de procedencia ya la da `cycleStartDateByName` (el texto que la persona
 * escribió, igual que `reviewerName` en la revisión humana).
 *
 * Por eso `CaseDetailDto` expone fecha, nombre y hora, y NADA más: el uuid se
 * queda en la base.
 */
describe('procedencia de la fecha · lo interno no sale al cliente', () => {
  it('el PATCH responde con la fecha, el nombre y la hora, y no con el autor', async () => {
    seedCase();

    const { res } = await patchCase({ cycleStartDate: FECHA, cycleStartDateByName: 'Ana' });

    expect(res.statusCode).toBe(200);
    const body = res.body;
    // El sub del usuario es lo que se guardó en la base: no debe viajar.
    expect(body).not.toContain(FAKE_USER_SUB);
    // Tampoco debe existir una propiedad que lo exponga con otro nombre.
    const payload = JSON.parse(body) as { case: Record<string, unknown> };
    expect(payload.case).not.toHaveProperty('cycleStartDateBy');
    expect(Object.keys(payload.case).sort()).toEqual(
      expect.arrayContaining(['cycleStartDate', 'cycleStartDateByName', 'cycleStartDateAt']),
    );
    // Y el DTO del caso no arrastra metadata técnica del proveedor: la captura
    // es un dato del caso, no una auditoría.
    expect(body).not.toContain('provider_metadata');
    expect(body).not.toContain('providerMetadata');
  });

  it('el GET tampoco expone el autor, ni la marca de captura se cuela como auditoría', async () => {
    seedCase({ cycle_start_date: FECHA, cycle_start_date_by: FAKE_USER_SUB, cycle_start_date_by_name: 'Ana', cycle_start_date_at: '2026-08-21T12:00:00.000Z' });

    const res = makeApiResponse();
    await caseHandler(makeApiRequest({ method: 'GET' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(FAKE_USER_SUB);
    const payload = JSON.parse(res.body) as { case: Record<string, unknown> };
    expect(payload.case).not.toHaveProperty('cycleStartDateBy');
    expect(payload.case.cycleStartDate).toBe(FECHA);
    expect(payload.case.cycleStartDateByName).toBe('Ana');
    expect(payload.case.cycleStartDateAt).toBe('2026-08-21T12:00:00.000Z');
  });

  it('un caso sin fecha capturada expone null en los tres, no undefined', async () => {
    // `undefined` y `null` no son lo mismo para la interfaz: con `undefined` un
    // `?? null` en el consumidor escondería "nadie la capturó" detrás de un
    // campo ausente. El DTO los publica siempre.
    seedCase();

    const res = makeApiResponse();
    await caseHandler(makeApiRequest({ method: 'GET' }), res);

    const payload = JSON.parse(res.body) as { case: Record<string, unknown> };
    expect(payload.case.cycleStartDate).toBeNull();
    expect(payload.case.cycleStartDateByName).toBeNull();
    expect(payload.case.cycleStartDateAt).toBeNull();
  });

  it('sin captura, la marca de tiempo es null y NO la fecha de una migración', async () => {
    // Contrato que sostiene la migración: `cycle_start_date_at` NO lleva
    // `DEFAULT now()`. En PostgreSQL un DEFAULT no-VOLATILE en `ADD COLUMN` no
    // reescribe la tabla, así que las filas preexistentes leerían el default al
    // ser leídas: todos los casos ya existentes aparecerían "capturados" en la
    // fecha en que se aplicó la migración. El DTO publicaría esa procedencia
    // inventada como si fuera real.
    //
    // Aquí se comprueba el efecto observable en servidor: una fila sin captura
    // devuelve `null` en los tres campos, nunca una fecha. El default, si
    // estuviera en la base, ni se vería en este test (el fake no aplica
    // defaults), pero lo que sí queda fijado es que el DTO no inventa el valor
    // ni lo rellena.
    seedCase();

    const res = makeApiResponse();
    await caseHandler(makeApiRequest({ method: 'GET' }), res);

    const payload = JSON.parse(res.body) as { case: Record<string, unknown> };
    expect(payload.case.cycleStartDate).toBeNull();
    expect(payload.case.cycleStartDateByName).toBeNull();
    expect(payload.case.cycleStartDateAt).toBeNull();
    // Y el texto de la respuesta no contiene ninguna fecha suelta que alguien
    // pudiera confundir con una captura.
    expect(res.body).not.toMatch(/cycleStartDateAt":"\d{4}-/);
  });

  it('tras capturar, la marca de tiempo es la del servidor y no la que venga en el cuerpo', async () => {
    // El `.strict()` del schema ya impide mandar `cycleStartDateAt`, pero el
    // segundo requisito es que el valor guardado sea el del reloj del servidor.
    seedCase();

    await patchCase({ cycleStartDate: FECHA, cycleStartDateByName: 'Ana' });

    const row = casesRows()[0];
    const saved = row?.cycle_start_date_at as string;
    expect(typeof saved).toBe('string');
    // Cuenta con la hora, no es una fecha desnuda: es un instante.
    expect(saved).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isNaN(Date.parse(saved))).toBe(false);
  });
});
