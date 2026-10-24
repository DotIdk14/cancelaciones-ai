import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import type { CopilotSession, MessageOptions, ModelInfo } from '@github/copilot-sdk';
import { getEnv } from '../env.js';
import { ApiError } from '../errors.js';
import { OpenRouterAuditError, type CallOpenRouterAuditInput, type CallOpenRouterAuditOutput, type OpenRouterAttemptDiagnostic } from '../openrouter.js';
import { buildProviderJsonSchema, buildJsonObjectContract } from './provider-schema.js';
import { AiAuditAssessmentSchema } from '../../skills/audit/schema.js';
import { preparedCopilotParts } from './provider.js';
import { assertCopilotParts } from './copilot-capabilities.js';
import { annotateReviewReferenceFailure, reviewOutputContract } from './review-contract.js';

/** Sin herramientas ni lectura del workspace: el modelo recibe únicamente el expediente preparado. */
export const COPILOT_SESSION_SAFETY = {
  availableTools: [] as string[], excludedTools: ['builtin:*', 'mcp:*', 'custom:*'],
  enableConfigDiscovery: false, skipCustomInstructions: true, enableSkills: false,
  enableFileHooks: false, enableHostGitOperations: false, enableSessionStore: false,
  enableOnDemandInstructionDiscovery: false, skipEmbeddingRetrieval: true,
  infiniteSessions: { enabled: false },
  autopilot: { continuationEnabled: false, maxContinues: 0 },
  hooks: { onErrorOccurred: () => ({ errorHandling: 'abort' as const, retryCount: 0 }) },
  onPermissionRequest: () => ({ kind: 'reject' as const, feedback: 'La auditoría no permite herramientas.' }),
};

/** Un único objeto íntegro; tolera cercado y cierres sobrantes al final. */
export function parseCopilotJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*)\n```$/i.exec(trimmed);
  const content = fenced ? fenced[1]!.trim() : trimmed;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  if (content.startsWith('{')) for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      // No completa valores, modifica el objeto ni admite otro mensaje.
      if (/^[}\s]*$/.test(content.slice(i + 1))) return JSON.parse(content.slice(0, i + 1));
      break;
    }
  }
  return JSON.parse(content);
}

export function copilotMessage(input: CallOpenRouterAuditInput, model: ModelInfo): MessageOptions {
  const parts = preparedCopilotParts(input.parts);
  assertCopilotParts(parts, model);
  const text: string[] = [];
  const attachments: NonNullable<MessageOptions['attachments']> = [];
  for (const part of parts) {
    if (part.type === 'text') { text.push(part.text); continue; }
    const source = part.type === 'file' ? part.file.file_data : part.image_url.url;
    const match = /^data:(image\/[a-z0-9.+-]+|application\/pdf);base64,([a-z0-9+/=\r\n]+)$/i.exec(source)!;
    const displayName = part.type === 'file' && part.file.filename === 'evidencias-visuales.pdf'
      ? 'evidencias-visuales.pdf' : `evidencia-${attachments.length + 1}${part.type === 'file' ? '.pdf' : ''}`;
    text.push(`[${part.type === 'file' ? 'PDF' : 'Imagen'} de este bloque: ${displayName}]`);
    attachments.push({ type: 'blob', data: match[2]!, mimeType: match[1]!.toLowerCase(), displayName });
  }
  // El contrato completo excede la gramática del proveedor; Zod valida el JSON.
  const contract = buildProviderJsonSchema(input.schema ?? AiAuditAssessmentSchema, 'gemini', input.evidenceIds);
  return { prompt: `${text.join('\n\n')}\n\n${input.validationChecklist ?? ''}\n\n${reviewOutputContract(input.schemaName) ?? ''}\n\n${buildJsonObjectContract(contract)}`, attachments, agentMode: 'interactive' };
}

export async function callCopilotAudit(input: CallOpenRouterAuditInput): Promise<CallOpenRouterAuditOutput> {
  const env = getEnv();
  const modelId = input.schemaName === 'AuditSemanticReview' ? env.COPILOT_REVIEW_MODEL : env.COPILOT_MODEL;
  if (!env.COPILOT_GITHUB_TOKEN || !modelId) throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Copilot no está configurado en el servidor.');
  const started = Date.now();
  const deadline = Math.min(input.deadlineMs ?? started + env.TOTAL_AUDIT_TIMEOUT_MS,
    started + (input.timeoutMs ?? Math.max(env.AI_TIMEOUT_MS, Math.floor(env.TOTAL_AUDIT_TIMEOUT_MS / 2))));
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Se agotó el tiempo de la auditoría.');
  const root = await mkdtemp(join(tmpdir(), 'cancelaciones-copilot-'));
  const { CopilotClient } = await import('@github/copilot-sdk');
  const childEnv = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'COPILOT_CLI_PATH'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
  const client = new CopilotClient({ mode: 'empty', baseDirectory: root, workingDirectory: root, gitHubToken: env.COPILOT_GITHUB_TOKEN,
    useLoggedInUser: false, env: childEnv, logLevel: 'none', telemetry: { captureContent: false } });
  let session: CopilotSession | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempted = false;
  let capabilitiesVerified = false;
  const state: { stage: 'provider' | 'json' | 'validation' } = { stage: 'provider' };
  const usage: CallOpenRouterAuditOutput['usage'] = { promptTokens: null, completionTokens: null, totalTokens: null, estimatedCostUSD: null };
  let usageEvents = 0;
  let actualModel = modelId;
  let rejectedResponse: string | undefined;
  let cancelled = false;
  const assertActive = () => { if (cancelled || Date.now() >= deadline) throw new Error('COPILOT_DEADLINE'); };
  const diagnostic = (failureCategory: OpenRouterAttemptDiagnostic['failureCategory']): OpenRouterAttemptDiagnostic => ({
    model: actualModel, format: attempted ? 'json_object' : 'capability', status: null, providerErrorType: null, finishReason: null,
    latencyMs: Date.now() - started, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens,
    cost: null, maxOutputTokensRequested: null, capabilitiesVerified, retryable: false, failureCategory,
    failureReason: failureCategory === 'TIMEOUT' ? 'Copilot agoto el plazo de la llamada. No se reintento ni se publico la propuesta.'
      : failureCategory ? 'Copilot no pudo completar y validar la auditoria' : null, path: null, detail: null,
  });
  try {
    const operation = async () => {
      await client.start();
      assertActive();
      if (!(await client.getAuthStatus()).isAuthenticated) throw new Error('COPILOT_AUTH_REQUIRED');
      const model = (await client.listModels()).find(item => item.id === modelId && (!item.policy || item.policy.state === 'enabled'));
      capabilitiesVerified = Boolean(model);
      assertActive();
      if (!model) throw new ApiError(502, 'UNSUPPORTED_MODEL_CAPABILITY', 'El modelo configurado no está disponible en Copilot.');
      const message = copilotMessage(input, model);
      session = await client.createSession({ ...COPILOT_SESSION_SAFETY, model: modelId, allowedModels: [modelId],
        systemMessage: { mode: 'replace', content: input.system }, workingDirectory: root });
      assertActive();
      session.on('assistant.usage', event => {
        usageEvents++;
        actualModel = event.data.model;
        usage.promptTokens = event.data.inputTokens ?? null;
        usage.completionTokens = event.data.outputTokens ?? null;
        usage.totalTokens = usage.promptTokens === null || usage.completionTokens === null ? null : usage.promptTokens + usage.completionTokens;
      });
      attempted = true;
      const reply = await session.sendAndWait(message, Math.max(1, deadline - Date.now()));
      assertActive();
      if (usageEvents > 1 || actualModel !== modelId) throw new Error('COPILOT_UNEXPECTED_MODEL_CALLS');
      state.stage = 'json';
      const parsed: unknown = parseCopilotJson(reply?.data.content ?? '');
      state.stage = 'validation';
      rejectedResponse = JSON.stringify(parsed);
      try { input.validate?.(parsed); } catch (error) { annotateReviewReferenceFailure(input, parsed, error); throw error; }
      return { provider: 'github-copilot' as const, parsed, model: actualModel, usage, attempts: [diagnostic(null)] };
    };
    return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => { cancelled = true; reject(new Error('COPILOT_DEADLINE')); }, Math.max(1, deadline - Date.now())); })]);
  } catch (error) {
    const category = error instanceof ApiError && error.category === 'UNSUPPORTED_MODEL_CAPABILITY' ? 'UNSUPPORTED_MODEL_CAPABILITY'
      : state.stage === 'validation' ? 'SCHEMA_VALIDATION_ERROR' : state.stage === 'json' ? 'INVALID_JSON' : cancelled || Date.now() >= deadline ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE';
    const details = diagnostic(category);
    if (error instanceof ApiError) { details.path = error.failurePath ?? null; details.detail = error.sanitizedDetail ?? null; }
    if (details.detail) details.failureReason = details.detail;
    const failure = new OpenRouterAuditError(category, [details], category === 'TIMEOUT'
      ? 'Copilot agotó el tiempo disponible. No se publicó ningún dictamen ni se reintentó automáticamente.'
      : error instanceof ApiError && error.category === 'UNSUPPORTED_MODEL_CAPABILITY' ? error.message
      : 'Copilot no pudo completar y validar la auditoría.', 502,
      state.stage === 'validation' && rejectedResponse ? { detail: `${error instanceof Error ? error.message : ''}; ${details.detail ?? ''}`,
        path: details.path ?? 'response', previousResponse: rejectedResponse, usage: { ...usage } } : undefined);
    failure.name = 'CopilotAuditError';
    throw failure;
  } finally {
    cancelled = true;
    if (timer) clearTimeout(timer);
    void session?.abort().catch(() => undefined);
    await client.stop().catch(() => undefined);
    const inside = relative(tmpdir(), root);
    if (inside && !inside.startsWith('..') && !isAbsolute(inside)) await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}
