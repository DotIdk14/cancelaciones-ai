import { MAX_TOOL_OUTPUT_CHARS } from '@cancelaciones/shared';
import { readPolicySection, searchPolicy } from './policy';

export interface ToolContext {
  audit: { id: string; [key: string]: unknown };
  evidence?: ReadonlyArray<{ id: string; text?: string; [key: string]: unknown }>;
  timeline?: readonly unknown[];
  policyRootDir?: string;
  submittedAssessment?: unknown;
}

export async function executeTool(name: string, args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const output = await runTool(name, args, context);
  return truncate(JSON.stringify(output));
}

async function runTool(name: string, args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
  if (name === 'listEvidence') return listEvidence(context);
  if (name === 'readEvidence') return readEvidence(String(args.evidenceId ?? ''), context);
  if (name === 'searchEvidence') return searchEvidence(String(args.query ?? ''), context);
  if (name === 'searchPolicyTool') return searchPolicyTool(String(args.query ?? ''), context);
  if (name === 'readPolicySectionTool') return readPolicySectionTool(String(args.sectionId ?? ''), context);
  if (name === 'getCaseMetadata') return getCaseMetadata(context);
  if (name === 'getTimeline') return getTimeline(context);
  if (name === 'submitAssessmentTool') return submitAssessmentTool(args.assessment, context);
  throw new Error(`UNKNOWN_TOOL:${name}`);
}

export function listEvidence(context: ToolContext): readonly unknown[] { return context.evidence ?? []; }
export function readEvidence(evidenceId: string, context: ToolContext): unknown { return (context.evidence ?? []).find((item) => item.id === evidenceId) ?? null; }
export function searchEvidence(query: string, context: ToolContext): readonly unknown[] {
  const tokens = query.toLowerCase().split(/\W+/).filter(Boolean);
  return (context.evidence ?? []).filter((item) => tokens.some((token) => String(item.text ?? '').toLowerCase().includes(token)));
}
export function searchPolicyTool(query: string, context: ToolContext): unknown { return searchPolicy(query, context.policyRootDir); }
export function readPolicySectionTool(sectionId: string, context: ToolContext): unknown { return readPolicySection(sectionId, context.policyRootDir); }
export function getCaseMetadata(context: ToolContext): unknown { return context.audit; }
export function getTimeline(context: ToolContext): readonly unknown[] { return context.timeline ?? []; }
export function submitAssessmentTool(assessment: unknown, context: ToolContext): unknown { context.submittedAssessment = assessment; return { ok: true }; }

function truncate(value: string): string {
  return value.length > MAX_TOOL_OUTPUT_CHARS ? value.slice(0, MAX_TOOL_OUTPUT_CHARS) : value;
}
