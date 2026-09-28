import { beforeEach, describe, expect, it } from 'vitest';
import { createAuditResultRepository } from './audit-results';
import { createFakeDatabase, type FakeDatabase } from './testing/fake-db';

let db: FakeDatabase;
let results: ReturnType<typeof createAuditResultRepository>;

const ASSESSMENT_COMPLETADO = {
  status: 'COMPLETED' as const,
  classification: 'CANCELACION_VENTA' as const,
  summary: 'El audio del 03/03 registra una peticion expresa de cancelacion de venta.',
  findings: [
    {
      title: 'Peticion de baja de unidad',
      detail: 'La alumna solicita la baja y el centro la acepta en la misma llamada.',
      evidence: [{ evidenceId: 'ev_audio_1', timestampStart: 12, timestampEnd: 40 }],
    },
  ],
  evidenceReferences: [{ evidenceId: 'ev_audio_1' }],
  policyReferences: [{ procedureVersion: 'GDM_GAM_PRD_MLG_003', section: '3.2' }],
  contradictions: [],
  missingEvidence: [],
  procedureVersion: 'GDM_GAM_PRD_MLG_003',
};

const ASSESSMENT_NECESITA_EVIDENCIA = {
  status: 'NEEDS_INPUT' as const,
  summary: 'Falta el audio de la llamada del 03/03: solo hay un correo.',
  findings: [],
  evidenceReferences: [],
  policyReferences: [],
  contradictions: [],
  missingEvidence: [
    {
      description: 'Grabacion de la llamada del 03/03',
      reason: 'Sin el audio no se puede afirmar que hubo peticion de baja.',
      suggestedEvidence: 'Exportar el audio del 03/03 desde el sistema de centralita.',
    },
  ],
  procedureVersion: 'GDM_GAM_PRD_MLG_003',
};

const REVIEW_CONFIRMADO = {
  verdict: 'CONFIRMED' as const,
  summary: 'El dictamen se sostiene en la evidencia citada.',
  counterEvidence: [],
  unsupportedClaims: [],
  missingEvidence: [],
};

beforeEach(() => {
  db = createFakeDatabase();
  results = createAuditResultRepository(db);
});

describe('createAuditResultRepository', () => {
  it('inserta un assessment COMPLETED con su clasificacion', async () => {
    const creado = await results.create({
      auditId: 'audit_1',
      runId: 'run_1',
      stage: 'ANALYST',
      status: 'COMPLETED',
      classification: 'CANCELACION_VENTA',
      summary: ASSESSMENT_COMPLETADO.summary,
      assessment: ASSESSMENT_COMPLETADO,
    });

    expect(creado.stage).toBe('ANALYST');
    expect(creado.status).toBe('COMPLETED');
    expect(creado.classification).toBe('CANCELACION_VENTA');
    expect(creado.runId).toBe('run_1');
    expect(creado.assessment).toMatchObject({ classification: 'CANCELACION_VENTA' });
    expect(creado.review).toBeNull();
    expect(db.rows('audit_results')).toHaveLength(1);
  });

  it('rechaza un assessment NEEDS_INPUT sin missingEvidence y no escribe nada', async () => {
    const assessmentSinJustificacion = { ...ASSESSMENT_NECESITA_EVIDENCIA, missingEvidence: [] };

    await expect(
      results.create({
        auditId: 'audit_1',
        runId: 'run_1',
        stage: 'ANALYST',
        status: 'NEEDS_INPUT',
        summary: assessmentSinJustificacion.summary,
        assessment: assessmentSinJustificacion,
      }),
    ).rejects.toThrow(/missingEvidence/);

    expect(db.rows('audit_results')).toEqual([]);
  });

  it('admite un assessment NEEDS_INPUT que explica que falta', async () => {
    const creado = await results.create({
      auditId: 'audit_1',
      runId: 'run_1',
      stage: 'ANALYST',
      status: 'NEEDS_INPUT',
      summary: ASSESSMENT_NECESITA_EVIDENCIA.summary,
      assessment: ASSESSMENT_NECESITA_EVIDENCIA,
    });

    expect(creado.status).toBe('NEEDS_INPUT');
    expect(creado.classification).toBeNull();
  });

  it('rechaza un assessment COMPLETED sin clasificacion', async () => {
    const assessmentSinClasificacion = { ...ASSESSMENT_COMPLETADO, classification: undefined };

    await expect(
      results.create({
        auditId: 'audit_1',
        runId: 'run_1',
        stage: 'ANALYST',
        status: 'COMPLETED',
        summary: assessmentSinClasificacion.summary,
        assessment: assessmentSinClasificacion,
      }),
    ).rejects.toThrow();

    expect(db.rows('audit_results')).toEqual([]);
  });

  it('rechaza un review REJECTED que no senala nada', async () => {
    const reviewVacio = { ...REVIEW_CONFIRMADO, verdict: 'REJECTED' as const };

    await expect(
      results.create({
        auditId: 'audit_1',
        runId: 'run_1',
        stage: 'REVIEWER',
        status: 'COMPLETED',
        summary: ASSESSMENT_COMPLETADO.summary,
        assessment: ASSESSMENT_COMPLETADO,
        review: reviewVacio,
      }),
    ).rejects.toThrow(/unsupportedClaims/);

    expect(db.rows('audit_results')).toEqual([]);
  });

  it('rechaza un segundo resultado para el mismo run', async () => {
    const entrada = {
      auditId: 'audit_1',
      runId: 'run_1',
      stage: 'ANALYST' as const,
      status: 'COMPLETED' as const,
      classification: 'CANCELACION_VENTA' as const,
      summary: ASSESSMENT_COMPLETADO.summary,
      assessment: ASSESSMENT_COMPLETADO,
    };

    await results.create(entrada);

    await expect(results.create({ ...entrada, stage: 'FINAL' })).rejects.toThrow(/run_1/);
    expect(db.rows('audit_results')).toHaveLength(1);
  });

  it('devuelve el resultado FINAL mas reciente de la auditoria', async () => {
    const finalViejo = await results.create({
      auditId: 'audit_1',
      runId: 'run_1',
      stage: 'FINAL',
      status: 'COMPLETED',
      classification: 'BAJA',
      summary: 'Primer dictamen.',
      assessment: { ...ASSESSMENT_COMPLETADO, classification: 'BAJA' },
    });
    db.patchRows('audit_results', { created_at: '2026-01-01T10:00:00.000Z' }, (row) => row.id === finalViejo.id);

    const analyst = await results.create({
      auditId: 'audit_1',
      runId: 'run_2',
      stage: 'ANALYST',
      status: 'COMPLETED',
      classification: 'CANCELACION_VENTA',
      summary: 'Pasada del analista posterior.',
      assessment: ASSESSMENT_COMPLETADO,
    });
    db.patchRows('audit_results', { created_at: '2026-01-02T10:00:00.000Z' }, (row) => row.id === analyst.id);

    const finalNuevo = await results.create({
      auditId: 'audit_1',
      runId: 'run_3',
      stage: 'FINAL',
      status: 'COMPLETED',
      classification: 'CANCELACION_VENTA_OPERATIVA',
      summary: 'Dictamen corregido tras la revision.',
      assessment: { ...ASSESSMENT_COMPLETADO, classification: 'CANCELACION_VENTA_OPERATIVA' },
      review: REVIEW_CONFIRMADO,
    });
    db.patchRows('audit_results', { created_at: '2026-01-03T10:00:00.000Z' }, (row) => row.id === finalNuevo.id);

    const final = await results.finalForAudit('audit_1');

    expect(final?.id).toBe(finalNuevo.id);
    expect(final?.classification).toBe('CANCELACION_VENTA_OPERATIVA');
    expect(final?.review).toMatchObject({ verdict: 'CONFIRMED' });
  });

  it('ignora un FINAL mas antiguo escrito despues por reloj del servidor', async () => {
    const viejo = await results.create({
      auditId: 'audit_1',
      runId: 'run_1',
      stage: 'FINAL',
      status: 'COMPLETED',
      classification: 'BAJA',
      summary: 'Dictamen de la primera pasada.',
      assessment: { ...ASSESSMENT_COMPLETADO, classification: 'BAJA' },
    });
    db.patchRows('audit_results', { created_at: '2026-01-01T10:00:00.000Z' }, (row) => row.id === viejo.id);

    const nuevo = await results.create({
      auditId: 'audit_1',
      runId: 'run_2',
      stage: 'FINAL',
      status: 'COMPLETED',
      classification: 'CANCELACION_VENTA',
      summary: 'Dictamen de la segunda pasada.',
      assessment: ASSESSMENT_COMPLETADO,
    });
    db.patchRows('audit_results', { created_at: '2026-01-05T10:00:00.000Z' }, (row) => row.id === nuevo.id);

    const final = await results.finalForAudit('audit_1');

    expect(final?.id).toBe(nuevo.id);
    expect(final?.id).not.toBe(viejo.id);
  });

  it('devuelve null cuando la auditoria no tiene dictamen FINAL', async () => {
    await results.create({
      auditId: 'audit_1',
      runId: 'run_1',
      stage: 'ANALYST',
      status: 'COMPLETED',
      classification: 'CANCELACION_VENTA',
      summary: ASSESSMENT_COMPLETADO.summary,
      assessment: ASSESSMENT_COMPLETADO,
    });

    expect(await results.finalForAudit('audit_1')).toBeNull();
  });

  it('busca el resultado de un run', async () => {
    const creado = await results.create({
      auditId: 'audit_1',
      runId: 'run_1',
      stage: 'ANALYST',
      status: 'COMPLETED',
      classification: 'CANCELACION_VENTA',
      summary: ASSESSMENT_COMPLETADO.summary,
      assessment: ASSESSMENT_COMPLETADO,
    });

    expect((await results.findByRun('run_1'))?.id).toBe(creado.id);
    expect(await results.findByRun('run_inexistente')).toBeNull();
  });
});
