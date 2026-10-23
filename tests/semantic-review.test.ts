import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auditSkill } from '../src/skills/audit/execute';
import { validateSemanticReview, sumModelUsage } from '../src/skills/audit/verify';
import { parseAiAuditAssessment } from '../src/skills/audit/schema';
import { assertProcedureReference } from '../src/skills/audit/references';
import { callOpenRouterAudit } from '../src/server/openrouter';
import { validAuditResult } from './fixtures/audit-result';
import { setTestEnv } from './helpers/env';
import type { AuditSkillInput } from '../src/skills/audit/types';
vi.mock('../src/server/openrouter', () => ({callOpenRouterAudit:vi.fn()}));
const call = vi.mocked(callOpenRouterAudit);
const input: AuditSkillInput = {caseId:'synthetic',studentIdentifier:null,evidences:[{evidenceId:'ev-1',filename:'synthetic.txt',mimeType:'text/plain',kind:'TEXT',text:'Matrícula UTEL-2026-001. Inicio de ciclo: 12/01/2026. No sé cómo ingresar al aula. ¿Me ayudan?',sizeBytes:100,sha256:'synthetic',createdAt:'2026-02-01T00:00:00Z'}]};
function proposal() {
 const {model: _model,usage: _usage,...result}=structuredClone(validAuditResult);
 result.facts[0]!.evidenceText='UTEL-2026-001';
 result.audit.procedureSection='5.3';
 return result;
}
function review() {return {decisionSupport:{procedureSection:'5.3.a.I',policyQuote:'Si el estudiante solicita no continuar con sus estudios, previo a la fecha de inicio, aplica cancelación de venta.',explanation:'Sustento normativo a comprobar',evidenceIds:['ev-1']},verdict:'CONFIRMED' as const,issues:[],revisedAssessment:null,factGrounding:[
 {factKey:'matricula',support:'OBSERVED' as const,explanation:'Identificador visible',citations:[{evidenceId:'ev-1',quote:'UTEL-2026-001',locator:'línea 1'}]},
 {factKey:'cycle_start_date',support:'OBSERVED' as const,explanation:'Inicio explícito',citations:[{evidenceId:'ev-1',quote:'Inicio de ciclo: 12/01/2026',locator:'línea 1'}]},
 ]};}
beforeEach(()=>{setTestEnv();call.mockReset();});
describe('control de sustento antes de publicar',()=>{
 it('exige cubrir todos los hechos y citas que existen en el texto original',()=>{
  expect(validateSemanticReview(review(),proposal(),input,parseAiAuditAssessment).assessment.audit.result).toBe('CANCELACION_VENTA');
  const missing=review();missing.factGrounding.pop();expect(()=>validateSemanticReview(missing,proposal(),input,parseAiAuditAssessment)).toThrow('cada hecho');
  const forged=review();forged.factGrounding[0]!.citations[0]!.quote='Quiero cancelar';expect(()=>validateSemanticReview(forged,proposal(),input,parseAiAuditAssessment)).toThrow('no aparece');
 });
 it('rechaza referencias inventadas, duplicados y atribución humana falsa',()=>{
  const forged=review();forged.factGrounding[0]!.citations[0]!.evidenceId='ev-falsa';expect(()=>validateSemanticReview(forged,proposal(),input,parseAiAuditAssessment)).toThrow('cubiertas por sus citas');
  const duplicate=review();duplicate.factGrounding.push(duplicate.factGrounding[0]!);expect(()=>validateSemanticReview(duplicate,proposal(),input,parseAiAuditAssessment)).toThrow('una sola vez');
  const human={...review(),factGrounding:[{...review().factGrounding[0]!,support:'HUMAN_CONTEXT',citations:[]},review().factGrounding[1]!]};expect(()=>validateSemanticReview(human,proposal(),input,parseAiAuditAssessment)).toThrow('atribución humana');
 });
 it('no permite llamar desconocido a un hecho que sigue afirmando un valor',()=>{
  const unknown={...review(),factGrounding:[{...review().factGrounding[0]!,support:'UNKNOWN',citations:[]},review().factGrounding[1]!]};
  expect(()=>validateSemanticReview(unknown,proposal(),input,parseAiAuditAssessment)).toThrow('sin valor afirmado');
 });
 it('rechaza una revisión que pide información y a la vez emite dictamen definitivo',()=>{
  expect(()=>validateSemanticReview({...review(),verdict:'NEEDS_INPUT',issues:[{description:'Falta premisa',evidenceIds:['ev-1']}],revisedAssessment:proposal()},proposal(),input,parseAiAuditAssessment)).toThrow('resultado definitivo');
 });
 it('admite NEEDS_INPUT con rechazo coherente por intentos de 5.2 sin acreditar',()=>{
  const rejected=proposal();rejected.audit.result='TICKET_RECHAZADO';
  rejected.audit.rejectionReason='Se acreditan 15 de 16 llamadas; falta 1 llamada.';
  rejected.audit.procedureChecks[0]!.status='NO_ACREDITADO';
  rejected.audit.procedureChecks[0]!.observedValues[1]!.value='15';
  rejected.audit.missingEvidence=[{title:'Intentos mínimos de contacto',reason:'Falta 1 llamada para acreditar el mínimo.',acceptedEvidence:['Registro de llamadas'],relatedProcedureSection:'5.2',relatedEvidenceIds:['ev-1'],blocking:true}];
  const correction={...review(),verdict:'NEEDS_INPUT',issues:[{description:'Falta un intento acreditado',evidenceIds:['ev-1']}],revisedAssessment:rejected};
  expect(validateSemanticReview(correction,proposal(),input,parseAiAuditAssessment).assessment.audit.result).toBe('TICKET_RECHAZADO');
 });
 it('no acepta espacios en blanco como citas ni como ubicación',()=>{
  const emptyQuote=review();emptyQuote.factGrounding[0]!.citations[0]!.quote='   ';
  expect(()=>validateSemanticReview(emptyQuote,proposal(),input,parseAiAuditAssessment)).toThrow('contrato de trazabilidad');
  const emptyPolicy=review();emptyPolicy.decisionSupport.policyQuote=' \n ';
  expect(()=>validateSemanticReview(emptyPolicy,proposal(),input,parseAiAuditAssessment)).toThrow('contrato de trazabilidad');
  const emptyLocator=review();emptyLocator.factGrounding[0]!.citations[0]!.locator=' ';
  expect(()=>validateSemanticReview(emptyLocator,proposal(),input,parseAiAuditAssessment)).toThrow('contrato de trazabilidad');
 });
 it('comprueba referencias documentales y sus incisos, sin decidir clasificaciones',()=>{
  for(const section of ['5.3.a.I','5.8.h.ii','5.8.i.1','5.6','3, páginas 4-5']) expect(()=>assertProcedureReference(section)).not.toThrow();
  for(const section of ['99.99','5.8.z','5.3.a.XX','inventada']) expect(()=>assertProcedureReference(section)).toThrow('no encontrada');
 });
 it('conserva desconocido el coste si una etapa no lo reportó',()=>{
  expect(sumModelUsage({promptTokens:1,completionTokens:2,totalTokens:3,estimatedCostUSD:null},{promptTokens:4,completionTokens:5,totalTokens:9,estimatedCostUSD:0.1})).toEqual({promptTokens:5,completionTokens:7,totalTokens:12,estimatedCostUSD:null});
 });
 it('rechaza una cita normativa inventada aunque la sección exista',()=>{
  const forged=review();forged.decisionSupport.policyQuote='Todo alumno que pida ayuda debe darse de baja';
  expect(()=>validateSemanticReview(forged,proposal(),input,parseAiAuditAssessment)).toThrow('no aparece en la sección oficial');
 });
 it('contrasta la cita normativa contra cualquiera de las secciones declaradas',()=>{
  const multiple=review();multiple.decisionSupport.procedureSection='5.2 y 5.3.a.I';
  expect(()=>validateSemanticReview(multiple,proposal(),input,parseAiAuditAssessment)).not.toThrow();
 });
 it('permite lectura visual aunque el archivo tenga texto auxiliar incompleto',()=>{
  const visual={...input,evidences:input.evidences.map(item=>({...item,kind:'IMAGE' as const,imageBase64:'data:image/png;base64,c3ludGhldGlj',text:'Texto auxiliar de la imagen'}))};
  expect(()=>validateSemanticReview(review(),proposal(),visual,parseAiAuditAssessment)).not.toThrow();
 });
});
describe('flujo real del Skill en dos etapas con transporte simulado',()=>{
 it('envía la incoherencia detectada en la propuesta al contraste para corregirla',async()=>{
  const initial=proposal();initial.audit.procedureChecks[0]!.procedureSection='5.3';
  const correction={...review(),verdict:'CORRECTED',issues:[{description:'La sección no corresponde a la ruta aplicada',evidenceIds:['ev-1']}],revisedAssessment:proposal()};
  call.mockResolvedValueOnce({parsed:initial,model:'proposal-model',usage:validAuditResult.usage,attempts:[]}).mockResolvedValueOnce({parsed:correction,model:'review-model',usage:validAuditResult.usage,attempts:[]});
  const outcome=await auditSkill.execute(input);
  expect(outcome.reliabilityReview?.status).toBe('CORRECTED');
  expect(call.mock.calls[1]![0].parts.filter(part=>part.type==='text').map(part=>part.text).join('\n')).toContain('La propuesta NO pasó la validación local');
 });
 it('no publica la propuesta si la revisión encuentra una cita falsa',async()=>{
  const bad=review();bad.factGrounding[0]!.citations[0]!.quote='Quiero cancelar';
  call.mockResolvedValueOnce({parsed:proposal(),model:'proposal-model',usage:validAuditResult.usage,attempts:[]}).mockResolvedValueOnce({parsed:bad,model:'review-model',usage:validAuditResult.usage,attempts:[]});
  await expect(auditSkill.execute(input)).rejects.toThrow('no aparece');expect(call).toHaveBeenCalledTimes(2);
  expect(call.mock.calls.every(([args])=>args.maxAttempts===1)).toBe(true);
 });
 it('publica solo el assessment corregido, conserva el contraste y suma ambas etapas',async()=>{
  const initial=proposal();initial.facts.push({key:'cancellation_intent',label:'Quiere cancelar',value:'Solicita no continuar',confidence:0.99,evidenceIds:['ev-1'],evidenceText:'No sé cómo ingresar al aula. ¿Me ayudan?'});
  const corrected=proposal();corrected.facts.push({key:'cancellation_intent',label:'Intención de cancelar',value:null,confidence:0.2,evidenceIds:[],evidenceText:null});
  corrected.audit.result='EVIDENCIA_INSUFICIENTE';corrected.audit.confidence=0.7;
  corrected.audit.provisionalResolution={result:'CANCELACION_VENTA',rationale:'Solo si se acredita una solicitud y sus condiciones',procedureSection:'5.3',evidenceIds:['ev-1']};
  corrected.audit.missingEvidence=[{title:'Manifestación de no continuar',reason:'Pedir ayuda no acredita cancelación',acceptedEvidence:['Solicitud del estudiante'],relatedProcedureSection:'5.3',relatedEvidenceIds:['ev-1'],blocking:true}];
  corrected.temporalAnalysis.cancellationRequestDate=null;corrected.temporalAnalysis.cancellationRequestEvidenceIds=[];corrected.temporalAnalysis.relationToCycleStart='NO_DETERMINABLE';corrected.temporalAnalysis.reasoning='Existe inicio, falta solicitud';corrected.timeline=[];
  const correction={...review(),verdict:'NEEDS_INPUT',issues:[{description:'Confundió ayuda con intención',evidenceIds:['ev-1']}],revisedAssessment:corrected,factGrounding:[...review().factGrounding,{factKey:'cancellation_intent',support:'UNKNOWN',explanation:'No hay solicitud',citations:[]}]};
  call.mockResolvedValueOnce({parsed:initial,model:'proposal-model',usage:validAuditResult.usage,attempts:[]}).mockResolvedValueOnce({parsed:correction,model:'review-model',usage:validAuditResult.usage,attempts:[]});
  const outcome=await auditSkill.execute(input);expect(outcome.audit.result).toBe('EVIDENCIA_INSUFICIENTE');expect(outcome.temporalAnalysis.cancellationRequestDate).toBeNull();expect(outcome.reliabilityReview?.status).toBe('NEEDS_INPUT');expect(outcome.model.model).toBe('review-model');expect(outcome.usage.totalTokens).toBe(validAuditResult.usage.totalTokens!*2);
  expect(call.mock.calls[1]![0].parts.some(part=>part.type==='text'&&part.text.includes('PROPUESTA A CONTRASTAR'))).toBe(true);expect(call).toHaveBeenCalledTimes(2);
  const first=call.mock.calls[0]![0];const second=call.mock.calls[1]![0];
  expect(second.deadlineMs).toBe(first.deadlineMs);expect(second.timeoutMs).toBeGreaterThan(0);
  expect(second.timeoutMs).toBeLessThanOrEqual(second.deadlineMs!-Date.now()+100);
  expect(second.models).toEqual(['google/gemini-2.5-pro']);
 });
 it('termina sin revisión ni publicación cuando falla la primera llamada',async()=>{
  call.mockRejectedValueOnce(new Error('proveedor caído'));await expect(auditSkill.execute(input)).rejects.toThrow('proveedor');expect(call).toHaveBeenCalledTimes(1);
 });
});
