// Phase 7 local E2E smoke — NON_PRODUCTION_VALIDATION.
// Requires the local Next dev server at NEXT_PUBLIC_APP_URL (default localhost:3000).
// Tokens are kept in memory and never printed.
import { createClient } from '@insforge/sdk';
import { createHash } from 'node:crypto';

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
const anonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
const email = process.env.PHASE7_E2E_EMAIL;
const password = process.env.PHASE7_E2E_PASSWORD;

if (!baseUrl || !anonKey || !email || !password) {
  console.error('Missing env: NEXT_PUBLIC_INSFORGE_URL, NEXT_PUBLIC_INSFORGE_ANON_KEY, PHASE7_E2E_EMAIL, PHASE7_E2E_PASSWORD');
  process.exit(1);
}

const client = createClient({ baseUrl, anonKey, retryCount: 0 });

async function requestJson(path, init = {}) {
  const response = await fetch(`${appUrl}${path}`, {
    ...init,
    headers: {
      cookie: `insforge_access_token=${accessToken}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  return { status: response.status, body };
}

async function requestBytes(path) {
  const response = await fetch(`${appUrl}${path}`, {
    headers: { cookie: `insforge_access_token=${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`GET ${path} -> ${response.status}: ${await response.text()}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

const signIn = await client.auth.signInWithPassword({ email, password });
if (signIn.error || !signIn.data?.accessToken) {
  console.error('SIGNIN_FAILED', signIn.error?.statusCode, signIn.error?.message);
  process.exit(1);
}
const accessToken = signIn.data.accessToken;

const synthetic = await requestJson('/api/dev/synthetic-case', { method: 'POST', body: '{}' });
const auditId = synthetic.body.auditId;
const evidenceIds = synthetic.body.evidenceIds ?? [];

await requestJson(`/api/audits/${auditId}/human-review`, {
  method: 'POST',
  body: JSON.stringify({ decisionType: 'APPROVE', humanReason: 'Validacion sintetica Phase 7 NON_PRODUCTION_VALIDATION.' }),
});
await requestJson(`/api/audits/${auditId}/evidence-selection`, {
  method: 'PUT',
  body: JSON.stringify({ evidenceIds }),
});
const snapshot = await requestJson(`/api/audits/${auditId}/report-snapshot`, { method: 'POST', body: '{}' });
const draft = await requestJson(`/api/audits/${auditId}/dictamen/draft`, { method: 'POST', body: '{}' });
const approve = await requestJson(`/api/audits/${auditId}/dictamen/approve`, { method: 'POST', body: '{}' });
const final = await requestJson(`/api/audits/${auditId}/dictamen/final`, { method: 'POST', body: '{}' });
const finalBytes = await requestBytes(`/api/audits/${auditId}/dictamen/${final.body.document.id}/download`);

console.log(JSON.stringify({
  ok: true,
  validation: 'NON_PRODUCTION_VALIDATION',
  auditId,
  factRunId: synthetic.body.factRunId,
  engineRunId: synthetic.body.engineRunId,
  evidenceCount: evidenceIds.length,
  snapshotStatus: snapshot.body.snapshot.status,
  approvedStatus: approve.body.snapshot.status,
  draftGenerated: draft.body.generated,
  finalGenerated: final.body.generated,
  finalDocumentId: final.body.document.id,
  finalBytes: finalBytes.length,
  finalSha256: createHash('sha256').update(finalBytes).digest('hex'),
}));
