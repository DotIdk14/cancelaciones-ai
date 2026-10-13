import type { InsForgeClient } from './insforge.js';

/** Nombres de responsables asignados; los filtros conservan el identificador real. */
export async function responsibleNames(client: InsForgeClient, values: Array<string | null>): Promise<Record<string, string>> {
  const ids = [...new Set(values.filter((value): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)))];
  const names: Record<string, string> = {};
  for (let offset = 0; offset < ids.length; offset += 10) {
    await Promise.all(ids.slice(offset, offset + 10).map(async id => {
      try {
        const { data } = await client.auth.getProfile(id);
        const profile = data as { name?: unknown; profile?: { name?: unknown } | null } | null;
        const name = profile?.name ?? profile?.profile?.name;
        if (typeof name === 'string' && name.trim()) names[id] = name.trim().slice(0, 200);
      } catch { /* El identificador sigue siendo consultable si el perfil no está disponible. */ }
    }));
  }
  return names;
}
