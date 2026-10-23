import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { setTestEnv } from './helpers/env';
import { resetEnvCache } from '../src/server/env';
import { callCopilotAudit, copilotMessage, COPILOT_SESSION_SAFETY, parseCopilotJson } from '../src/server/ai/copilot';

const fake = vi.hoisted(() => ({start:vi.fn(),stop:vi.fn(),auth:vi.fn(),models:vi.fn(),create:vi.fn(),send:vi.fn(),abort:vi.fn(),on:vi.fn(),options:vi.fn()}));
vi.mock('@github/copilot-sdk', () => ({ CopilotClient: class {
 constructor(options:unknown){fake.options(options);} start=fake.start; stop=fake.stop; getAuthStatus=fake.auth; listModels=fake.models; createSession=fake.create;
}}));
const model = {id:'synthetic-vision',name:'Sintético',capabilities:{supports:{vision:true,reasoningEffort:false},limits:{max_context_window_tokens:128000,vision:{supported_media_types:['image/png'],max_prompt_images:2,max_prompt_image_size:1024}}}};
const input = () => ({ system:'Instrucciones de prueba', parts:[{type:'text' as const,text:'ev-1: evidencia sintética'}], schema:z.object({ok:z.boolean()}).strict(), validate:(value:unknown)=>{z.object({ok:z.boolean()}).strict().parse(value);}, deadlineMs:Date.now()+1000 });
beforeEach(() => {
 vi.clearAllMocks(); setTestEnv(); vi.stubEnv('COPILOT_GITHUB_TOKEN','synthetic-copilot-token'); vi.stubEnv('COPILOT_MODEL','synthetic-vision'); vi.stubEnv('COPILOT_REVIEW_MODEL','synthetic-vision'); resetEnvCache();
 fake.start.mockResolvedValue(undefined); fake.stop.mockResolvedValue(undefined); fake.abort.mockResolvedValue(undefined);
 fake.auth.mockResolvedValue({isAuthenticated:true}); fake.models.mockResolvedValue([model]);
 fake.create.mockResolvedValue({sessionId:'synthetic',sendAndWait:fake.send,abort:fake.abort,on:fake.on});
 fake.send.mockResolvedValue({data:{content:'{"ok":true}'}});
});
afterEach(()=>{vi.unstubAllEnvs();resetEnvCache();});
describe('transporte Copilot con herramientas denegadas',()=>{
 it('lee un objeto completo sin alterar cadenas, datos ni estructura interna',()=>{
  expect(parseCopilotJson('{"ok":true,"text":"}\\\"{"}}}')).toEqual({ok:true,text:'}"{'});
  for(const value of ['{"ok":true} {"ok":false}', '{"ok":true} texto', '{"ok":', '{"ok":true,}', '{"nested":{"ok":true},}']) expect(()=>parseCopilotJson(value)).toThrow();
 });
 it('valida la respuesta y registra proveedor real sin inventar coste ni HTTP',async()=>{
  const result=await callCopilotAudit(input()); expect(result.provider).toBe('github-copilot');expect(result.parsed).toEqual({ok:true});
  expect(result.usage.estimatedCostUSD).toBeNull();expect(result.attempts[0]?.status).toBeNull();
  expect(fake.create).toHaveBeenCalledWith(expect.objectContaining({availableTools:[],enableSkills:false,enableSessionStore:false,skipCustomInstructions:true}));
  expect(fake.options.mock.calls[0]![0].env.OPENROUTER_API_KEY).toBeUndefined();expect(fake.stop).toHaveBeenCalledOnce();
  expect(fake.send.mock.calls[0]![0].responseSchema).toBeUndefined();
  expect(fake.send.mock.calls[0]![0].prompt).toContain('"required":["ok"]');
 });
 it('no reintenta ni publica JSON inválido',async()=>{
  fake.send.mockResolvedValue({data:{content:'no es JSON'}});await expect(callCopilotAudit(input())).rejects.toMatchObject({category:'INVALID_AI_RESPONSE'});expect(fake.send).toHaveBeenCalledOnce();
 });
 it('acepta un único bloque JSON cercado y mantiene la validación local',async()=>{
  fake.send.mockResolvedValue({data:{content:'```json\n{"ok":true}\n```'}});
  expect((await callCopilotAudit(input())).parsed).toEqual({ok:true});
  fake.send.mockResolvedValue({data:{content:'Texto extra\n```json\n{"ok":true}\n```'}});
  await expect(callCopilotAudit(input())).rejects.toMatchObject({category:'INVALID_AI_RESPONSE'});
 });
 it('rechaza una respuesta que no supera el contrato local',async()=>{
  fake.send.mockResolvedValue({data:{content:'{"ok":"inventado"}'}});await expect(callCopilotAudit(input())).rejects.toMatchObject({category:'SCHEMA_VALIDATION_ERROR'});expect(fake.send).toHaveBeenCalledOnce();
 });
 it('rechaza archivos PDF sin omitirlos para emitir un dictamen',()=>{
  expect(()=>copilotMessage({...input(),parts:[{type:'file',file:{filename:'synthetic.pdf',file_data:'data:application/pdf;base64,c3ludGhldGlj'}}]},model)).toThrow('PDF');
 });
 it('envía el PDF original cuando el catálogo del modelo admite ese MIME',()=>{
  const capable={...model,capabilities:{...model.capabilities,limits:{...model.capabilities.limits,vision:{...model.capabilities.limits.vision,supported_media_types:['image/png','application/pdf']}}}};
  const message=copilotMessage({...input(),parts:[{type:'file',file:{filename:'synthetic.pdf',file_data:'data:application/pdf;base64,c3ludGhldGlj'}}]},capable);
  expect(message.attachments?.[0]).toMatchObject({type:'blob',mimeType:'application/pdf',data:'c3ludGhldGlj'});
 });
 it('conserva la asociación de cada imagen con su bloque y comprueba sus límites',()=>{
  const part={type:'image_url' as const,image_url:{url:'data:image/png;base64,c3ludGhldGlj'}};
  const message=copilotMessage({...input(),parts:[...input().parts,part]},model);expect(message.prompt).toContain('Imagen de este bloque: evidencia-1');expect(message.attachments?.[0]?.type).toBe('blob');
  expect(()=>copilotMessage({...input(),parts:[part,part,part]},model)).toThrow('3 adjuntos y Copilot admite 2');
 });
 it('conserva proveedor, modelo y motivo incluso si rechaza antes de inferir',async()=>{
  const part={type:'image_url' as const,image_url:{url:'data:image/png;base64,c3ludGhldGlj'}};
  await expect(callCopilotAudit({...input(),parts:[part,part,part]})).rejects.toMatchObject({
   name:'CopilotAuditError',category:'UNSUPPORTED_MODEL_CAPABILITY',diagnostics:[expect.objectContaining({
    model:'synthetic-vision',format:'capability',failureCategory:'UNSUPPORTED_MODEL_CAPABILITY',
    path:'evidence.attachments',detail:'adjuntos recibidos 3 - maximo permitido 2',promptTokens:null,
   })],
  });
  expect(fake.send).not.toHaveBeenCalled();expect(fake.create).not.toHaveBeenCalled();
 });
 it('registra modelo no disponible como capacidad y no como una caída genérica',async()=>{
  fake.models.mockResolvedValue([]);
  await expect(callCopilotAudit(input())).rejects.toMatchObject({name:'CopilotAuditError',category:'UNSUPPORTED_MODEL_CAPABILITY',
   diagnostics:[expect.objectContaining({model:'synthetic-vision',format:'capability',capabilitiesVerified:false})]});
  expect(fake.send).not.toHaveBeenCalled();
 });
 it('acota una llamada sin respuesta, aborta y no inicia un segundo intento',async()=>{
  fake.send.mockImplementation(()=>new Promise(()=>{}));
  await expect(callCopilotAudit({...input(),deadlineMs:Date.now()+500})).rejects.toMatchObject({
   name:'CopilotAuditError',category:'PROVIDER_UNAVAILABLE',diagnostics:[expect.objectContaining({
    failureCategory:'TIMEOUT',failureReason:expect.stringContaining('agoto el plazo'),
   })],
  });
  expect(fake.send).toHaveBeenCalledOnce();expect(fake.abort).toHaveBeenCalledOnce();expect(fake.stop).toHaveBeenCalledOnce();
 });
 it('descarta la respuesta que llega después del timeout antes de validarla',async()=>{
  let finish:((value:unknown)=>void)|undefined;
  fake.send.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const validate=vi.fn();
  await expect(callCopilotAudit({...input(),validate,deadlineMs:Date.now()+500})).rejects.toMatchObject({category:'PROVIDER_UNAVAILABLE'});
  finish?.({data:{content:'{"ok":true}'}});
  await new Promise(resolve=>setTimeout(resolve,10));
  expect(validate).not.toHaveBeenCalled();expect(fake.send).toHaveBeenCalledOnce();
 });
 it('termina sin inferencia si se agota el plazo durante la preparación del cliente',async()=>{
  let finish:((value:unknown)=>void)|undefined;fake.models.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  await expect(callCopilotAudit({...input(),deadlineMs:Date.now()+50})).rejects.toMatchObject({category:'PROVIDER_UNAVAILABLE'});
  finish?.([model]);await new Promise(resolve=>setTimeout(resolve,10));expect(fake.send).not.toHaveBeenCalled();
 });
 it('deniega permisos incluso si el runtime solicita una herramienta',()=>{
  expect(COPILOT_SESSION_SAFETY.onPermissionRequest().kind).toBe('reject');
 });
});
