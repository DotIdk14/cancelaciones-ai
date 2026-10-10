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

export function getLocalDashboardPreviewSummary(filters: DashboardFilters): DashboardSummary {
  return {
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

  return {
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
  return {
    generatedAt: new Date().toISOString(),
    truncated: false,
    filters,
    humanReview: {
      available: true,
      message: 'Esta vista previa usa datos ficticios; no se consultaron revisiones reales.',
      reviewedCases: 5,
      comparableReviews: 5,
      completedComparisons: 5,
      pendingComparisons: 0,
      failedComparisons: 0,
      agreements: 3,
      disagreements: 2,
      agreementRate: 0.6,
      avgComparisonConfidence: 0.78,
      discrepancies: [
        { caseId: 'demo-case-005', aiResolution: 'CANCELACION_VENTA', humanResolution: 'BAJA', createdAt: '2026-09-20T12:00:00.000Z' },
        { caseId: 'demo-case-007', aiResolution: 'EVIDENCIA_INSUFICIENTE', humanResolution: 'CANCELACION_VENTA_PETICION_CLIENTE', createdAt: '2026-09-18T12:00:00.000Z' },
      ],
      discrepanciesTruncated: false,
    },
    confidence: {
      auditedCases: 25,
      avgConfidence: 0.81,
      bands: [
        { band: 'ALTA', label: 'Alta', count: 12, pct: 0.48 },
        { band: 'MEDIA', label: 'Media', count: 9, pct: 0.36 },
        { band: 'BAJA', label: 'Baja', count: 4, pct: 0.16 },
      ],
      confidenceByMissingEvidence: [
        { bucket: '0', label: 'Sin evidencia faltante', count: 17, avgConfidence: 0.87 },
        { bucket: '1', label: '1 evidencia faltante', count: 5, avgConfidence: 0.68 },
        { bucket: '2+', label: '2 o más evidencias faltantes', count: 3, avgConfidence: 0.53 },
      ],
    },
  };
}

export function getLocalDashboardPreviewFilterOptions(): DashboardFilterOptions {
  return EMPTY_DASHBOARD_FILTER_OPTIONS;
}
