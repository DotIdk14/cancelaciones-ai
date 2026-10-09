// =============================================================================
// REGRESIONES OBLIGATORIAS de la frontera de COSTO.
//
// Invariante central (DO_NOT_REPROCESS_AI_UNNECESSARILY + money-pit):
//   - Reutilizar un dictamen durable NO cobra cuota ni devuelve 429.
//   - Ejecutar de verdad cobra cuota UNA vez, antes de tocar la fila.
//   - Cuota denegada (429) NO deja fila técnica escrita.
//   - El fingerprint depende de QUÉ se audita, no del estado del caso: un
//     refresco de `processing_status` no invalida un COMPLETED (eso re-pagaba).
// =============================================================================

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { latestCompletedAuditByFingerprint } from '../src/server/cases';
import { setTestEnv } from './helpers/env';

const insertAudit = vi.fn(async (client: unknown, row: Record<string, unknown>) => ({
  ...(row as object),
  id: 'audit-nuevo',
  created_at: '2026-10-03T10:00:00.000Z',
  status: row.status,
}));

const updateAuditResult = vi.fn(async () => undefined);
const updateCaseStatus = vi.fn(async () => undefined);
const updateEvidenceStatus = vi.fn(async () => undefined);

const CASE_ROW = { id: 'caso-1', student_identifier: 'UTEL-1', created_by: 'u-1' };

// Evidencia de TEXTO con su derivado ya cacheado: `buildAuditInputs` no necesita
// descargar nada del storage, así que el test no toca red ni la base real.
const EVIDENCE_READY = {
  id: 'ev-1',
  case_id: 'caso-1',
  filename: 'correo.txt',
  mime_type: 'text/plain',
  size_bytes: 10,
  hash: 'hash-1',
  storage_path: 'caso-1/ev-1',
  processing_status: 'READY',
  transcript_json: null,
  extracted_text: 'Contenido de la evidencia',
  extraction_pipeline_version: 'extract-v1',
  created_at: '2026-10-01T10:00:00.000Z',
};

let completedByFingerprint: unknown = null;
let runningByFingerprint: unknown = null;
let evidenceRows: unknown[] = [EVIDENCE_READY];
// Mutable para poder simular la columna `cycle_start_date` poblada o ausente
// (migración sin aplicar). `?? null` en producción, igual que aquí.
let caseRow: Record<string, unknown> = { ...CASE_ROW };

/**
 * Huella para la que el dictamen cacheado sigue siendo válido. `null` = sin
 * restricción (comportamiento historical de este mock); con valor, la reutilización
 * solo ocurre si `runAudit` buscó EXACTAMENTE esa huella, que es lo que decide si
 * una fecha nueva obliga a re-auditar.
 */
let reusableForFingerprint: string | null = null;

vi.mock('../src/server/cases', async () => {
  const actual = await vi.importActual<typeof import('../src/server/cases')>('../src/server/cases');
  return {
    ...actual,
    getCaseOr404: vi.fn(async () => caseRow),
    listEvidenceRows: vi.fn(async () => evidenceRows),
    insertAudit: (...args: [unknown, Record<string, unknown>]) => insertAudit(...args),
    updateAuditResult: (...args: unknown[]) => updateAuditResult(...(args as [])),
    updateCaseStatus: (...args: unknown[]) => updateCaseStatus(...(args as [])),
    updateEvidenceStatus: (...args: unknown[]) => updateEvidenceStatus(...(args as [])),
    latestCompletedAuditByFingerprint: vi.fn(async (_client: unknown, _caseId: string, fingerprint: string) =>
      reusableForFingerprint === null || fingerprint === reusableForFingerprint ? completedByFingerprint : null,
    ),
    latestRunningAuditByFingerprint: vi.fn(async () => runningByFingerprint),
    countAuditsByFingerprint: vi.fn(async () => 0),
  };
});

const checkPaidQuota = vi.fn(async () => undefined);
vi.mock('../src/server/quotas', () => ({
  checkPaidQuota: (...args: [string, string]) => checkPaidQuota(...args),
  checkLoginEmailQuota: vi.fn(async () => undefined),
  checkLoginIpQuota: vi.fn(async () => undefined),
  hashQuotaSubject: (value: string) => `hash:${value}`,
}));

vi.mock('../src/server/insforge', () => ({ createServerClient: () => ({}) }));
vi.mock('../src/server/assemblyai', () => ({ getTranscription: vi.fn(async () => null) }));
vi.mock('../src/server/pdf', () => ({ extractPdfText: vi.fn(async () => 'texto') }));

// El modelo NO se llama en estos tests: se corta de forma controlada para que
// el test sea determinista y no dependa de la red.
vi.mock('../src/skills/audit/execute', async () => {
  const actual = await vi.importActual<typeof import('../src/skills/audit/execute')>('../src/skills/audit/execute');
  return {
    ...actual,
    auditSkill: {
      ...actual.auditSkill,
      executeWithMetadata: vi.fn(async () => {
        throw new Error('IA no disponible en test');
      }),
    },
  };
});

const COMPLETED_AUDIT = {
  id: 'audit-completado',
  case_id: 'caso-1',
  status: 'COMPLETED',
  result_json: { result: 'CANCELACION_PROCEDENTE' },
  provider: 'openrouter',
  model: 'google/gemini-2.5-flash-lite',
  evidence_fingerprint: 'fp',
  attempt_number: 1,
  created_at: '2026-10-01T10:00:00.000Z',
  completed_at: '2026-10-01T10:00:10.000Z',
  latency_ms: 1000,
  error_category: null,
  provider_metadata: null,
};

beforeEach(() => {
  setTestEnv();
  insertAudit.mockClear();
  updateAuditResult.mockClear();
  updateCaseStatus.mockClear();
  checkPaidQuota.mockClear();
  completedByFingerprint = null;
  runningByFingerprint = null;
  evidenceRows = [EVIDENCE_READY];
  caseRow = { ...CASE_ROW };
  reusableForFingerprint = null;
});

describe('R7 · reutilizar un dictamen durable no cobra cuota', () => {
  it('con un COMPLETED previo devuelve el dictamen y NO llama al servicio de cuotas', async () => {
    completedByFingerprint = COMPLETED_AUDIT;
    const { runAudit } = await import('../src/server/audit-service');

    const outcome = await runAudit({} as never, 'caso-1', { userId: 'u-1' });

    expect(outcome.phase).toBe('done');
    expect(checkPaidQuota).not.toHaveBeenCalled();
    expect(insertAudit).not.toHaveBeenCalled();
  });

  it('con una RUNNING vigente devuelve el estado y NO cobra cuota', async () => {
    const now = Date.now();
    runningByFingerprint = {
      ...COMPLETED_AUDIT,
      id: 'audit-corriendo',
      status: 'RUNNING',
      result_json: null,
      deadline_at: new Date(now + 60_000).toISOString(),
    };
    const { runAudit } = await import('../src/server/audit-service');

    const outcome = await runAudit({} as never, 'caso-1', { userId: 'u-1' });

    expect(outcome.phase).toBe('running');
    expect(checkPaidQuota).not.toHaveBeenCalled();
    expect(insertAudit).not.toHaveBeenCalled();
  });

  it('sin caller identificado no se cobra (y no se rompe)', async () => {
    const { runAudit } = await import('../src/server/audit-service');
    // El proveedor real está mockeado: sólo nos importa que la cuota no se cobre
    // cuando nadie la pide y que el flujo no lance por el mocks.
    await runAudit({} as never, 'caso-1').catch(() => undefined);
    expect(checkPaidQuota).not.toHaveBeenCalled();
  });
});

describe('R8 · ejecutar de verdad cobra cuota antes de tocar la fila', () => {
  it('exige cuota y ademas la fila durable', async () => {
    const { runAudit } = await import('../src/server/audit-service');
    await runAudit({} as never, 'caso-1', { userId: 'u-1' }).catch(() => undefined);

    expect(checkPaidQuota).toHaveBeenCalledTimes(1);
    expect(checkPaidQuota.mock.calls[0]?.[0]).toBe('u-1');
    // El contexto de cuota incluye el fingerprint: la cuota es por auditoria
    // concreta, no una bolsa global sin traza.
    expect(String(checkPaidQuota.mock.calls[0]?.[1])).toContain('audit:caso-1:');
    expect(insertAudit).toHaveBeenCalledTimes(1);
  });

  it('un 429 no deja fila de auditoria escrita ni cambia el estado del caso', async () => {
    checkPaidQuota.mockRejectedValueOnce(
      Object.assign(new Error('limite alcanzado'), { status: 429, category: 'RATE_LIMIT' }),
    );
    const { runAudit } = await import('../src/server/audit-service');

    await expect(runAudit({} as never, 'caso-1', { userId: 'u-1' })).rejects.toMatchObject({ status: 429 });

    expect(insertAudit).not.toHaveBeenCalled();
    expect(updateCaseStatus).not.toHaveBeenCalled();
  });

  it('el servicio de cuotas caido detiene la ejecucion (fail-closed, no se llama al modelo)', async () => {
    checkPaidQuota.mockRejectedValueOnce(new Error('servicio de cuotas no disponible'));
    const { runAudit } = await import('../src/server/audit-service');

    await expect(runAudit({} as never, 'caso-1', { userId: 'u-1' })).rejects.toThrow();

    expect(insertAudit).not.toHaveBeenCalled();
  });
});

describe('R9/R10 · fingerprint estable ante cambios de estado', () => {
  it('cambiar processing_status NO invalida el fingerprint', async () => {
    const { computeEvidenceFingerprint } = await import('../src/server/audit-service');

    const uploaded = computeEvidenceFingerprint([{ ...EVIDENCE_READY, processing_status: 'UPLOADED' } as never]);
    const ready = computeEvidenceFingerprint([{ ...EVIDENCE_READY, processing_status: 'READY' } as never]);

    expect(uploaded).toBe(ready);
  });

  it('cambiar el hash del original SÍ cambia el fingerprint', async () => {
    const { computeEvidenceFingerprint } = await import('../src/server/audit-service');

    const a = computeEvidenceFingerprint([{ ...EVIDENCE_READY, hash: 'hash-1' } as never]);
    const b = computeEvidenceFingerprint([{ ...EVIDENCE_READY, hash: 'hash-2' } as never]);

    expect(a).not.toBe(b);
  });

  it('cambiar el texto derivado de una transcripcion SÍ cambia el fingerprint', async () => {
    const { computeEvidenceFingerprint } = await import('../src/server/audit-service');
    const withTranscript = (text: string) =>
      computeEvidenceFingerprint([
        {
          ...EVIDENCE_READY,
          mime_type: 'audio/mpeg',
          transcript_json: { assemblyId: 'a-1', status: 'READY', transcript: { transcript: text } },
        } as never,
      ]);

    expect(withTranscript('quiero cancelar')).not.toBe(withTranscript('quiero quedarme'));
  });

  it('re-transcribir el MISMO audio con distinto assemblyId NO cambia el fingerprint', async () => {
    const { computeEvidenceFingerprint } = await import('../src/server/audit-service');
    const transcript = (assemblyId: string) =>
      computeEvidenceFingerprint([
        {
          ...EVIDENCE_READY,
          mime_type: 'audio/mpeg',
          transcript_json: {
            assemblyId,
            status: 'READY',
            transcript: { transcript: 'Quiero cancelar mi matricula' },
          },
        } as never,
      ]);

    expect(transcript('assembly-1')).toBe(transcript('assembly-2'));
  });

  it('el fingerprint no depende del orden de las evidencias', async () => {
    const { computeEvidenceFingerprint } = await import('../src/server/audit-service');
    const ev2 = { ...EVIDENCE_READY, id: 'ev-2', hash: 'hash-2', created_at: '2026-10-02T10:00:00.000Z' };

    const uno = computeEvidenceFingerprint([EVIDENCE_READY, ev2] as never);
    const otro = computeEvidenceFingerprint([ev2, EVIDENCE_READY] as never);

    expect(uno).toBe(otro);
  });
});

/**
 * La fecha de inicio que capturó el equipo cambia lo que el modelo ve, así que
 * debe formar parte de QUÉ se audita. Estos tests fijan el cableado de `runAudit`
 * (que es donde estaba el bug): la huella se calcula DESPUÉS de leer el caso, y
 * de ella dependen tanto la decisión de reutilizar un dictamen cacheado como el
 * cobro de cuota.
 */
describe('R11 · la fecha de inicio del equipo entra en la huella solo cuando existe', () => {
  /** La huella con la que el caso buscó un dictamen COMPLETED reutilizable. */
  function reusedFingerprint(): string | undefined {
    const call = vi.mocked(latestCompletedAuditByFingerprint).mock.calls.at(-1);
    return call?.[2];
  }

  beforeEach(() => {
    vi.mocked(latestCompletedAuditByFingerprint).mockClear();
  });

  it('con la columna poblada, el dictamen cacheado deja de ser reutilizable', async () => {
    caseRow = { ...CASE_ROW, cycle_start_date: '2026-08-21' };
    const { runAudit, computeEvidenceFingerprint } = await import('../src/server/audit-service');
    const rows = evidenceRows as never;
    // El dictamen cacheado se emitió SIN la fecha: solo es reutilizable por la
    // huella de siempre.
    completedByFingerprint = COMPLETED_AUDIT;
    reusableForFingerprint = computeEvidenceFingerprint(rows);

    // No reutiliza: cobra cuota, escribe su fila y llama al proveedor (mockeado a
    // fallar, así que `runAudit` envuelve el fallo). Si hubiera reutilizado, no
    // habría fila ni cuota.
    await expect(runAudit({} as never, 'caso-1', { userId: 'u-1' })).rejects.toThrow('La auditoría falló');

    // La huella buscada lleva la fecha, así que el COMPLETED cacheado NO se
    // reutiliza y el caso vuelve a auditarse de verdad.
    expect(reusedFingerprint()).toBe(computeEvidenceFingerprint(rows, '2026-08-21'));
    expect(reusedFingerprint()).not.toBe(reusableForFingerprint);
    expect(insertAudit).toHaveBeenCalledTimes(1);
    expect(checkPaidQuota).toHaveBeenCalledTimes(1);
  });

  it('con la columna ausente o sin capturar, la huella es la de siempre y el dictamen se reutiliza', async () => {
    const { runAudit, computeEvidenceFingerprint } = await import('../src/server/audit-service');
    completedByFingerprint = COMPLETED_AUDIT;
    reusableForFingerprint = computeEvidenceFingerprint(evidenceRows as never);

    const outcome = await runAudit({} as never, 'caso-1', { userId: 'u-1' });

    expect(outcome.phase).toBe('done');
    // Ni se vuelve a auditar ni se cobra cuota: la huella heredada no se movió.
    expect(reusedFingerprint()).toBe(reusableForFingerprint);
    expect(checkPaidQuota).not.toHaveBeenCalled();
  });
});