// @vitest-environment jsdom
// =============================================================================
// Alta de caso: evidencia obligatoria + notas de Back Office / HelpDesk.
//
// Lo que fija (plan 2026-10-08, Fase 2):
//
//   2.1 Sin archivos seleccionados, el alta no llama al servidor.
//   2.2 Con archivos seleccionados, el alta dispara `POST /api/cases`.
//   2.3 Con al menos una evidencia subida, navega a `#/casos/:id`.
//   2.4 Si TODAS las subidas fallan, no navega y permite reintentar SIN
//       volver a crear el caso.
//   2.5 Éxito parcial: completa el flujo, informa cuáles fallaron y no vuelve
//       a subir los ya exitosos.
//   2.6 Error de creación conserva el formulario y los archivos.
//   2.7 Las notas de ambas áreas se guardan asociadas al caso nuevo (y guardar
//       notas NO dispara auditoría).
//   2.8 Notas vacías no bloquean ni ensucian el alta.
//   2.9 Error al guardar notas: estado separado, reintento solo de notas.
//
// El servidor se simula con `fetch`: se ejercita el cliente real de `api.ts`,
// que es donde viven el trim, el `x-file-name` y la espera del cuerpo binario.
// =============================================================================

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewCasePanel } from '../src/components/NewCasePanel';
import type { AreaComment, AreaCommentArea, CaseSummary, Evidence } from '../src/lib/api';

// -----------------------------------------------------------------------------
// Dobles de la API
// -----------------------------------------------------------------------------

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function caseDto(id: string, studentIdentifier: string | null = '202312345'): CaseSummary {
  return {
    id,
    status: 'DRAFT',
    studentIdentifier,
    evidenceCount: 0,
    createdAt: '2026-10-08T10:00:00.000Z',
    updatedAt: '2026-10-08T10:00:00.000Z',
  };
}

function evidenceDto(caseId: string, filename: string): Evidence {
  return {
    id: `ev-${filename}`,
    caseId,
    filename,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    hash: 'abc123',
    storagePath: `${caseId}/${filename}`,
    processingStatus: 'UPLOADED',
    processingError: null,
    transcript: null,
    createdAt: '2026-10-08T10:00:01.000Z',
  };
}

function commentDto(caseId: string, area: string, comment: string): AreaComment {
  return {
    id: `c-${area}`,
    caseId,
    area: area as AreaCommentArea,
    comment,
    createdAt: '2026-10-08T10:00:02.000Z',
    updatedAt: '2026-10-08T10:00:02.000Z',
  };
}

interface StubReply {
  status: number;
  body: unknown;
}

interface StubOptions {
  create?: () => StubReply;
  evidence?: (filename: string) => StubReply;
  comment?: (payload: { area: string; comment: string }) => StubReply;
}

interface RecordedCall {
  url: string;
  method: string;
  /** Nombre del archivo decodificado de `x-file-name`, si la petición lo trajo. */
  filename: string | null;
  /** Cuerpo JSON (solo en peticiones con body de texto). */
  payload: string | null;
}

/**
 * Simula las tres rutas que usa el alta y registra cada llamada para poder
 * afirmar sobre el ORDEN y sobre lo que NO se repitió.
 */
function stubApp(options: StubOptions = {}): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const headers = new Headers((init?.headers ?? {}) as HeadersInit);
      const rawName = headers.get('x-file-name');
      const filename = rawName === null ? null : decodeURIComponent(rawName);
      const payload = typeof init?.body === 'string' ? init.body : null;
      calls.push({ url, method, filename, payload });

      if (url === '/api/cases' && method === 'POST') {
        const reply = options.create?.() ?? { status: 201, body: { case: caseDto('case-1') } };
        return json(reply.status, reply.body);
      }
      if (url.endsWith('/evidence') && method === 'POST') {
        const caseId = url.split('/')[3] ?? 'case-1';
        const name = filename ?? 'sin-nombre';
        const reply = options.evidence?.(name) ?? { status: 201, body: { evidence: evidenceDto(caseId, name) } };
        return json(reply.status, reply.body);
      }
      if (url.endsWith('/area-comments') && method === 'POST') {
        const body = JSON.parse(payload ?? '{}') as { area: string; comment: string };
        const caseId = url.split('/')[3] ?? 'case-1';
        const reply =
          options.comment?.(body) ??
          { status: 201, body: { comment: commentDto(caseId, body.area, body.comment) } };
        return json(reply.status, reply.body);
      }
      if (url.endsWith('/area-comments')) return json(200, { comments: [] });
      return json(404, { error: { category: 'NOT_FOUND', message: 'Ruta no simulada.' } });
    }),
  );
  return calls;
}

const SERVER_ERROR = { status: 500, body: { error: { category: 'INTERNAL', message: 'Fallo del servidor.' } } };
const FILE_ERROR = { status: 400, body: { error: { category: 'VALIDATION', message: 'Formato no admitido.' } } };

// -----------------------------------------------------------------------------
// Utilidades de interacción
// -----------------------------------------------------------------------------

async function selectEvidence(...names: string[]): Promise<void> {
  const input = screen.getByLabelText(/archivos de evidencia/i, { selector: 'input[type="file"]' });
  const files = names.map((name) => new File(['contenido'], name, { type: 'application/pdf' }));
  await userEvent.upload(input, files);
}

async function submitCase(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: /crear y abrir expediente/i }));
}

async function fillNote(area: AreaCommentArea, text: string): Promise<void> {
  const box = screen.getByLabelText(new RegExp(area === 'BACK_OFFICE' ? 'Back Office' : 'HelpDesk', 'i'));
  // `userEvent.type` rechaza la cadena vacía: para dejarla en blanco basta con
  // limpiar el campo.
  if (text === '') {
    await userEvent.clear(box);
    return;
  }
  await userEvent.clear(box);
  await userEvent.type(box, text);
}

function currentHash(): string {
  return window.location.hash;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
  // La vista previa local se activa por `?preview=dashboard`: se limpia entre
  // tests para que no se filtre a los que esperan el formulario productivo.
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
});

// -----------------------------------------------------------------------------
// 2.1 y 2.2 — la exigencia de evidencia
// -----------------------------------------------------------------------------

describe('NewCasePanel · alta con evidencia obligatoria', () => {
  it('2.1 sin archivos seleccionados no da de alta el caso ni llama al servidor', async () => {
    const calls = stubApp();
    render(<NewCasePanel />);

    const submit = screen.getByRole('button', { name: /crear y abrir expediente/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/selecciona al menos un archivo de evidencia/i)).toBeTruthy();

    await userEvent.click(submit);

    expect(calls).toHaveLength(0);
    expect(currentHash()).toBe('');
  });

  it('2.2 con archivos seleccionados dispara createCase con el identificador capturado', async () => {
    const calls = stubApp();
    render(<NewCasePanel />);

    await userEvent.type(screen.getByLabelText(/matrícula o identificador/i), '202312345');
    await selectEvidence('convocatoria.pdf');
    await submitCase();

    await waitFor(() => {
      expect(calls.some((call) => call.url === '/api/cases' && call.method === 'POST')).toBe(true);
    });
    const create = calls.find((call) => call.url === '/api/cases' && call.method === 'POST');
    expect(create?.payload).toContain('202312345');
  });
});

// -----------------------------------------------------------------------------
// 2.3 a 2.6 — la subida de evidencias
// -----------------------------------------------------------------------------

describe('NewCasePanel · subida de evidencias', () => {
  it('2.3 sube la evidencia y navega al expediente nuevo', async () => {
    const calls = stubApp();
    render(<NewCasePanel />);

    await selectEvidence('convocatoria.pdf');
    await submitCase();

    await waitFor(() => {
      expect(currentHash()).toBe('#/casos/case-1');
    });
    // El orden del plan: primero se crea la fila, después se sube la evidencia.
    const createIndex = calls.findIndex((call) => call.url === '/api/cases' && call.method === 'POST');
    const evidenceIndex = calls.findIndex((call) => call.url.endsWith('/evidence') && call.method === 'POST');
    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(evidenceIndex).toBeGreaterThan(createIndex);
    expect(calls[evidenceIndex]?.filename).toBe('convocatoria.pdf');
  });

  it('2.3b sube varios archivos de forma secuencial (uno por petición)', async () => {
    const inFlight: string[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    stubApp();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        if (url.endsWith('/evidence')) {
          const name = decodeURIComponent(new Headers((init?.headers ?? {}) as HeadersInit).get('x-file-name') ?? '');
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          inFlight.push(name);
          await new Promise((resolve) => setTimeout(resolve, 5));
          concurrent -= 1;
          return json(201, { evidence: evidenceDto('case-1', name) });
        }
        if (url === '/api/cases') return json(201, { case: caseDto('case-1') });
        if (url.endsWith('/area-comments')) return json(200, { comments: [] });
        return json(404, { error: { category: 'NOT_FOUND', message: 'Ruta no simulada.' } });
      }),
    );

    render(<NewCasePanel />);
    await selectEvidence('a.pdf', 'b.pdf', 'c.pdf');
    await submitCase();

    await waitFor(() => {
      expect(currentHash()).toBe('#/casos/case-1');
    });
    expect(inFlight).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    expect(maxConcurrent).toBe(1);
  });

  it('2.4 si todas las subidas fallan no navega y reintenta SIN volver a crear el caso', async () => {
    let attempts = 0;
    const calls = stubApp({
      evidence: (name) => {
        attempts += 1;
        // El primer intento falla; el reintento sí sube.
        return attempts === 1 ? FILE_ERROR : { status: 201, body: { evidence: evidenceDto('case-1', name) } };
      },
    });
    render(<NewCasePanel />);

    await selectEvidence('convocatoria.pdf');
    await submitCase();

    // No navega y el alta NO se presenta como exitosa.
    const retry = await screen.findByRole('button', { name: /reintentar/i });
    expect(currentHash()).toBe('');
    expect(screen.getByText(/archivos sin subir/i)).toBeTruthy();

    await userEvent.click(retry);

    await waitFor(() => {
      expect(currentHash()).toBe('#/casos/case-1');
    });
    // El reintento NO vuelve a crear el caso: una sola fila en la base.
    expect(calls.filter((call) => call.url === '/api/cases' && call.method === 'POST')).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith('/evidence'))).toHaveLength(2);
  });

  // REGRESIÓN (revisión 2026-10-08): con un `or` exclusivo entre `items` y
  // `pendingFiles`, un archivo añadido tras un fallo total quedaba INVISIBLE
  // (ganaba `items`) y los fallidos desaparecían al navegar sin reintentarse.
  // La lista, el envío y el estado tienen que coincidir siempre.
  it('2.4b tras un fallo total el archivo nuevo se ve y se sube solo él', async () => {
    const calls = stubApp({
      evidence: (name) =>
        name === 'nuevo.pdf' ? { status: 201, body: { evidence: evidenceDto('case-1', name) } } : FILE_ERROR,
    });
    render(<NewCasePanel />);

    await selectEvidence('a.pdf', 'b.pdf');
    await submitCase();

    // Fallo total: no navega, los dos fallidos quedan listados con su error.
    await screen.findByRole('button', { name: /reintentar carga/i });
    expect(currentHash()).toBe('');
    expect(screen.getByText('a.pdf')).toBeTruthy();
    expect(screen.getByText('b.pdf')).toBeTruthy();

    // El archivo nuevo debe APARECER, conviviendo con los fallidos.
    await selectEvidence('nuevo.pdf');
    expect(screen.getByText('nuevo.pdf')).toBeTruthy();
    expect(screen.getByText('a.pdf')).toBeTruthy();
    expect(screen.getByText('b.pdf')).toBeTruthy();

    await submitCase();

    await waitFor(() => {
      expect(currentHash()).toBe('#/casos/case-1');
    });
    // Solo se envía el nuevo. Los fallidos NO se reintentan por su cuenta: para
    // eso está el botón "Reintentar carga".
    expect(calls.filter((call) => call.url.endsWith('/evidence')).map((call) => call.filename)).toEqual([
      'a.pdf',
      'b.pdf',
      'nuevo.pdf',
    ]);
    // Un archivo que YA subió con éxito jamás se vuelve a enviar.
    expect(calls.filter((call) => call.url === '/api/cases' && call.method === 'POST')).toHaveLength(1);
  });

  it('2.4c quitar una fila tras un fallo total quita el archivo correcto', async () => {
    stubApp({ evidence: () => FILE_ERROR });
    render(<NewCasePanel />);

    await selectEvidence('a.pdf', 'b.pdf');
    await submitCase();
    await screen.findByRole('button', { name: /reintentar carga/i });

    await selectEvidence('nuevo.pdf');
    await userEvent.click(screen.getByRole('button', { name: /quitar nuevo\.pdf/i }));

    // Se quita el NUEVO (el pendiente), no un fallido: los errores siguen ahí.
    expect(screen.queryByText('nuevo.pdf')).toBeNull();
    expect(screen.getByText('a.pdf')).toBeTruthy();
    expect(screen.getByText('b.pdf')).toBeTruthy();
  });

  // REGRESIÓN (revisión 2, 2026-10-08): la clave se componía con
  // `current.length + offset`. Quitar una fila BAJA la longitud del array, así que
  // la siguiente adición reutilizaba una clave viva y `handleRemove` (que filtra
  // por clave) borraba dos archivos de una vez. La clave debe venir de un
  // contador monótono, como el `sequence` de `useEvidenceUpload`.
  // Con `uploadFailed = entries.every(error)`, añadir un pendienteaba la tarjeta
  // "Reintentar carga" y los fallidos se irían sin subir al navegar sin aviso.
  it('2.4f el reintento sigue visible si queda algún fallido junto a un pendiente', async () => {
    stubApp({ evidence: () => FILE_ERROR });
    render(<NewCasePanel />);

    await selectEvidence('a.pdf', 'b.pdf');
    await submitCase();
    await screen.findByRole('button', { name: /reintentar carga/i });

    await selectEvidence('nuevo.pdf');

    // Sigue habiendo algo sin subir: la acción de reintentar NO desaparece.
    expect(screen.getByRole('button', { name: /reintentar carga/i })).toBeTruthy();
    expect(screen.getByText(/archivos sin subir/i)).toBeTruthy();
    // El contador separa lo que va a enviar de lo que quedó atrás.
    expect(screen.getByText(/1 por enviar · 2 sin subir\./)).toBeTruthy();
    // Los fallidos siguen listados: no se pierden de vista.
    expect(screen.getByText('a.pdf')).toBeTruthy();
    expect(screen.getByText('b.pdf')).toBeTruthy();
    expect(screen.getByText('nuevo.pdf')).toBeTruthy();
  });

  it('2.4e quitar filas no borra el archivo que sigue visible', async () => {
    stubApp();
    render(<NewCasePanel />);

    await selectEvidence('a.pdf', 'b.pdf');
    expect(screen.getByText('a.pdf')).toBeTruthy();
    expect(screen.getByText('b.pdf')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /quitar a\.pdf/i }));
    expect(screen.queryByText('a.pdf')).toBeNull();
    expect(screen.getByText('b.pdf')).toBeTruthy();

    // La longitud del array bajó a 1: con clave por longitud, `c.pdf` heredaría
    // la clave de `b.pdf`.
    await selectEvidence('c.pdf');
    expect(screen.getByText('b.pdf')).toBeTruthy();
    expect(screen.getByText('c.pdf')).toBeTruthy();

    // Quitar la fila visible deja al otro INTACTO: no se pierde en silencio.
    await userEvent.click(screen.getByRole('button', { name: /quitar b\.pdf/i }));
    expect(screen.queryByText('b.pdf')).toBeNull();
    expect(screen.getByText('c.pdf')).toBeTruthy();
  });

  it('2.4d sin archivos pendientes de subir el alta no se presenta como exitosa', async () => {
    const calls = stubApp({ evidence: () => FILE_ERROR });
    render(<NewCasePanel />);

    await selectEvidence('a.pdf');
    await submitCase();
    await screen.findByRole('button', { name: /reintentar carga/i });

    // Mientras quede un fallido en la lista, el alta NO se presenta como
    // exitosa: sigue el error a la vista y el envío lo trata como pendiente.
    expect(screen.getByText(/archivos sin subir/i)).toBeTruthy();
    expect(screen.getByText('a.pdf')).toBeTruthy();

    // Se quita el último: ya no hay nada que enviar y no se navega.
    await userEvent.click(screen.getByRole('button', { name: /quitar a\.pdf/i }));
    expect((screen.getByRole('button', { name: /crear y abrir expediente/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/selecciona al menos un archivo de evidencia/i)).toBeTruthy();
    expect(currentHash()).toBe('');
    expect(calls.filter((call) => call.url === '/api/cases' && call.method === 'POST')).toHaveLength(1);
  });

  it('2.5 éxito parcial completa el flujo e informa cuáles fallaron sin resubir los exitosos', async () => {
    const calls = stubApp({
      evidence: (name) =>
        name === 'malo.pdf'
          ? FILE_ERROR
          : { status: 201, body: { evidence: evidenceDto('case-1', name) } },
    });
    render(<NewCasePanel />);

    await selectEvidence('bueno.pdf', 'malo.pdf');
    await submitCase();

    // Al menos una subió: el flujo se completa y navega.
    await waitFor(() => {
      expect(currentHash()).toBe('#/casos/case-1');
    });
    expect(calls.filter((call) => call.url === '/api/cases' && call.method === 'POST')).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith('/evidence')).map((call) => call.filename).sort()).toEqual([
      'bueno.pdf',
      'malo.pdf',
    ]);
  });

  // El nombre antigo decía "al reintentar", pero este test no reintenta nada:
  // navega tras el éxito parcial y comprueba que el exitoso SALE de la lista.
  it('2.5b el archivo exitoso sale de la lista y el fallido se anuncia', async () => {
    let badAttempts = 0;
    const calls = stubApp({
      evidence: (name) => {
        if (name !== 'malo.pdf') return { status: 201, body: { evidence: evidenceDto('case-1', name) } };
        badAttempts += 1;
        return badAttempts === 1 ? FILE_ERROR : { status: 201, body: { evidence: evidenceDto('case-1', name) } };
      },
    });
    render(<NewCasePanel />);

    await selectEvidence('bueno.pdf', 'malo.pdf');
    await submitCase();

    // Paso 3.4: con al menos una subida correcta, el alta se completa.
    await waitFor(() => {
      expect(currentHash()).toBe('#/casos/case-1');
    });
    // Y el lote se informa archivo por archivo: el que subió y el que falló.
    const region = screen.getByRole('status');
    expect(region.textContent).toContain('1 de 2');
    expect(region.textContent).toContain('malo.pdf');
    // INVARIANTE: un archivo que subió con éxito SALE de la lista. Es lo que
    // impide que se reenvíe en un lote posterior; sin esta aserción solo se
    // infería del conteo de llamadas.
    expect(screen.queryByText('bueno.pdf')).toBeNull();
    // El fallido, en cambio, sigue listado y reintentable desde el expediente.
    expect(screen.getByText('malo.pdf')).toBeTruthy();
    // Y se envió una sola vez por archivo.
    expect(calls.filter((call) => call.url.endsWith('/evidence')).map((call) => call.filename)).toEqual([
      'bueno.pdf',
      'malo.pdf',
    ]);
    expect(calls.filter((call) => call.url === '/api/cases' && call.method === 'POST')).toHaveLength(1);
  });

  it('2.5c tras un fallo total el reintento no recrea el caso ni reenvía lo ya exitoso', async () => {
    let goodAttempts = 0;
    const calls = stubApp({
      evidence: (name) => {
        if (name === 'bueno.pdf') {
          goodAttempts += 1;
          // El primero sí sube: es el "exitoso" que nunca debe repetirse.
          if (goodAttempts === 1) return { status: 201, body: { evidence: evidenceDto('case-1', name) } };
          return FILE_ERROR;
        }
        // El otro falla siempre: es el que se reintenta.
        return FILE_ERROR;
      },
    });
    render(<NewCasePanel />);

    await selectEvidence('bueno.pdf', 'malo.pdf');
    await submitCase();

    // Un archivo subió: se completa el flujo y se navega (Paso 3.4).
    await waitFor(() => {
      expect(currentHash()).toBe('#/casos/case-1');
    });
    const uploaded = calls.filter((call) => call.url.endsWith('/evidence')).map((call) => call.filename);
    expect(uploaded).toEqual(['bueno.pdf', 'malo.pdf']);
    expect(calls.filter((call) => call.url === '/api/cases' && call.method === 'POST')).toHaveLength(1);
    // El lote se informa archivo por archivo.
    const region = screen.getByRole('status');
    expect(region.textContent).toContain('1 de 2');
    expect(region.textContent).toContain('malo.pdf');
  });

  it('2.6 error de creación conserva el formulario y los archivos seleccionados', async () => {
    const calls = stubApp({ create: () => SERVER_ERROR });
    render(<NewCasePanel />);

    await userEvent.type(screen.getByLabelText(/matrícula o identificador/i), '202312345');
    await selectEvidence('convocatoria.pdf');
    await submitCase();

    expect(await screen.findByText(/fallo del servidor/i)).toBeTruthy();
    // Nada se navega, nada se subió y todo sigue en el formulario.
    expect(currentHash()).toBe('');
    expect(calls.filter((call) => call.url.endsWith('/evidence'))).toHaveLength(0);
    expect((screen.getByLabelText(/matrícula o identificador/i) as HTMLInputElement).value).toBe('202312345');
    expect(screen.getByText('convocatoria.pdf')).toBeTruthy();
    // Se puede reintentar el alta sin perder lo capturado.
    expect((screen.getByRole('button', { name: /crear y abrir expediente/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// 2.7 a 2.9 — las notas de Back Office y HelpDesk
// -----------------------------------------------------------------------------

describe('NewCasePanel · notas de Back Office y HelpDesk', () => {
  it('2.7 guarda las notas de ambas áreas asociadas al caso nuevo', async () => {
    const calls = stubApp();
    render(<NewCasePanel />);

    await selectEvidence('convocatoria.pdf');
    await fillNote('BACK_OFFICE', 'Se aceptó la cancelación en ventanilla');
    await fillNote('HELPDESK', 'El alumno pidió baja el lunes');
    await submitCase();

    await waitFor(() => {
      expect(currentHash()).toBe('#/casos/case-1');
    });

    const posts = calls.filter((call) => call.url === '/api/cases/case-1/area-comments' && call.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0]?.payload).toContain('BACK_OFFICE');
    expect(posts[0]?.payload).toContain('ventanilla');
    expect(posts[1]?.payload).toContain('HELPDESK');
    expect(posts[1]?.payload).toContain('pidió baja');

    // Orden del plan: evidencia antes que notas.
    const lastEvidence = calls.findLastIndex((call) => call.url.endsWith('/evidence'));
    const firstNote = calls.findIndex((call) => call.url.endsWith('/area-comments') && call.method === 'POST');
    expect(lastEvidence).toBeLessThan(firstNote);

    // Guardar notas NUNCA dispara una auditoría.
    expect(calls.some((call) => call.url.endsWith('/audit'))).toBe(false);
  });

  it('2.8 notas vacías no bloquean el alta ni generan peticiones de comentarios', async () => {
    const calls = stubApp();
    render(<NewCasePanel />);

    await selectEvidence('convocatoria.pdf');
    // Escribir y borrar deja la nota en blanco: es el caso "sin nota".
    await fillNote('BACK_OFFICE', 'xyz');
    await fillNote('BACK_OFFICE', '');
    await fillNote('HELPDESK', '   ');
    await submitCase();

    await waitFor(() => {
      expect(currentHash()).toBe('#/casos/case-1');
    });
    expect(calls.filter((call) => call.url.endsWith('/area-comments') && call.method === 'POST')).toHaveLength(0);
  });

  it('2.9 error al guardar notas se muestra separado y no pierde la subida exitosa', async () => {
    let noteAttempts = 0;
    const calls = stubApp({
      comment: () => {
        noteAttempts += 1;
        return noteAttempts === 1 ? SERVER_ERROR : { status: 201, body: { comment: commentDto('case-1', 'BACK_OFFICE', 'nota') } };
      },
    });
    render(<NewCasePanel />);

    await selectEvidence('convocatoria.pdf');
    await fillNote('BACK_OFFICE', 'intento de contacto');
    await submitCase();

    // Caso y evidencia YA están creados: no se navega y no se rehace nada.
    expect(await screen.findByText(/no se pudieron guardar las notas/i)).toBeTruthy();
    expect(currentHash()).toBe('');
    expect(calls.filter((call) => call.url === '/api/cases' && call.method === 'POST')).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith('/evidence'))).toHaveLength(1);
    // El estado de la subida exitosa sigue a la vista en la región `aria-live`, pero
    // INVARIANTE: el archivo ya salió de la lista, así que el reintento de notas
    // no puede arrastrarlo a otra subida.
    expect(screen.getByRole('status').textContent).toContain('1 de 1');
    expect(screen.queryByText('convocatoria.pdf')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /reintentar notas/i }));

    await waitFor(() => {
      expect(currentHash()).toBe('#/casos/case-1');
    });
    // El reintento es SOLO de notas: ni caso nuevo ni evidencia repetida.
    expect(calls.filter((call) => call.url === '/api/cases' && call.method === 'POST')).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith('/evidence'))).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith('/area-comments') && call.method === 'POST')).toHaveLength(2);
  });

  it('conserva el fallo anterior cuando se añade otro archivo con el mismo nombre y tamaño', async () => {
    let evidenceAttempts = 0;
    const calls = stubApp({
      evidence: (name) => {
        evidenceAttempts += 1;
        return evidenceAttempts === 1
          ? FILE_ERROR
          : { status: 201, body: { evidence: evidenceDto('case-1', name) } };
      },
      comment: () => SERVER_ERROR,
    });
    render(<NewCasePanel />);

    const input = screen.getByLabelText(/archivos de evidencia/i, { selector: 'input[type="file"]' });
    await userEvent.upload(input, new File(['AAAA'], 'igual.pdf', { type: 'application/pdf' }));
    await submitCase();
    await screen.findByRole('button', { name: /reintentar carga/i });

    // Mismo nombre y tamaño, pero otro archivo pendiente de subir.
    await userEvent.upload(input, new File(['BBBB'], 'igual.pdf', { type: 'application/pdf' }));
    await fillNote('BACK_OFFICE', 'nota para que el formulario siga abierto');
    await submitCase();

    expect(await screen.findByText(/no se pudieron guardar las notas/i)).toBeTruthy();
    expect(calls.filter((call) => call.url.endsWith('/evidence'))).toHaveLength(2);
    // El segundo archivo se subió; el primero sigue fallido y reintentable.
    expect(screen.getByRole('button', { name: /reintentar carga/i })).toBeTruthy();
    expect(screen.getAllByText('igual.pdf')).toHaveLength(1);
  });

  // El servidor rechaza con 400 lo que pase de 4000 caracteres
  // (`AREA_COMMENT_MAX` en `src/server/area-comments.ts`). Sin esto, "Reintentar
  // notas" reenvía el mismo texto y el alta entra en bucle.
  it('2.10 el contador refleja el límite del servidor sin recortar en silencio', async () => {
    stubApp();
    render(<NewCasePanel />);

    await selectEvidence('convocatoria.pdf');
    const box = screen.getByLabelText('Back Office') as HTMLTextAreaElement;
    // Sin `maxLength`: el navegador NO recorta en silencio al pegar. El texto
    // llega entero y el contador lo hace visible, como en `AreaQuickComments`.
    expect(box.maxLength).toBe(-1);

    await userEvent.click(box);
    await userEvent.paste('a'.repeat(4000));
    expect(box.value.length).toBe(4000);
    expect(screen.getByText('4000/4000')).toBeTruthy();
    // 4000 es legal: el alta sigue habilitada.
    expect((screen.getByRole('button', { name: /crear y abrir expediente/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('2.10b si el texto excede el límite el alta se bloquea y avisa', async () => {
    const calls = stubApp();
    render(<NewCasePanel />);

    await selectEvidence('convocatoria.pdf');
    const box = screen.getByLabelText('Back Office');

    await userEvent.click(box);
    await userEvent.paste('a'.repeat(4001));

    // El texto NO se recorta: se avisa y el alta queda bloqueada.
    expect((box as HTMLTextAreaElement).value.length).toBe(4001);
    expect(await screen.findByText(/supera los 4000 caracteres/i)).toBeTruthy();
    // Sin esto "Reintentar notas" reenviaría el mismo texto en bucle.
    expect((screen.getByRole('button', { name: /crear y abrir expediente/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('2.10c el error de notas se anuncia desde los dos textareas', async () => {
    stubApp({
      comment: () => SERVER_ERROR,
    });
    render(<NewCasePanel />);

    await selectEvidence('convocatoria.pdf');
    await fillNote('BACK_OFFICE', 'nota');
    await submitCase();
    await screen.findByText(/no se pudieron guardar las notas/i);

    // Ambos controles enlazan el error: cualquiera puede ser el que hay que
    // corregir, y no se sabe cuál falló.
    for (const label of ['Back Office', 'HelpDesk']) {
      const describedBy = screen.getByLabelText(label).getAttribute('aria-describedby') ?? '';
      expect(describedBy.split(' ')).toContain(
        screen.getByText(/no se pudieron guardar las notas/i).closest('div[id]')?.id,
      );
    }
  });

  it('2.7b solo se guarda la nota cuyo texto no está en blanco', async () => {
    const calls = stubApp();
    render(<NewCasePanel />);

    await selectEvidence('convocatoria.pdf');
    await fillNote('HELPDESK', 'solo helpdesk escribió algo');
    await submitCase();

    await waitFor(() => {
      expect(currentHash()).toBe('#/casos/case-1');
    });
    const posts = calls.filter((call) => call.url.endsWith('/area-comments') && call.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.payload).toContain('HELPDESK');
  });
});

// -----------------------------------------------------------------------------
// Accesibilidad mínima (restricción global del plan)
// -----------------------------------------------------------------------------

describe('NewCasePanel · accesibilidad del formulario', () => {
  it('asocia una etiqueta a cada control y anuncia el progreso', async () => {
    stubApp();
    render(<NewCasePanel />);

    // Cada control tiene su etiqueta y su descripción.
    const identifier = screen.getByLabelText(/matrícula o identificador/i);
    expect(identifier).toBeTruthy();
    expect(identifier.getAttribute('aria-describedby')).toBeTruthy();

    const file = screen.getByLabelText(/archivos de evidencia/i, { selector: 'input[type="file"]' });
    expect(file.getAttribute('aria-describedby')).toBeTruthy();

    expect(screen.getByLabelText('Back Office')).toBeTruthy();
    expect(screen.getByLabelText('HelpDesk')).toBeTruthy();

    // El progreso se anuncia con `aria-live`, no solo con color.
    const live = screen.getByRole('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
  });

  it('el botón de alta es alcanzable y operable por teclado', async () => {
    const calls = stubApp();
    render(<NewCasePanel />);

    await selectEvidence('convocatoria.pdf');
    const submit = screen.getByRole('button', { name: /crear y abrir expediente/i });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    submit.focus();
    expect(document.activeElement).toBe(submit);
    await userEvent.keyboard('{Enter}');

    await waitFor(() => {
      expect(calls.some((call) => call.url === '/api/cases' && call.method === 'POST')).toBe(true);
    });
  });
});

// -----------------------------------------------------------------------------
// Gating por rol y clasificación prueba/real
// -----------------------------------------------------------------------------

describe('NewCasePanel · gating por rol (solo presentación)', () => {
  it('el Gerente no ve el formulario de alta, ni siquiera en la vista previa local', () => {
    // La vista previa local NO puede saltarse el gating por rol: el Gerente
    // sigue en solo lectura aunque el preview sea el que monta el panel.
    window.history.replaceState({}, '', '/?preview=dashboard');

    render(<NewCasePanel role="manager" />);

    expect(screen.queryByRole('button', { name: /crear y abrir expediente/i })).toBeNull();
    expect(
      screen.queryByLabelText(/archivos de evidencia/i, { selector: 'input[type="file"]' }),
    ).toBeNull();
    expect(screen.getByText(/tu rol no puede crear casos/i)).toBeTruthy();
  });
});

describe('NewCasePanel · selector prueba/real', () => {
  function createPayload(calls: RecordedCall[]): { isTest?: boolean } {
    const create = calls.find((call) => call.url === '/api/cases' && call.method === 'POST');
    return JSON.parse(create?.payload ?? '{}') as { isTest?: boolean };
  }

  it('envía isTest=true cuando se elige la clasificación Prueba', async () => {
    const calls = stubApp();
    render(<NewCasePanel />);

    await userEvent.click(screen.getByRole('radio', { name: /prueba/i }));
    await selectEvidence('convocatoria.pdf');
    await submitCase();

    await waitFor(() => {
      expect(calls.some((call) => call.url === '/api/cases' && call.method === 'POST')).toBe(true);
    });
    expect(createPayload(calls)).toMatchObject({ isTest: true });
  });

  it('envía isTest=false cuando se deja la clasificación Real por defecto', async () => {
    const calls = stubApp();
    render(<NewCasePanel />);

    // Sin tocar el selector, «Real» es la opción por defecto.
    expect((screen.getByRole('radio', { name: /^real$/i }) as HTMLInputElement).checked).toBe(true);
    await selectEvidence('convocatoria.pdf');
    await submitCase();

    await waitFor(() => {
      expect(calls.some((call) => call.url === '/api/cases' && call.method === 'POST')).toBe(true);
    });
    expect(createPayload(calls)).toMatchObject({ isTest: false });
  });
});
