import type { QualityCase, QualityEvaluation, ActivityMetrics } from './dashboard-metrics-contracts';
import type {
  AiCostsReport,
  DashboardFilterOptions,
  DashboardFilters,
  DashboardSummary,
  QualityReport,
} from './dashboard';
import { EMPTY_DASHBOARD_FILTER_OPTIONS, EXECUTION_OUTCOMES } from './dashboard';

export function isLocalDashboardPreview(
  search: string = typeof window === 'undefined' ? '' : window.location.search,
  development: boolean = import.meta.env.DEV,
): boolean {
  return development && new URLSearchParams(search).get('preview') === 'dashboard';
}

function previewActivity(): import('./dashboard-metrics-contracts').MonthlyActivity {
  const audits: ActivityMetrics = { executions: 31, completed: 25, failed: 3, running: 3, uniqueCases: 27, reaudits: 4,
    retried: 5, fallback: 2, providerCalls: 34, executionsWithoutCallTrace: 2, tokens: 182400,
    executionsWithoutTokenTrace: 2, knownCostUsd: 0.82, executionsWithUnknownCost: 3,
    avgKnownCostPerExecutionUsd: null, avgKnownCostPerCaseUsd: null };
  const comparisons: ActivityMetrics = { executions: 8, completed: 5, failed: 2, running: 1, uniqueCases: 6, reaudits: 0,
    retried: 2, fallback: 1, providerCalls: 10, executionsWithoutCallTrace: 0, tokens: 21400,
    executionsWithoutTokenTrace: 1, knownCostUsd: 0.14, executionsWithUnknownCost: 1,
    avgKnownCostPerExecutionUsd: null, avgKnownCostPerCaseUsd: null };
  return { timezone: 'UTC', audits, comparisons, knownTotalCostUsd: 0.96, unknownCostExecutions: 4, estimatedCostUsd: null };
}

function previewEvaluation(filters: DashboardFilters): QualityEvaluation {
  const rows: QualityCase[] = ['AGREEMENT', 'DISAGREEMENT', 'PENDING_ADVISOR', 'PENDING_COORDINATOR', 'PENDING_COMPARISON', 'COMPARISON_RUNNING', 'COMPARISON_ERROR', 'AUDIT_ERROR', 'AUDIT_RUNNING'].map((state, index) => {
    const issued = index < 7;
    const final = [0, 1, 4, 5, 6].includes(index);
    return { caseId: `demo-case-${index + 1}`, auditId: `demo-audit-${index + 1}`, identifier: `CaVe-${101 + index}`,
      responsible: index % 2 ? 'Asesor de demostración B' : 'Asesor de demostración A', auditedAt: `${filters.from}T12:00:00.000Z`,
      aiResolution: issued ? 'CANCELACION_VENTA' : null, originalConfidence: issued && index !== 2 ? [0.94, 0.96, 0, 0.72, 0.81, 0.88, 0.65][index]! : null,
      advisorResolution: issued && index !== 2 ? 'CANCELACION_VENTA' : null,
      finalResolution: final ? index === 1 ? 'BAJA' : 'CANCELACION_VENTA' : null,
      comparisonId: [0, 1, 5, 6].includes(index) ? `demo-comparison-${index}` : null,
      comparisonConfidence: index < 2 ? 0.85 : null, substantiveAgreement: index === 0 ? true : index === 1 ? false : null,
      exactAgreement: final ? index !== 1 : null, state: state as QualityCase['state'], country: 'MX', campus: 'Campus de demostración', guideline: 'V5' };
  }).filter(row => ['country','campus','responsible','guideline'].every(key => !filters[key as keyof DashboardFilters] || filters[key as keyof DashboardFilters] === row[key as 'country' | 'campus' | 'responsible' | 'guideline'])).filter(row => !filters.result || row.aiResolution === filters.result).filter(row => !filters.evaluation || filters.evaluation === row.state ||
    (filters.evaluation === 'WITHOUT_CONFIDENCE' && row.aiResolution !== null && row.originalConfidence === null) ||
    (filters.evaluation === 'PENDING_EVALUATION' && row.aiResolution !== null && row.finalResolution === null) || (filters.evaluation === 'ISSUED' && row.aiResolution !== null) || (filters.evaluation === 'FINALIZED' && row.finalResolution !== null));
  const issued = rows.filter(row => row.aiResolution !== null);
  const final = rows.filter(row => row.finalResolution !== null);
  const evaluated = rows.filter(row => row.substantiveAgreement !== null);
  const agreements = evaluated.filter(row => row.substantiveAgreement).length;
  return { issued: issued.length, finalized: final.length, validComparisons: evaluated.length, agreements,
    disagreements: evaluated.length - agreements, pendingEvaluation: issued.length - final.length,
    failedComparisons: rows.filter(row => row.state === 'COMPARISON_ERROR').length,
    technicalErrors: rows.filter(row => row.state === 'AUDIT_ERROR').length, runningAudits: rows.filter(row => row.state === 'AUDIT_RUNNING').length,
    withoutConfidence: issued.filter(row => row.originalConfidence === null).length,
    agreementRate: evaluated.length ? agreements / evaluated.length : null, coverageRate: issued.length ? evaluated.length / issued.length : null,
    exactAgreements: final.filter(row => row.exactAgreement).length, exactComparisons: final.length,
    rows, historicalVersions: rows.length, historicalRows: rows,
    calibration: [{band:'0–49 %',min:0,max:0.5},{band:'50–69 %',min:0.5,max:0.7},{band:'70–89 %',min:0.7,max:0.9},{band:'90–100 %',min:0.9,max:1.01}].map(band => {
      const cases = issued.filter(row => row.originalConfidence !== null && row.originalConfidence >= band.min && row.originalConfidence < band.max);
      const sample = cases.filter(row => row.substantiveAgreement !== null);
      const agreed = sample.filter(row => row.substantiveAgreement).length;
      const declaredConfidence = sample.length ? sample.reduce((sum,row) => sum + row.originalConfidence!,0) / sample.length : null;
      const observedAgreement = sample.length ? agreed / sample.length : null;
      return {band:band.band,cases:cases.length,evaluated:sample.length,agreements:agreed,disagreements:sample.length-agreed,
        declaredConfidence,observedAgreement,gap:declaredConfidence === null || observedAgreement === null ? null : declaredConfidence-observedAgreement};
    }) };
}

export function getLocalDashboardPreviewSummary(filters: DashboardFilters): DashboardSummary {
  return {
    activity: previewActivity(),
    generatedAt: new Date().toISOString(),
    truncated: false,
    filters,
    kpi: {
      auditedCases: 28,
      casesWithMissingEvidence: 8,
      casesWithMissingEvidencePct: 28.6,
      granted: 12,
      grantedPct: 42.9,
      needsRuling: 7,
      needsRulingPct: 25,
      rejected: 3,
      rejectedPct: 10.7,
      insufficient: 3,
      insufficientPct: 10.7,
      errors: 3,
      errorsPct: 10.7,
    },
    timeline: [
      { bucket: '2026-09-07', granted: 2, needsRuling: 1, rejected: 0, insufficient: 1 },
      { bucket: '2026-09-14', granted: 3, needsRuling: 2, rejected: 1, insufficient: 0 },
      { bucket: '2026-09-21', granted: 2, needsRuling: 1, rejected: 1, insufficient: 1 },
      { bucket: '2026-09-28', granted: 5, needsRuling: 3, rejected: 1, insufficient: 1 },
    ],
    split: [
      { group: 'CONCEDIDAS', count: 12 },
      { group: 'REQUIERE_DICTAMINACION', count: 7 },
      { group: 'RECHAZADOS', count: 3 },
      { group: 'EVIDENCIA_INSUFICIENTE', count: 3 },
    ],
    byResult: [
      { result: 'CANCELACION_VENTA', count: 5 },
      { result: 'CANCELACION_VENTA_PETICION_CLIENTE', count: 3 },
      { result: 'BAJA', count: 2 },
      { result: 'CANCELACION_VENTA_OPERATIVA', count: 1 },
      { result: 'CANCELACION_MATRICULA', count: 1 },
      { result: 'DICTAMINACION', count: 7 },
      { result: 'TICKET_RECHAZADO', count: 3 },
      { result: 'EVIDENCIA_INSUFICIENTE', count: 3 },
    ],
    byCountry: {
      points: [
        { value: 'MX', label: 'México', count: 14 },
        { value: 'CO', label: 'Colombia', count: 6 },
        { value: 'Sin determinar', label: 'Sin determinar', count: 5 },
      ],
      totalWithOrigin: 20,
    },
    byChannel: {
      points: [
        { value: 'WHATSAPP', label: 'WhatsApp', count: 11 },
        { value: 'CRM', label: 'CRM', count: 6 },
        { value: 'EMAIL', label: 'Correo electrónico', count: 3 },
        { value: 'Sin determinar', label: 'Sin determinar', count: 5 },
      ],
      totalWithOrigin: 20,
    },
    recentCases: [
      {
        caseId: 'demo-case-001',
        shortId: 'DEMO-001',
        result: 'CANCELACION_VENTA',
        confidence: 0.94,
        missingEvidenceCount: 0,
        caseStatus: 'COMPLETED',
        date: '2026-10-02T14:20:00.000Z',
        country: 'MX',
        channel: 'WHATSAPP',
      },
      {
        caseId: 'demo-case-002',
        shortId: 'DEMO-002',
        result: 'DICTAMINACION',
        confidence: 0.72,
        missingEvidenceCount: 1,
        caseStatus: 'COMPLETED',
        date: '2026-10-01T17:10:00.000Z',
        country: 'CO',
        channel: 'CRM',
      },
      {
        caseId: 'demo-case-003',
        shortId: 'DEMO-003',
        result: 'EVIDENCIA_INSUFICIENTE',
        confidence: 0.48,
        missingEvidenceCount: 2,
        caseStatus: 'COMPLETED',
        date: '2026-09-30T15:45:00.000Z',
        country: null,
        channel: null,
      },
    ],
    execution: {
      byOutcome: EXECUTION_OUTCOMES.map((outcome) => ({
        outcome,
        count:
          outcome === 'SUCCESS_FIRST_ATTEMPT'
            ? 21
            : outcome === 'SUCCESS_AFTER_RETRY'
              ? 3
              : outcome === 'SUCCESS_WITH_FALLBACK'
                ? 1
                : 3,
      })),
      succeeded: 25,
      failed: 3,
      total: 28,
      withFallback: 1,
    },
    agreement: {
      available: false,
      reason: 'NO_HUMAN_REVIEWS',
      agreementPct: null,
      totalHumanReviewed: 0,
      matched: 0,
      mismatched: 0,
      mismatches: [],
    },
    cost: {
      totalCostUsd: 0.5,
      avgCostPerCaseUsd: 0.0179,
      casesWithCost: 28,
      costAvailable: true,
    },
  };
}

export function getLocalDashboardPreviewCosts(
  filters: DashboardFilters,
  granularity: AiCostsReport['granularity'],
): AiCostsReport {
  const buckets = granularity === 'month'
    ? [
        { bucket: '2026-09', costUsd: 0.38 },
        { bucket: '2026-10', costUsd: 0.12 },
      ]
    : granularity === 'week'
      ? [
          { bucket: '2026-W39', costUsd: 0.21 },
          { bucket: '2026-W40', costUsd: 0.29 },
        ]
      : [
          { bucket: '2026-09-28', costUsd: 0.08 },
          { bucket: '2026-09-29', costUsd: 0.11 },
          { bucket: '2026-09-30', costUsd: 0.09 },
          { bucket: '2026-10-01', costUsd: 0.13 },
          { bucket: '2026-10-02', costUsd: 0.09 },
        ];

  const activity = previewActivity();
  activity.audits = { ...activity.audits, executions: 28, completed: 25, failed: 3, running: 0,
    uniqueCases: 28, knownCostUsd: 0.5, costReportedExecutions: 28, executionsWithUnknownCost: 0,
    tokens: 428600, executionsWithoutTokenTrace: 0, avgKnownCostPerExecutionUsd: 0.5 / 28, avgKnownCostPerCaseUsd: 0.5 / 28 };
  activity.comparisons = { executions: 0, completed: 0, failed: 0, running: 0, uniqueCases: 0,
    reaudits: 0, retried: 0, fallback: 0, providerCalls: 0, executionsWithoutCallTrace: 0,
    tokens: 0, executionsWithoutTokenTrace: 0, knownCostUsd: 0, costReportedExecutions: 0, executionsWithUnknownCost: 0,
    avgKnownCostPerExecutionUsd: null, avgKnownCostPerCaseUsd: null };
  activity.knownTotalCostUsd = 0.5;
  activity.unknownCostExecutions = 0;
  activity.series = buckets.map((point, index) => {
    const audits = Math.floor(28 / buckets.length) + (index < 28 % buckets.length ? 1 : 0);
    const date = new Date(`${filters.from}T00:00:00Z`);
    const end = new Date(`${filters.to}T00:00:00Z`);
    date.setTime(Math.min(end.getTime(), date.getTime() + index * 86400000));
    if (granularity === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    return { bucket: date.toISOString().slice(0, granularity === 'month' ? 7 : 10),
      audits, completed: Math.floor(25 / buckets.length) + (index < 25 % buckets.length ? 1 : 0), comparisons: 0,
      tokens: Math.floor(428600 / buckets.length), knownCostUsd: point.costUsd,
      unknownCostExecutions: 0, avgCostPerAuditUsd: point.costUsd / audits };
  });
  const grouped = new Map<string, NonNullable<typeof activity.series>[number]>();
  for (const point of activity.series) {
    const previous = grouped.get(point.bucket);
    if (!previous) grouped.set(point.bucket, { ...point });
    else {
      previous.audits += point.audits; previous.completed += point.completed;
      previous.tokens = (previous.tokens ?? 0) + (point.tokens ?? 0);
      previous.knownCostUsd = (previous.knownCostUsd ?? 0) + (point.knownCostUsd ?? 0);
      previous.avgCostPerAuditUsd = previous.knownCostUsd / previous.audits;
    }
  }
  activity.series = [...grouped.values()];
  return {
    activity,
    generatedAt: new Date().toISOString(),
    truncated: false,
    filters,
    granularity,
    kpi: {
      totalCostUsd: 0.5,
      avgCostPerCaseUsd: 0.0179,
      totalTokens: 428600,
      promptTokens: 361200,
      completionTokens: 67400,
      avgLatencyMs: 18200,
      p50LatencyMs: 16400,
      p95LatencyMs: 29100,
      auditsCounted: 28,
      casesCounted: 28,
      costAvailable: true,
      tokensAvailable: true,
      latencyAvailable: true,
    },
    costSeries: buckets,
    byModel: [
      { model: 'openai/gpt-4.1-mini', calls: 24, totalCostUsd: 0.36, avgCostUsd: 0.015, costKnownCalls: 24 },
      { model: 'google/gemini-2.5-flash', calls: 4, totalCostUsd: 0.14, avgCostUsd: 0.035, costKnownCalls: 4 },
    ],
    reliability: {
      successful: 25,
      retried: 4,
      fallback: 2,
      failed: 3,
      executionOutcomes: {
        available: true,
        successfulFirstAttempt: 21,
        successfulAfterRetry: 3,
        fallback: 1,
        failed: 3,
        inProgress: 0,
      },
    },
  };
}

export function getLocalDashboardPreviewQuality(filters: DashboardFilters): QualityReport {
  const evaluation = previewEvaluation(filters);
  const withConfidence = evaluation.rows.filter(row => row.originalConfidence !== null);
  const bands = [{band:'ALTA' as const,label:'Alta',min:0.85,max:1.01},{band:'MEDIA' as const,label:'Media',min:0.6,max:0.85},{band:'BAJA' as const,label:'Baja',min:0,max:0.6}].map(band => {
    const count = withConfidence.filter(row => row.originalConfidence! >= band.min && row.originalConfidence! < band.max).length;
    return {band:band.band,label:band.label,count,pct:withConfidence.length ? 100 * count / withConfidence.length : 0};
  });

  return {
    evaluation,
    generatedAt: new Date().toISOString(),
    truncated: false,
    filters,
    humanReview: {
      available: true,
      message: 'Esta vista previa usa datos ficticios; no se consultaron revisiones reales.',
      reviewedCases: evaluation.finalized,
      comparableReviews: evaluation.validComparisons,
      completedComparisons: evaluation.validComparisons,
      pendingComparisons: 0,
      failedComparisons: 0,
      agreements: evaluation.agreements,
      disagreements: evaluation.disagreements,
      agreementRate: evaluation.agreementRate,
      avgComparisonConfidence: evaluation.validComparisons ? 0.85 : null,
      discrepancies: [
        { caseId: 'demo-case-005', aiResolution: 'CANCELACION_VENTA', humanResolution: 'BAJA', createdAt: '2026-09-20T12:00:00.000Z' },
        { caseId: 'demo-case-007', aiResolution: 'EVIDENCIA_INSUFICIENTE', humanResolution: 'CANCELACION_VENTA_PETICION_CLIENTE', createdAt: '2026-09-18T12:00:00.000Z' },
      ],
      discrepanciesTruncated: false,
    },
    confidence: {
      auditedCases: withConfidence.length,
      avgConfidence: withConfidence.length ? withConfidence.reduce((sum,row) => sum + row.originalConfidence!,0) / withConfidence.length : null,
      bands, confidenceByMissingEvidence: [],
    },
  };
}

export function getLocalDashboardPreviewFilterOptions(): DashboardFilterOptions {
  return {...EMPTY_DASHBOARD_FILTER_OPTIONS, country:['MX'],campus:['Campus de demostración'],guideline:['V5'],responsible:['Asesor de demostración A','Asesor de demostración B']};
}
