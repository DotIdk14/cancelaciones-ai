import type { AiAuditAssessment } from '../../src/skills/audit/schema';
export async function isolatedReview(args: {proposal: AiAuditAssessment; proposalModel: string}) {
 return {assessment:args.proposal,reliabilityReview:{status:'CONFIRMED' as const,model:args.proposalModel,proposalModel:args.proposalModel,issues:[],factGrounding:[],decisionSupport:{procedureSection:'5.3',policyQuote:'A solicitud del Estudiante',explanation:'Revisión aislada en test de otra capa',evidenceIds:[]}},usage:{promptTokens:0,completionTokens:0,totalTokens:0,estimatedCostUSD:0},attempts:[]};
}
