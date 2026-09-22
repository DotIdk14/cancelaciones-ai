import { createHash } from 'node:crypto';
import type { JobArtifact } from '@cancelaciones/db';

const CONTACT_RE = /(?:CALL|LLAMADA|WHATSAPP|EMAIL|CORREO)\s*[:#-]?\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/gi;

function sourceFor(artifact: JobArtifact) {
  return { evidenceId: artifact.evidenceId ?? '', artifactId: artifact.id, sha256: artifact.contentSha256 ?? undefined };
}

export function extractFactsFromArtifacts(input: { auditId: string; runId: string; artifacts: JobArtifact[] }) {
  const facts: Array<{ auditId: string; runId: string; factType: string; value: unknown; sourceRef: Record<string, unknown>; confidence?: number }> = [];
  const attempts: Array<{ id: string; kind: 'CALL' | 'WRITTEN'; occurredAt: string; successful: boolean; evidenceRefs: Record<string, unknown>[] }> = [];
  let effectiveContact: boolean | undefined;
  let studentLevel: string | undefined;
  let classroomHasLogin: boolean | undefined;
  let classroomHasEvaluationMode: boolean | undefined;
  let classroomHasActivities: boolean | undefined;
  let primarySource: Record<string, unknown> | null = null;

  for (const artifact of input.artifacts) {
    const text = String(artifact.result.text ?? artifact.result.transcript ?? '');
    if (!text) continue;
    const source = sourceFor(artifact);
    primarySource ??= source;
    for (const match of text.matchAll(CONTACT_RE)) {
      const raw = match[0].toUpperCase();
      const kind = raw.includes('CALL') || raw.includes('LLAMADA') ? 'CALL' : 'WRITTEN';
      attempts.push({ id: `attempt-${attempts.length + 1}`, kind, occurredAt: `${match[1]}T${match[2] ?? '12:00'}:00.000Z`, successful: false, evidenceRefs: [source] });
    }
    if (/NO\s+CONTACTO\s+EFECTIVO|SIN\s+CONTACTO\s+EFECTIVO/i.test(text)) effectiveContact = false;
    if (/CONTACTO\s+EFECTIVO/i.test(text) && effectiveContact === undefined) effectiveContact = true;
    const level = text.match(/NIVEL\s*[:=-]\s*(LICENCIATURA|POSGRADO|BACHILLERATO)/i)?.[1];
    if (level) studentLevel = level.toUpperCase();
    if (/SIN\s+LOGIN|NO\s+LOGIN/i.test(text)) classroomHasLogin = false;
    if (/CON\s+LOGIN|SI\s+LOGIN/i.test(text)) classroomHasLogin = true;
    if (/SIN\s+MODALIDAD|NO\s+MODALIDAD/i.test(text)) classroomHasEvaluationMode = false;
    if (/CON\s+MODALIDAD|SI\s+MODALIDAD/i.test(text)) classroomHasEvaluationMode = true;
    if (/SIN\s+ACTIVIDAD/i.test(text)) classroomHasActivities = false;
    if (/CON\s+ACTIVIDAD/i.test(text)) classroomHasActivities = true;
  }

  const source = primarySource ?? { evidenceId: '', artifactId: '', extractor: 'deterministic-v1' };
  const calls = attempts.filter((attempt) => attempt.kind === 'CALL');
  const written = attempts.filter((attempt) => attempt.kind === 'WRITTEN');
  if (calls.length) facts.push({ auditId: input.auditId, runId: input.runId, factType: 'contact.callAttempts', value: calls, sourceRef: source, confidence: 0.85 });
  if (written.length) facts.push({ auditId: input.auditId, runId: input.runId, factType: 'contact.writtenInteractions', value: written, sourceRef: source, confidence: 0.85 });
  if (effectiveContact !== undefined) facts.push({ auditId: input.auditId, runId: input.runId, factType: 'contact.effectiveContact', value: effectiveContact, sourceRef: source, confidence: 0.8 });
  if (studentLevel) facts.push({ auditId: input.auditId, runId: input.runId, factType: 'student.level', value: studentLevel, sourceRef: source, confidence: 0.8 });
  if (classroomHasLogin !== undefined) facts.push({ auditId: input.auditId, runId: input.runId, factType: 'classroom.hasLogin', value: classroomHasLogin, sourceRef: source, confidence: 0.8 });
  if (classroomHasEvaluationMode !== undefined) facts.push({ auditId: input.auditId, runId: input.runId, factType: 'classroom.hasEvaluationMode', value: classroomHasEvaluationMode, sourceRef: source, confidence: 0.8 });
  if (classroomHasActivities !== undefined) facts.push({ auditId: input.auditId, runId: input.runId, factType: 'classroom.hasActivities', value: classroomHasActivities, sourceRef: source, confidence: 0.8 });
  return facts;
}

export function textArtifactResult(text: string, extra: Record<string, unknown> = {}) {
  return { text, textSha256: createHash('sha256').update(text).digest('hex'), ...extra };
}
