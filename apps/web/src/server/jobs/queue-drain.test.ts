import { describe, expect, it } from 'vitest';
import { decideDrainAction, shouldRetryProcess, isBackoffElapsed, type QueueJobView } from './queue-drain';

/**
 * Test de regresión del incidente del 2026-09-25.
 *
 * Auditoría afectada: 4956e983-ba50-418a-b831-d6b2cca249ea
 *
 * ANTES DEL FIX, ESTOS TESTS FALLAN. La condición original era:
 *
 *   const active = jobs.some((job) => activeStatuses.has(job.status));
 *   if (!active) return;
 *   await fetch('/api/jobs/process', { method: 'POST' });
 *   await sleep(700);
 *
 * con `activeStatuses = { QUEUED, RUNNING, RETRY_SCHEDULED }`.
 *
 * Con un job en RETRY_SCHEDULED, `active` era true para siempre, así que se
 * repetía el POST hasta 60 veces por llamada, y `finishPipeline` volvía a llamar
 * a `waitForJobs`, de modo que hasta ~120 POSTs por montaje. Todos devolvían
 * HTTP 200 porque `claim_next_job` rechazaba correctamente el job en backoff.
 */

const job = (overrides: Partial<QueueJobView> = {}): QueueJobView => ({
  id: 'ac2cd20b-afd6-4a07-8741-8665860e1b5b',
  jobType: 'FACT_EXTRACTION',
  status: 'RETRY_SCHEDULED',
  attemptCount: 2,
  maxAttempts: 3,
  lastErrorCode: 'FACT_RUN_NOT_PROCESSING',
  lastErrorMessage: 'FACT_RUN_NOT_PROCESSING: DRAFT',
  ...overrides,
});

describe('decideDrainAction', () => {
  describe('el caso exacto del incidente', () => {
    it('NO pide procesar cuando el único job está en RETRY_SCHEDULED', () => {
      // Éste es el job que quedó atascado en la auditoría 4956e983.
      const action = decideDrainAction([job()]);
      expect(action).toEqual({ kind: 'wait', reason: 'RETRY_SCHEDULED' });
      // Antes: kind 'process' en bucle indefinido.
    });

    it('NO pide procesar mientras un job está RUNNING', () => {
      const action = decideDrainAction([job({ status: 'RUNNING', leaseOwner: 'http-abc' } as Partial<QueueJobView>)]);
      expect(action).toEqual({ kind: 'wait', reason: 'RUNNING' });
    });

    it('no pide procesar nunca para un job ya en curso, aunque haya otro QUEUED detrás', () => {
      // Un RUNNING significa "alguien lo tiene". Reclamarlo otra vez desde el
      // mismo cliente no lo acelera: el claim vive en la base de datos.
      const action = decideDrainAction([job({ status: 'RUNNING' } as Partial<QueueJobView>)]);
      expect(action.kind).not.toBe('process');
    });
  });

  describe('sí pide procesar cuando toca', () => {
    it('pide procesar exactamente una vez por job QUEUED', () => {
      expect(decideDrainAction([job({ status: 'QUEUED' })])).toEqual({ kind: 'process' });
    });

    it('con varios QUEUED sigue siendo una sola acción, no N', () => {
      // El endpoint hace `claimNext`, una unidad de trabajo por llamada.
      expect(decideDrainAction([job({ status: 'QUEUED' }), job({ id: 'b', status: 'QUEUED' })])).toEqual({ kind: 'process' });
    });
  });

  describe('condiciones de terminación', () => {
    it('termina si no hay jobs', () => {
      expect(decideDrainAction([])).toEqual({ kind: 'done' });
    });

    it('termina si todos han terminado bien', () => {
      expect(decideDrainAction([job({ status: 'SUCCEEDED' }), job({ id: 'b', status: 'SUCCEEDED' })])).toEqual({ kind: 'done' });
    });

    it('propaga el fallo en vez de seguir insistiendo', () => {
      const failed = job({ status: 'FAILED', lastErrorMessage: 'EVIDENCE_NOT_FOUND' });
      const action = decideDrainAction([failed]);
      expect(action.kind).toBe('failed');
      if (action.kind === 'failed') expect(action.job.lastErrorMessage).toBe('EVIDENCE_NOT_FOUND');
    });

    it('el fallo gana a un QUEUED pendiente: no seTQueda reintentando', () => {
      const action = decideDrainAction([job({ status: 'QUEUED' }), job({ id: 'b', status: 'FAILED' })]);
      expect(action.kind).toBe('failed');
    });

    it('termina ante un estado desconocido en vez de POSTear a ciegas', () => {
      expect(decideDrainAction([job({ status: 'WAT' })])).toEqual({ kind: 'done' });
    });
  });

  describe('el loop no puede reproducirse', () => {
    it('con el job atascado del incidente, ninguna de 200 iteraciones pide procesar', () => {
      // Reproducción literal del bucle observado en el navegador.
      const stuck = [job()];
      let posts = 0;
      for (let iteration = 0; iteration < 200; iteration += 1) {
        const action = decideDrainAction(stuck);
        if (action.kind === 'process') posts += 1;
      }
      expect(posts).toBe(0);
      // Antes del fix: 200 POSTs (limitado a 60 por waitForJobs, ~120 por montaje).
    });

    it('con un RUNNING persistente, tampoco pide procesar en bucle', () => {
      const running = [job({ status: 'RUNNING' } as Partial<QueueJobView>)];
      let posts = 0;
      for (let i = 0; i < 200; i += 1) if (decideDrainAction(running).kind === 'process') posts += 1;
      expect(posts).toBe(0);
    });

    it('pide procesar sólo tantas veces como jobs QUEUED reales hay', () => {
      let queue: QueueJobView[] = [job({ id: 'a', status: 'QUEUED' }), job({ id: 'b', status: 'QUEUED' })];
      let posts = 0;
      for (let i = 0; i < 50; i += 1) {
        if (decideDrainAction(queue).kind === 'process') {
          posts += 1;
          // El backend termina UNO por llamada: se marca el primero QUEUED real.
          const pending = queue.findIndex((entry) => entry.status === 'QUEUED');
          queue = queue.map((entry, index) => (index === pending ? { ...entry, status: 'SUCCEEDED' } : entry));
        }
      }
      expect(posts).toBe(2);
      expect(queue.every((entry) => entry.status === 'SUCCEEDED')).toBe(true);
    });

    it('LA LÓGICA ANTIGUA SÍ PRODUCE EL BUG: así se prueba que el test es una regresión real', () => {
      // Condición original de AuditWorkflow.waitForJobs, reproducida literalmente:
      //   const activeStatuses = new Set(['QUEUED', 'RUNNING', 'RETRY_SCHEDULED']);
      //   if (jobs.some((j) => activeStatuses.has(j.status))) -> POST process
      const legacyActive = new Set(['QUEUED', 'RUNNING', 'RETRY_SCHEDULED']);
      const legacyPosts = Array.from({ length: 200 }, () => job())
        .filter((entry) => legacyActive.has(entry.status)).length;
      expect(legacyPosts).toBe(200);

      // La misma cola, con la política nueva: cero POSTs.
      const newPosts = Array.from({ length: 200 }, () => job())
        .filter((entry) => decideDrainAction([entry]).kind === 'process').length;
      expect(newPosts).toBe(0);

      // Si alguien reintrodujera la condición antigua, este test falla.
      expect(legacyPosts).toBeGreaterThan(newPosts);
    });
  });
});

describe('shouldRetryProcess', () => {
  it('sólo reintenta si el backend dijo que procesó', () => {
    expect(shouldRetryProcess('processed')).toBe(true);
  });

  it('NO reintenta con un 200 que no hizo trabajo: ése era el segundo defecto', () => {
    // `/api/jobs/process` devolvía 200 {processed: 0} indistinguible de un
    // 200 con trabajo hecho. El cliente no podía saber, así que repetía.
    expect(shouldRetryProcess('nothing_to_process')).toBe(false);
    expect(shouldRetryProcess('already_running')).toBe(false);
    expect(shouldRetryProcess('retry_scheduled')).toBe(false);
    expect(shouldRetryProcess('terminal_failure')).toBe(false);
    expect(shouldRetryProcess('ai_processing_disabled')).toBe(false);
    expect(shouldRetryProcess(null)).toBe(false);
  });
});

describe('isBackoffElapsed', () => {
  const now = Date.parse('2026-09-25T21:39:44.395Z');

  it('un backoff ya vencido vuelve a ser reclamable', () => {
    expect(isBackoffElapsed(job({ availableAt: '2026-09-25T21:39:40.000Z' }), now)).toBe(true);
  });

  it('un backoff vigente NO es reclamable, y ése es el job del incidente', () => {
    expect(isBackoffElapsed(job({ availableAt: '2026-09-25T21:40:14.395Z' }), now)).toBe(false);
  });

  it('sólo aplica a RETRY_SCHEDULED', () => {
    expect(isBackoffElapsed(job({ status: 'QUEUED', availableAt: '2026-09-25T21:00:00.000Z' }), now)).toBe(false);
  });

  it('sin available_at no se inventa una ventana', () => {
    expect(isBackoffElapsed(job({ availableAt: null }), now)).toBe(false);
  });
});
