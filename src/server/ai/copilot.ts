import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import type { CopilotSession, MessageOptions, ModelInfo } from '@github/copilot-sdk';
import { getEnv } from '../env.js';
import { ApiError } from '../errors.js';
import { OpenRouterAuditError, type CallOpenRouterAuditInput, type CallOpenRouterAuditOutput, type OpenRouterAttemptDiagnostic } from '../openrouter.js';
import { buildProviderJsonSchema, buildJsonObjectContract } from './provider-schema.js';
import { AiAuditAssessmentSchema } from '../../skills/audit/schema.js';

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
  const text: string[] = [];
  const attachments: NonNullable<MessageOptions['attachments']> = [];
  for (const part of input.parts) {
    if (part.type === 'text') { text.push(part.text); continue; }
    const source = part.type === 'file' ? part.file.file_data : part.image_url.url;
    const match = /^data:(image\/[a-z0-9.+-]+|application\/pdf);base64,([a-z0-9+/=\r\n]+)$/i.exec(source);
    const vision = model.capabilities.limits.vision;
    if (!match || !model.capabilities.supports.vision || !vision || !vision.supported_media_types.includes(match[1]!.toLowerCase())
      || Buffer.byteLength(match[2]!, 'base64') > vision.max_prompt_image_size) {
      throw new ApiError(502, 'UNSUPPORTED_MODEL_CAPABILITY', part.type === 'file' ? 'El modelo de Copilot no admite este PDF original. No se omitió el documento.' : 'Una imagen excede las capacidades verificadas de Copilot. No se omitió evidencia para emitir el dictamen.');
    }
    const displayName = `evidencia-${attachments.length + 1}${part.type === 'file' ? '.pdf' : ''}`;
    text.push(`[${part.type === 'file' ? 'PDF' : 'Imagen'} de este bloque: ${displayName}]`);
    attachments.push({ type: 'blob', data: match[2]!, mimeType: match[1]!.toLowerCase(), displayName });
  }
  if (attachments.length > (model.capabilities.limits.vision?.max_prompt_images ?? 0)) throw new ApiError(502, 'UNSUPPORTED_MODEL_CAPABILITY', 'El expediente supera el número de imágenes admitido por Copilot.');
  // El contrato completo excede la gramática del proveedor; Zod valida el JSON.
  const contract = buildProviderJsonSchema(input.schema ?? AiAuditAssessmentSchema, 'gemini', input.evidenceIds);
  return { prompt: `${text.join('\n\n')}\n\n${input.validationChecklist ?? ''}\n\n${buildJsonObjectContract(contract)}`, attachments, agentMode: 'interactive' };
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
  const state: { stage: 'provider' | 'json' | 'validation' } = { stage: 'provider' };
  const usage: CallOpenRouterAuditOutput['usage'] = { promptTokens: null, completionTokens: null, totalTokens: null, estimatedCostUSD: null };
  let usageEvents = 0;
  let actualModel = modelId;
  let cancelled = false;
  const assertActive = () => { if (cancelled || Date.now() >= deadline) throw new Error('COPILOT_DEADLINE'); };
  const diagnostic = (failureCategory: OpenRouterAttemptDiagnostic['failureCategory']): OpenRouterAttemptDiagnostic => ({
    model: actualModel, format: 'json_object', status: null, providerErrorType: null, finishReason: null,
    latencyMs: Date.now() - started, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens,
    cost: null, maxOutputTokensRequested: null, capabilitiesVerified: true, retryable: false, failureCategory,
    failureReason: failureCategory ? 'La llamada de Copilot no produjo una salida validada' : null, path: null, detail: null,
  });
  try {
    const operation = async () => {
      await client.start();
      assertActive();
      if (!(await client.getAuthStatus()).isAuthenticated) throw new Error('COPILOT_AUTH_REQUIRED');
      const model = (await client.listModels()).find(item => item.id === modelId && (!item.policy || item.policy.state === 'enabled'));
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
      if (usageEvents > 1 || actualModel !== modelId) throw new Error('COPILOT_UNEXPECTED_MODEL_CALLS');
      state.stage = 'json';
      const parsed: unknown = parseCopilotJson(reply?.data.content ?? '');
      state.stage = 'validation';
      input.validate?.(parsed);
      return { provider: 'github-copilot' as const, parsed, model: actualModel, usage, attempts: [diagnostic(null)] };
    };
    return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => { cancelled = true; reject(new Error('COPILOT_DEADLINE')); }, Math.max(1, deadline - Date.now())); })]);
  } catch (error) {
    const category = state.stage === 'validation' ? 'SCHEMA_VALIDATION_ERROR' : state.stage === 'json' ? 'INVALID_JSON' : Date.now() >= deadline ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE';
    if (!attempted && error instanceof ApiError) throw error;
    const details = diagnostic(category);
    if (error instanceof ApiError) { details.path = error.failurePath ?? null; details.detail = error.sanitizedDetail ?? null; }
    const failure = new OpenRouterAuditError(category, attempted ? [details] : [], 'Copilot no pudo completar y validar la auditoría.');
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
