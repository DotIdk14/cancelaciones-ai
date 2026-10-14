import type { ManualCaseMatch, ImportLinkResolution } from '../shared/case-links.js';
import { assignmentError } from './case-assignment.js';
import { assertFlokzuCoordinator, decideFlokzuTicket } from './flokzu-review.js';
import { resolveFlokzuEligibility, type FlokzuClassification, type FlokzuReviewState } from '../shared/flokzu-review.js';
import type { InsForgeClient } from './insforge.js';
import type { AuthContext } from './auth.js';
import { ApiError, mapProviderError } from './http.js';
import { parseFlokzuWorkbook, type ParsedFlokzuRow } from './flokzu-parser.js';

interface ImportedCaseRow {
  id: string;
  external_case_id: string;
  student_identifier: string | null;
  student_name: string | null;
  flokzu_data: unknown;
  flokzu_review_state: FlokzuReviewState;
  flokzu_classification: FlokzuClassification;
  flokzu_audit_eligible: boolean;
  assigned_to: string | null;
}

interface ImportBatchRow {
  id: string;
  imported_by: string;
  status: 'PREVIEWED' | 'COMPLETED';
  total_rows: number;
  valid_rows: number;
  new_rows: number;
  changed_rows: number;
  unchanged_rows: number;
  error_rows: number;
  issues: unknown;
  preview_assignments: unknown;
  result_json: unknown;
  created_at: string;
  completed_at: string | null;
}

export interface FlokzuPreviewRow {
  rowNumber: number;
  externalCaseId: string;
  studentIdentifier: string;
  studentName: string;
  action: 'NEW' | 'UPDATE' | 'UNCHANGED';
  manualMatch?: ManualCaseMatch;
  assignmentUserId: string | null;
  assignmentName: string | null;
  canAutoAssign: boolean;
  classification: FlokzuClassification;
  reason: string;
  previousStatus: string | null;
  nextStatus: string | null;
  previousTask: string | null;
  nextTask: string | null;
  previousFinalized: string | null;
  nextFinalized: string | null;
}

export interface FlokzuPreview {
  batchId: string;
  exportedAt: string | null;
  totalRows: number;
  validRows: number;
  newRows: number;
  changedRows: number;
  unchangedRows: number;
  errorRows: number;
  unassignedRows: number;
  activeRows: number;
  administrativeRows: number;
  issues: Array<{ rowNumber: number; externalCaseId: string | null; message: string }>;
  assignments: Array<{ userId: string; name: string | null; count: number }>;
  rows: FlokzuPreviewRow[];
}

function databaseError(error: unknown): never {
  throw mapProviderError(error, 'DATABASE_ERROR');
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(',')}}`;
}

function normalizedComparable(row: Pick<ParsedFlokzuRow, 'studentIdentifier' | 'studentName' | 'flokzuData'>): string {
  return stableJson({ student_identifier: row.studentIdentifier, student_name: row.studentName, flokzu_data: row.flokzuData });
}

export function distributeFlokzuAssignments(
  rows: Array<Pick<ParsedFlokzuRow, 'externalCaseId' | 'eligibleForAuditAssignment'>>,
  eligibleUserIds: string[],
  initialLoad: Map<string, number>,
): Map<string, string> {
  const assignments = new Map<string, string>();
  const load = new Map(eligibleUserIds.map((userId) => [userId, initialLoad.get(userId) ?? 0]));
  for (const row of rows) {
    if (!row.eligibleForAuditAssignment) continue;
    const chosen = [...load.entries()].sort(([idA, countA], [idB, countB]) => countA - countB || idA.localeCompare(idB))[0];
    if (!chosen) continue;
    assignments.set(row.externalCaseId, chosen[0]);
    load.set(chosen[0], chosen[1] + 1);
  }
  return assignments;
}

export async function createFlokzuPreview(
  client: InsForgeClient,
  actor: AuthContext,
  fileBuffer: Buffer,
): Promise<FlokzuPreview> {
  assertFlokzuCoordinator(actor);
  const parsed = await parseFlokzuWorkbook(fileBuffer);
  const identifiers = [...new Set(parsed.rows.map((row) => row.externalCaseId))];
  const existingByExternalId = new Map<string, ImportedCaseRow>();
  for (let offset = 0; offset < identifiers.length; offset += 100) {
    const { data, error } = await client.database.from('cases')
      .select('id,external_case_id,student_identifier,student_name,flokzu_data,flokzu_review_state,flokzu_classification,flokzu_audit_eligible,assigned_to')
      .eq('external_source', 'FLOKZU')
      .in('external_case_id', identifiers.slice(offset, offset + 100));
    if (error) databaseError(error);
    for (const row of (data as ImportedCaseRow[] | null) ?? []) existingByExternalId.set(row.external_case_id, row);
  }

  const { data: matchData, error: matchError } = await client.database.rpc('get_flokzu_manual_matches', { p_rows: parsed.rows });
  if (matchError) databaseError(matchError);
  if (!matchData || typeof matchData !== 'object' || Array.isArray(matchData)) throw new ApiError(503, 'DATABASE_ERROR', 'No se pudieron verificar coincidencias de expedientes.');
  const manualMatches = matchData as Record<string, ManualCaseMatch>;
  const previewRows: FlokzuPreviewRow[] = [];
  const actionCounts = { NEW: 0, UPDATE: 0, UNCHANGED: 0 };
  const routableRows = parsed.rows.filter(row => {
    const existing = existingByExternalId.get(row.externalCaseId);
    const match = manualMatches[row.externalCaseId];
    if (match?.requiresSelection || match?.candidates.find(c => c.id === match.linkCaseId)?.assignedTo) return false;
    return row.eligibleForAuditAssignment && !existing?.assigned_to && (!existing || existing.flokzu_review_state === 'OPEN');
  });
  const newRoutable = routableRows;
  const usersResult = await client.database.from('app_memberships').select('user_id,role').eq('role', 'user').order('user_id', { ascending: true });
  if (usersResult.error) databaseError(usersResult.error);
  const eligible = ((usersResult.data as Array<{ user_id: string; role: string }> | null) ?? []).map((row) => row.user_id);
  const userNames = new Map<string, string | null>();
  await Promise.all(eligible.map(async (userId) => {
    try {
      const { data } = await client.auth.getProfile(userId);
      const profile = data as { name?: unknown; profile?: { name?: unknown } | null } | null;
      const name = profile?.name ?? profile?.profile?.name;
      userNames.set(userId, typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : null);
    } catch {
      userNames.set(userId, null);
    }
  }));
  const load = new Map(eligible.map((userId) => [userId, 0]));
  if (eligible.length > 0) {
    for (let offset = 0; offset < eligible.length; offset += 100) {
      const { data, error } = await client.database.from('cases').select('assigned_to')
        .in('assigned_to', eligible.slice(offset, offset + 100)).neq('status', 'COMPLETED').eq('flokzu_audit_eligible', true);
      if (error) databaseError(error);
      for (const row of (data as Array<{ assigned_to: string }> | null) ?? []) {
        load.set(row.assigned_to, (load.get(row.assigned_to) ?? 0) + 1);
      }
    }
  }

  const assignedPreview = distributeFlokzuAssignments(routableRows, eligible, load);

  const stagedRows: Array<ParsedFlokzuRow & { actionAtPreview: 'NEW' | 'UPDATE' | 'UNCHANGED'; manualMatch?: ManualCaseMatch }> = [];
  for (const row of parsed.rows) {
    const existing = existingByExternalId.get(row.externalCaseId);
    const action = !existing ? 'NEW' : normalizedComparable(row) === stableJson({
      student_identifier: existing.student_identifier,
      student_name: existing.student_name,
      flokzu_data: existing.flokzu_data,
    }) ? 'UNCHANGED' : 'UPDATE';
    actionCounts[action] += 1;
    const manualMatch = manualMatches[row.externalCaseId];
    const assignmentUserId = existing?.assigned_to ?? manualMatch?.candidates.find(c => c.id === manualMatch.linkCaseId)?.assignedTo ?? assignedPreview.get(row.externalCaseId) ?? null;
    const old = existing?.flokzu_data as ParsedFlokzuRow['flokzuData'] | undefined;
    previewRows.push({
      manualMatch,
      rowNumber: row.rowNumber,
      externalCaseId: row.externalCaseId,
      studentIdentifier: row.studentIdentifier,
      studentName: row.studentName,
      action,
      assignmentUserId,
      assignmentName: assignmentUserId ? userNames.get(assignmentUserId) ?? null : null,
      canAutoAssign: resolveFlokzuEligibility(row.classification, existing?.flokzu_review_state ?? 'OPEN'),
      classification: row.classification, reason: row.classificationReason,
      previousStatus: old?.operations?.statusReported ?? null, nextStatus: row.flokzuData.operations.statusReported,
      previousTask: old?.operations?.currentTask ?? null, nextTask: row.flokzuData.operations.currentTask,
      previousFinalized: old?.operations?.finalizedReported ?? null, nextFinalized: row.flokzuData.operations.finalizedReported,
    });
    stagedRows.push({ ...row, actionAtPreview: action, ...(manualMatch ? { manualMatch } : {}) });
  }
  const assignmentCounts = new Map<string, number>();
  for (const userId of assignedPreview.values()) assignmentCounts.set(userId, (assignmentCounts.get(userId) ?? 0) + 1);
  const issues = parsed.issues;
  const { error: expireError } = await client.database.rpc('expire_flokzu_import_previews');
  if (expireError) databaseError(expireError);
  const batchInsert = await client.database.from('case_import_batches').insert([{
    imported_by: actor.sub,
    total_rows: parsed.totalDataRows,
    valid_rows: parsed.rows.length,
    new_rows: actionCounts.NEW,
    changed_rows: actionCounts.UPDATE,
    unchanged_rows: actionCounts.UNCHANGED,
    error_rows: new Set(issues.map(issue => issue.rowNumber)).size,
    issues,
    staged_rows: stagedRows,
    preview_assignments: [...assignmentCounts].map(([userId, count]) => ({ userId, count })),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }]).select('id').single();
  if (batchInsert.error || !batchInsert.data) databaseError(batchInsert.error);
  return {
    batchId: (batchInsert.data as { id: string }).id,
    exportedAt: parsed.metadata.exportedAt,
    totalRows: parsed.totalDataRows,
    validRows: parsed.rows.length,
    newRows: actionCounts.NEW,
    changedRows: actionCounts.UPDATE,
    unchangedRows: actionCounts.UNCHANGED,
    errorRows: new Set(issues.map(issue => issue.rowNumber)).size,
    activeRows: previewRows.filter(row => row.canAutoAssign).length,
    administrativeRows: previewRows.filter(row => !row.canAutoAssign).length,
    unassignedRows: newRoutable.length - assignedPreview.size,
    issues,
    assignments: [...assignmentCounts].map(([userId, count]) => ({ userId, name: userNames.get(userId) ?? null, count })),
    rows: previewRows,
  };
}

export async function confirmFlokzuImport(
  client: InsForgeClient,
  actor: AuthContext,
  batchId: string,
  resolutions: ImportLinkResolution[] = [],
): Promise<unknown> {
  assertFlokzuCoordinator(actor);
  const { data, error } = await client.database.rpc('commit_flokzu_import', { p_batch_id: batchId, p_actor: actor.sub, p_resolutions: resolutions });
  if (error) {
    const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
    if (message.includes('Importación no encontrada')) throw new ApiError(404, 'NOT_FOUND', 'Vista previa no encontrada.');
    if (message.includes('venció')) throw new ApiError(409, 'VALIDATION_ERROR', 'La vista previa venció; vuelve a subir el archivo.');
    if (message.includes('Solo un Coordinador')) throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para confirmar importaciones.');
    assignmentError(error);
  }
  return data;
}

export async function listFlokzuImportData(client: InsForgeClient, caseOffset = 0): Promise<{
  imports: Array<Record<string, unknown>>;
  assignmentOptions: Array<{ userId: string; name: string | null }>;
  cases: Array<Record<string, unknown>>;
  casesNextOffset: number | null;
}> {
  const { error: expireError } = await client.database.rpc('expire_flokzu_import_previews');
  if (expireError) databaseError(expireError);
  const [{ data, error }, { data: caseRows, error: casesError }] = await Promise.all([
    client.database.from('case_import_batches')
    .select('id,status,total_rows,valid_rows,new_rows,changed_rows,unchanged_rows,error_rows,issues,result_json,created_at,completed_at')
      .order('created_at', { ascending: false }).limit(30),
    client.database.from('cases').select('id,external_case_id,student_identifier,student_name,status,assigned_to,created_at')
      .eq('external_source', 'FLOKZU').is('merged_into_case_id', null).order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(caseOffset, caseOffset + 49),
  ]);
  if (error) databaseError(error);
  if (casesError) databaseError(casesError);
  const userIds: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data: memberRows, error: memberError } = await client.database.from('app_memberships')
      .select('user_id').eq('role', 'user').order('user_id', { ascending: true }).range(offset, offset + 99);
    if (memberError) databaseError(memberError);
    const page = (memberRows as Array<{ user_id: string }> | null) ?? [];
    userIds.push(...page.map((row) => row.user_id));
    if (page.length < 100) break;
  }
  const profileNames = new Map<string, string | null>();
  await Promise.all(userIds.map(async (userId) => {
    try {
      const { data: profileData } = await client.auth.getProfile(userId);
      const profile = profileData as { name?: unknown; profile?: { name?: unknown } | null } | null;
      const value = profile?.name ?? profile?.profile?.name;
      profileNames.set(userId, typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : null);
    } catch {
      profileNames.set(userId, null);
    }
  }));
  const casePage = (caseRows as Array<{ id: string; external_case_id: string; student_identifier: string | null; student_name: string | null; status: string; assigned_to: string | null; created_at: string }> | null) ?? [];
  return {
    imports: ((data as ImportBatchRow[] | null) ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    totalRows: row.total_rows,
    validRows: row.valid_rows,
    newRows: row.new_rows,
    changedRows: row.changed_rows,
    unchangedRows: row.unchanged_rows,
    errorRows: row.error_rows,
    issues: row.issues,
    result: row.result_json,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    })),
    assignmentOptions: userIds.map((userId) => ({ userId, name: profileNames.get(userId) ?? null })),
    cases: casePage.map((row) => ({
      id: row.id,
      externalCaseId: row.external_case_id,
      studentIdentifier: row.student_identifier,
      studentName: row.student_name,
      status: row.status,
      assignedTo: row.assigned_to,
      assignedName: row.assigned_to ? profileNames.get(row.assigned_to) ?? null : null,
      createdAt: row.created_at,
    })),
    casesNextOffset: casePage.length === 50 ? caseOffset + casePage.length : null,
  };
}

export async function assignImportedCase(
  client: InsForgeClient,
  caseId: string,
  assignedTo: string | null,
  actor: AuthContext,
): Promise<void> {
  assertFlokzuCoordinator(actor);
  if (assignedTo !== null) {
    const { data, error } = await client.database.from('app_memberships').select('user_id').eq('user_id', assignedTo).eq('role', 'user').limit(1);
    if (error) databaseError(error);
    if (!data || data.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'El responsable debe ser un Asesor activo.');
  }
  const result = await client.database.from('cases').select('flokzu_revision').eq('id', caseId).eq('external_source', 'FLOKZU').limit(1);
  if (result.error) databaseError(result.error);
  if (!result.data?.[0]) throw new ApiError(404, 'NOT_FOUND', 'Ticket no encontrado.');
  await decideFlokzuTicket(client, actor, { caseId, revision: result.data[0].flokzu_revision, action: 'REASSIGN', assignedTo });
}
