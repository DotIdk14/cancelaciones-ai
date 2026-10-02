// Helper: getHumanReviewInput implementation extracted to its own file for clarity.
// This file is programmatically created by the assistant during the fix and
// should be imported where needed. If the project prefers a single-file
// layout, move the function back into src/server/dashboard.ts.

import type { InsForgeClient } from './insforge.js';
import { startOfDayUtc, endOfDayUtc } from './dashboard-filters.js';
import { DASHBOARD_MAX_ROWS, applyDimensionFilters } from './dashboard.js';
import type { DashboardFilters, ComparisonMetricRow, HumanReviewInput } from './dashboard.js';
import { mapProviderError } from './http.js';

export async function getHumanReviewInput(
  client: InsForgeClient,
  filters: DashboardFilters,
): Promise<HumanReviewInput> {
  const fromIso = startOfDayUtc(filters.from);
  const toIso = endOfDayUtc(filters.to);

  // Consulta de comparaciones (la fuente principal de la parte humana).
  let q = client.database
    .from('case_comparisons_dashboard_metrics')
    .select('*', { count: 'exact' })
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .order('created_at', { ascending: true })
    .limit(DASHBOARD_MAX_ROWS);

  if (filters.result !== null) q = q.eq('audit_result', filters.result);
  if (filters.status !== null) q = q.eq('case_status', filters.status);
  q = applyDimensionFilters(q, filters);

  const { data: compsData, error: compsError, count: compsCount } = await q;
  if (compsError) throw mapProviderError(compsError);
  const comparisons = (compsData ?? []) as ComparisonMetricRow[];
  const comparisonsAvailable = compsCount ?? comparisons.length;

  // Conteo de revisiones humanas registradas dentro del periodo. Solo pedimos
  // `id,case_id` y NUNCA `*`: `case_reviews.comment` es texto libre escrito por una
  // persona y puede contener PII; aquí solo hace falta contar. `case_id` permite
  // acotar por ownership (y por rol `coordinator`) sin arrastrar el comentario.
  const { data: reviewsData, error: reviewsError } = await client.database
    .from('case_reviews')
    .select('id,case_id')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .limit(DASHBOARD_MAX_ROWS);
  if (reviewsError) throw mapProviderError(reviewsError);
  const reviewsInRange = (reviewsData ?? []) as Array<{ id: string }>;
  const reviewIdsInRange = new Set(reviewsInRange.map((r) => r.id));

  // Las revisiones contadas son las del periodo MÁS las revisiones referenciadas
  // por comparaciones que cayeron en el periodo aunque la revisión misma esté
  // fuera de él.
  const comparisonReviewIds = new Set(comparisons.map((c) => c.case_review_id).filter(Boolean));
  let reviewedCases = reviewIdsInRange.size;
  for (const id of comparisonReviewIds) {
    if (!reviewIdsInRange.has(id)) reviewedCases += 1;
  }

  return { reviewedCases, comparisons, comparisonsAvailable };
}
