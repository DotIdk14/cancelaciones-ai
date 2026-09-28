import type { DatabaseClient } from './client';

export async function sweepStaleOperations(database: DatabaseClient, now = new Date()): Promise<unknown> {
  if (!database.rpc) throw new Error('La base no soporta RPC sweep_stale_operations.');
  const { data, error } = await database.rpc('sweep_stale_operations', { p_now: now.toISOString() });
  if (error) throw new Error(error.message ?? 'No se pudo ejecutar sweep_stale_operations.');
  return data;
}
