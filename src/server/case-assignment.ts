import type { InsForgeClient } from './insforge.js';
import type { AuthContext } from './auth.js';
import { capabilitiesForRole } from './capabilities.js';
import { ApiError, mapProviderError } from './errors.js';

export function assignmentError(error: unknown): never {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (code === '42501') throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para asignar expedientes.');
  if (code === 'P0002') throw new ApiError(404, 'NOT_FOUND', 'Expediente no encontrado.');
  if (code === '40001' || code === '23505') throw new ApiError(409, 'VALIDATION_ERROR', 'El expediente o su CaVe ya existe o cambió. Consulta los expedientes de esta matrícula. Si es otro trámite, confirma que es una solicitud distinta.');
  if (code === '22023') throw new ApiError(400, 'VALIDATION_ERROR', 'El responsable o la vinculación indicados no son válidos.');
  throw mapProviderError(error, 'DATABASE_ERROR');
}

export async function listAssignmentOptions(client: InsForgeClient, actor: AuthContext): Promise<Array<{ userId: string; name: string | null }>> {
  if (!capabilitiesForRole(actor.role).canImportCases) throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para asignar expedientes.');
  const { data, error } = await client.database.from('app_memberships').select('user_id').eq('role', 'user').order('user_id', { ascending: true });
  if (error) assignmentError(error);
  return Promise.all(((data as Array<{ user_id: string }> | null) ?? []).map(async ({ user_id: userId }) => {
    try {
      const { data: profile } = await client.auth.getProfile(userId);
      const value = profile as { name?: unknown; profile?: { name?: unknown } } | null;
      const name = value?.name ?? value?.profile?.name;
      return { userId, name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : null };
    } catch { return { userId, name: null }; }
  }));
}

export async function assignManualCase(client: InsForgeClient, caseId: string, assignedTo: string | null, actor: AuthContext): Promise<void> {
  if (!capabilitiesForRole(actor.role).canImportCases) throw new ApiError(403, 'AUTH_ERROR', 'No tienes permiso para asignar expedientes.');
  const { error } = await client.database.rpc('assign_manual_case', { p_case_id: caseId, p_assigned_to: assignedTo, p_actor: actor.sub });
  if (error) assignmentError(error);
}
