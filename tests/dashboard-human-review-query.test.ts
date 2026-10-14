import { fakeAuthContext } from './helpers/auth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { InsForgeClient } from '../src/server/insforge';
import { dashboardPostgres, postgresDashboardClient } from './helpers/dashboard-postgres';
import { getAiQuality, getDashboardSummary, getAiCosts } from '../src/server/dashboard-queries';
import { parseDashboardFilters } from '../src/server/dashboard-filters';

const filters = { from: '2026-10-01', to: '2026-10-31', result: null, status: null };
const id = (value: number) => `00000000-0000-0000-0000-${String(value).padStart(12, '0')}`;
let db: PGlite;
let client: InsForgeClient;

const metadata = (cost: number | null = 0.1) => ({ usage: { estimatedCostUSD: cost, totalTokens: 100 }, openrouterAttempts: [{ model: 'test/model', format: 'json_schema', cost, totalTokens: 100, failureCategory: null }] });
async function caseRow(value = 1, test = false): Promise<void> {
  await db.query('INSERT INTO cases(id,country,campus,responsible,guideline,is_test,external_case_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [id(value), 'MX', 'Campus uno', 'Asesor uno', 'V5', test, `CaVe-${value}`]);
}
async function audit(value = 11, caseId = 1, status = 'COMPLETED', at = '2026-10-10T12:00:00Z', confidence: number | null = 0.9, cost: number | null = 0.1): Promise<void> {
  await db.query('INSERT INTO audits(id,case_id,status,model,provider,created_at,result_json,provider_metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [id(value), id(caseId), status, 'test/model', 'openrouter', at, status === 'COMPLETED' ? { audit: { result: 'CANCELACION_VENTA', confidence, missingEvidence: [] } } : null, metadata(cost)]);
}
async function review(auditId = 11, final: 'APPROVE' | 'CHANGE' | null = 'APPROVE'): Promise<void> {
  await db.query('INSERT INTO case_reviews(id,case_id,audit_id,result,coordinator_decision,coordinator_resolution,coordinator_created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [id(21), id(1), id(auditId), 'BAJA', final, final === 'CHANGE' ? 'CANCELACION_VENTA' : null, final ? '2026-10-11T12:00:00Z' : null]);
}
async function comparison(status = 'COMPLETED', agrees = true, at = '2026-10-12T12:00:00Z'): Promise<void> {
  await db.query('INSERT INTO case_comparisons(id,case_review_id,audit_id,status,provider,model,created_at,result_json,provider_metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id(31), id(21), id(11), status, 'openrouter', 'test/model', at, status === 'COMPLETED' ? { agrees, confidence: 0.8, usage: { estimatedCostUSD: 0.02 } } : null, metadata(0.02)]);
}

beforeAll(async () => { db = await dashboardPostgres(); client = postgresDashboardClient(db); }, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => { await db.exec('TRUNCATE comparison_execution_history,case_comparisons,case_reviews,audits,cases CASCADE'); });

describe('métricas reales sobre PostgreSQL sintético', () => {
  it('tres auditorías son tres ejecuciones y una versión vigente en Calidad', async () => {
    await caseRow(); await audit(); await audit(12, 1, 'COMPLETED', '2026-10-12T12:00:00Z', 0.8); await audit(13, 1, 'COMPLETED', '2026-10-13T12:00:00Z', 0.7);
    const summary = await getDashboardSummary(client, filters, fakeAuthContext('manager')); const quality = await getAiQuality(client, filters);
    expect(summary.activity?.audits).toMatchObject({ executions: 3, uniqueCases: 1, reaudits: 2 });
    expect(quality.evaluation).toMatchObject({ issued: 1, historicalVersions: 3 });
    expect(quality.confidence.avgConfidence).toBe(0.7);
    expect(quality.evaluation?.historicalRows?.find(row => row.auditId === id(11))?.originalConfidence).toBe(0.9);
  });
  it('un fallo conserva su gasto conocido y no entra en concordancia', async () => {
    await caseRow(); await audit(11, 1, 'ERROR', undefined, null, 0.13);
    const summary = await getDashboardSummary(client, filters, fakeAuthContext('manager')); const quality = await getAiQuality(client, filters);
    expect(summary.activity?.audits).toMatchObject({ failed: 1, knownCostUsd: 0.13 });
    expect(quality.evaluation).toMatchObject({ issued: 0, validComparisons: 0, technicalErrors: 1, agreementRate: null });
  });
  it('auditoría y comparación suman consumos propios una sola vez', async () => {
    await caseRow(); await audit(); await review(); await comparison();
    const summary = await getDashboardSummary(client, filters, fakeAuthContext('manager')); const costs = await getAiCosts(client, filters, 'day');
    expect(summary.activity?.audits.knownCostUsd).toBe(0.1); expect(summary.activity?.comparisons.knownCostUsd).toBe(0.02);
    expect(summary.activity?.knownTotalCostUsd).toBeCloseTo(0.12); expect(costs.kpi.totalCostUsd).toBeCloseTo(0.12);
  });
  it('sin revisión aparece como pendiente y sin confianza no equivale a cero', async () => {
    await caseRow(); await audit(11, 1, 'COMPLETED', undefined, null);
    const result = await getAiQuality(client, filters);
    expect(result.evaluation).toMatchObject({ pendingEvaluation: 1, withoutConfidence: 1, agreementRate: null });
    expect(result.evaluation?.rows[0]?.state).toBe('PENDING_ADVISOR'); expect(result.confidence.avgConfidence).toBeNull();
  });
  it('desacuerdo provisional del asesor no se convierte en discrepancia final', async () => {
    await caseRow(); await audit(); await review(11, null); await comparison('COMPLETED', false);
    const result = await getAiQuality(client, filters);
    expect(result.evaluation).toMatchObject({ finalized: 0, disagreements: 0, validComparisons: 0 });
    expect(result.evaluation?.rows[0]?.state).toBe('PENDING_COORDINATOR');
  });
  it('CHANGE del Coordinador gobierna la resolución final sin sobrescribir al asesor', async () => {
    await caseRow(); await audit(); await review(11, 'CHANGE'); await comparison('COMPLETED', true);
    const result = await getAiQuality(client, filters);
    expect(result.evaluation?.rows[0]).toMatchObject({ aiResolution: 'CANCELACION_VENTA', advisorResolution: 'BAJA', finalResolution: 'CANCELACION_VENTA', substantiveAgreement: true, exactAgreement: true, originalConfidence: 0.9 });
    expect(result.evaluation).toMatchObject({ agreements: 1, validComparisons: 1, agreementRate: 1, coverageRate: 1 });
  });
  it('una discrepancia sustantiva completada cuenta; un error técnico queda aparte', async () => {
    await caseRow(); await audit(); await review(); await comparison('COMPLETED', false);
    expect((await getAiQuality(client, filters)).evaluation?.disagreements).toBe(1);
    await db.exec("UPDATE case_comparisons SET status='ERROR',result_json=NULL");
    expect((await getAiQuality(client, filters)).evaluation).toMatchObject({ disagreements: 0, failedComparisons: 1, validComparisons: 0, agreementRate: null });
  });
  it('la fecha posterior de la comparación no cambia la cohorte de dictámenes', async () => {
    await caseRow(); await audit(); await review(); await comparison('COMPLETED', true, '2026-11-01T12:00:00Z');
    expect((await getAiQuality(client, filters)).evaluation?.agreements).toBe(1);
    expect((await getDashboardSummary(client, filters, fakeAuthContext('manager'))).activity?.comparisons.executions).toBe(0);
  });
  it('los filtros de fecha, responsable, campus y lineamiento se aplican en SQL al mismo universo', async () => {
    await caseRow(); await audit(); await review(); await comparison();
    await caseRow(2); await audit(12, 2, 'COMPLETED', '2026-09-30T23:59:59.999Z');
    const parsed = parseDashboardFilters({ from: filters.from, to: filters.to, responsible: 'Asesor uno', campus: 'Campus uno', guideline: 'V5' });
    const result = await getAiQuality(client, parsed);
    expect(result.evaluation?.rows.map(row => row.caseId)).toEqual([id(1)]);
    expect(result.evaluation?.issued).toBe(result.evaluation?.rows.filter(row => row.aiResolution !== null).length);
    for (const field of ['responsible','campus','guideline'] as const) {
      expect((await getAiQuality(client, { ...parsed, [field]: 'No existe' })).evaluation?.issued).toBe(0);
      expect((await getDashboardSummary(client, { ...parsed, [field]: 'No existe' }, fakeAuthContext('manager'))).activity?.audits.executions).toBe(0);
    }
  });
  it('filtro de indicador en backend y listado representan los mismos registros', async () => {
    await caseRow(); await audit(); await review(); await comparison('COMPLETED', false);
    const disagreed = await getAiQuality(client, { ...filters, evaluation: 'DISAGREEMENT' });
    expect(disagreed.evaluation?.disagreements).toBe(disagreed.evaluation?.rows.length);
    expect((await getAiQuality(client, { ...filters, evaluation: 'AGREEMENT' })).evaluation?.rows).toEqual([]);
  });
  it('la selección vigente ocurre antes del rango y no tras filtrar las versiones', async () => {
    await caseRow(); await audit(); await audit(12,1,'COMPLETED','2026-11-02T00:00:00Z');
    const result = await getAiQuality(client, filters);
    expect(result.evaluation?.issued).toBe(0); expect(result.evaluation?.historicalVersions).toBe(1);
  });
  it('revisión anclada a una versión anterior no evalúa la nueva', async () => {
    await caseRow(); await audit(); await review(); await comparison(); await audit(12,1,'COMPLETED','2026-10-15T00:00:00Z');
    const result = await getAiQuality(client, filters);
    expect(result.evaluation).toMatchObject({ issued: 1, finalized: 0, agreements: 0 });
    expect(result.evaluation?.rows[0]?.state).toBe('PENDING_ADVISOR');
    expect(result.evaluation?.historicalRows?.find(row => row.auditId === id(11))?.substantiveAgreement).toBe(true);
  });
  it('null es costo desconocido y cero explícito es conocido', async () => {
    await caseRow(); await audit(11,1,'COMPLETED',undefined,0.9,null);
    expect((await getDashboardSummary(client,filters,fakeAuthContext('manager'))).activity?.audits).toMatchObject({ executionsWithUnknownCost: 1, avgKnownCostPerExecutionUsd: null });
    await db.query('UPDATE audits SET provider_metadata=$1',[metadata(0)]);
    expect((await getDashboardSummary(client,filters,fakeAuthContext('manager'))).activity?.audits).toMatchObject({ executionsWithUnknownCost: 0, avgKnownCostPerExecutionUsd: 0 });
  });
  it('suma intentos pagados sin duplicar usage ni diagnósticos de capacidades', async () => {
    await caseRow(); await audit();
    await db.query('UPDATE audits SET provider_metadata=$1', [{ usage: { estimatedCostUSD: 0.1, totalTokens: 100 }, openrouterAttempts: [
      { model:'m1',format:'capability',cost:null }, { model:'m1',format:'json_schema',cost:0.03,totalTokens:40,failureCategory:'INVALID_JSON' },
      { model:'m2',format:'json_schema',cost:0.1,totalTokens:100,failureCategory:null }] }]);
    expect((await getDashboardSummary(client,filters,fakeAuthContext('manager'))).activity?.audits).toMatchObject({ providerCalls: 2, retried: 1, fallback: 1, tokens: 140, knownCostUsd: 0.13 });
  });
  it('usage explícitamente agregado no vuelve a sumar los intentos', async () => {
    await caseRow(); await audit();
    await db.query('UPDATE audits SET provider_metadata=$1', [{ usageScope:'aggregate',usage:{ estimatedCostUSD:0.13,totalTokens:140 },openrouterAttempts:[
      {model:'m1',format:'json_schema',cost:0.03,totalTokens:40,failureCategory:'INVALID_JSON'},
      {model:'m2',format:'json_schema',cost:0.13,totalTokens:140,failureCategory:null}] }]);
    expect((await getDashboardSummary(client,filters,fakeAuthContext('manager'))).activity?.knownTotalCostUsd).toBe(0.13);
  });
  it('archivo transaccional preserva resultado, confianza y gasto antes de rearmar', async () => {
    await caseRow(); await audit(); await review(); await comparison();
    await db.query("UPDATE case_comparisons SET attempt_count=2,status='RUNNING',created_at=$1,result_json=NULL,provider_metadata=NULL", ['2026-11-02T00:00:00Z']);
    const history = await db.query<{snapshot: {result_json: {confidence:number}}}>('SELECT snapshot FROM comparison_execution_history');
    expect(history.rows[0]?.snapshot.result_json.confidence).toBe(0.8);
    expect((await getDashboardSummary(client,filters,fakeAuthContext('manager'))).activity?.comparisons).toMatchObject({ executions:1,completed:1,knownCostUsd:0.02 });
    expect((await getDashboardSummary(client,{...filters,to:'2026-11-30'},fakeAuthContext('manager'))).activity?.comparisons.executions).toBe(2);
  });
  it('casos de prueba quedan excluidos en todas las fuentes', async () => {
    await caseRow(1,true); await audit(); await review(); await comparison();
    expect((await getDashboardSummary(client,filters,fakeAuthContext('manager'))).activity?.knownTotalCostUsd).toBe(0);
    expect((await getAiQuality(client,filters)).evaluation?.rows).toEqual([]);
  });
  it('sincronizar metadatos Flokzu no crea ejecuciones', async () => {
    await caseRow(); await db.query('UPDATE cases SET flokzu_data=$1', [{academic:{campus:'Campus dos'}}]);
    expect((await getDashboardSummary(client,filters,fakeAuthContext('manager'))).activity?.audits.executions).toBe(0);
    expect((await getDashboardSummary(client,filters,fakeAuthContext('manager'))).activity?.comparisons.executions).toBe(0);
  });
  it('calibración utiliza la misma muestra y no cambia confianza original', async () => {
    await caseRow(); await audit(); await review(); await comparison('COMPLETED',false);
    const result = await getAiQuality(client,filters);
    expect(result.evaluation?.calibration[3]).toMatchObject({cases:1,evaluated:1,agreements:0,disagreements:1,declaredConfidence:0.9,observedAgreement:0,gap:0.9});
    expect(result.evaluation?.rows[0]?.originalConfidence).toBe(0.9);
  });
  it('códigos coincidentes pueden tener una discrepancia sustantiva', async () => {
    await caseRow(); await audit(); await review(11,'CHANGE'); await comparison('COMPLETED',false);
    expect((await getAiQuality(client,filters)).evaluation).toMatchObject({exactAgreements:1,exactComparisons:1,agreements:0,disagreements:1,agreementRate:0});
  });
  it('una confianza fuera de rango no se presenta como un valor original válido', async () => {
    await caseRow(); await audit(11,1,'COMPLETED',undefined,1.2);
    const result = await getAiQuality(client,{...filters,evaluation:'WITHOUT_CONFIDENCE'});
    expect(result.evaluation).toMatchObject({issued:1,withoutConfidence:1});
    expect(result.confidence.avgConfidence).toBeNull();
  });
  it('pendientes de evaluación se consultan como un indicador sin mezclar finalizados', async () => {
    await caseRow(); await audit();
    expect((await getAiQuality(client,{...filters,evaluation:'PENDING_EVALUATION'})).evaluation?.pendingEvaluation).toBe(1);
    await review(11,'CHANGE');
    expect((await getAiQuality(client,{...filters,evaluation:'PENDING_EVALUATION'})).evaluation?.rows).toEqual([]);
  });

  it('el origen del dictamen prevalece sobre una proyección desactualizada; null sigue siendo desconocido', async () => {
    await caseRow(); await audit(); await db.exec("UPDATE cases SET country='CO'");
    await db.query('UPDATE audits SET result_json=result_json || $1::jsonb',[{origin:{country:'MX',channel:null}}]);
    expect((await getAiQuality(client,{...filters,country:'MX'})).evaluation?.issued).toBe(1);
    expect((await getAiQuality(client,{...filters,country:'CO'})).evaluation?.issued).toBe(0);
    await db.query('UPDATE audits SET result_json=result_json || $1::jsonb',[{origin:{country:null,channel:null}}]);
    expect((await getAiQuality(client,{...filters,country:'CO'})).evaluation?.issued).toBe(0);
  });

});



