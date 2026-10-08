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
//      `PATCH` de `GET`. Por eso el `Allow` dice `GET, PATCH`.
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

describe('PATCH /api/cases/:id · no gasta una Function', () => {
  it('un método que no es GET ni PATCH responde 405 con el Allow correcto', async () => {
    seedCase();

    const res = makeApiResponse();
    await caseHandler(makeApiRequest({ method: 'DELETE', body: {} }), res);

    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('GET, PATCH');
  });

  it('GET sigue funcionando: la ruta no se rompió al añadir PATCH', async () => {
    seedCase();

    const res = makeApiResponse();
    await caseHandler(makeApiRequest({ method: 'GET' }), res);

    expect(res.statusCode).toBe(200);
  });
});