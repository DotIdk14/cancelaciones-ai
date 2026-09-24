import { NextResponse } from 'next/server';
import { getInsForgeEnv } from '@/server/config/env';
import { createInsForgeServerClient } from '@/server/insforge/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const env = getInsForgeEnv();
  const client = await createInsForgeServerClient();
  const { error } = await client.database.from('audits').select('id').limit(1);

  if (error) {
    return NextResponse.json({ ok: false, service: 'insforge', message: 'No fue posible consultar la base de datos.' }, { status: 503 });
  }

  return NextResponse.json({ ok: true, service: 'insforge', baseUrl: env.NEXT_PUBLIC_INSFORGE_URL });
}
