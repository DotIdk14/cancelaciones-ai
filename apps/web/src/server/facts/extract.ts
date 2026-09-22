import { createHash } from 'node:crypto';
import type { JobArtifact } from '@cancelaciones/db';
import type { ContactAttempt, SourceCompleteness } from '@cancelaciones/policy-engine';

const CONTACT_RE = /(?:CALL|LLAMADA|WHATSAPP|EMAIL|CORREO)\s*[:#-]?\s*(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/gi;

function sourceFor(artifact: JobArtifact) {
  return { evidenceId: artifact.evidenceId ?? '', artifactId: artifact.id, sha256: artifact.contentSha256 ?? undefined };
}

export function extractFactsFromArtifacts(input: { auditId: string; runId: string; artifacts: JobArtifact[] }) {
  const facts: Array<{ auditId: string; runId: string; factType: string; value: unknown; sourceRef: Record<string, unknown>; confidence?: number }> = [];
  const attempts: ContactAttempt[] = [];
  const completeness: Record<'CALL' | 'WRITTEN', SourceCompleteness> = { CALL: 'COMPLETE', WRITTEN: 'COMPLETE' };
  const observedCounts: Record<'CALL' | 'WRITTEN', number> = { CALL: 0, WRITTEN: 0 };
  const warnings: string[] = [];
  const observedIdentity = new Set<string>();
  let effectiveContact: boolean | undefined;
  let studentLevel: string | undefined;
  let studentName: string | undefined;
  let studentEnrollment: string | undefined;
  let classroomHasLogin: boolean | undefined;
  let classroomHasEvaluationMode: boolean | undefined;
  let classroomHasActivities: boolean | undefined;
  let lastCourseAccess: string | undefined;
  let platformAccessEvents: unknown;
  let primarySource: Record<string, unknown> | null = null;

  for (const artifact of input.artifacts) {
    const text = String(artifact.result.text ?? artifact.result.transcript ?? '');
    const source = sourceFor(artifact);
    primarySource ??= source;
    const extractedFacts = Array.isArray(artifact.result.extractedFacts) ? artifact.result.extractedFacts as Array<{ factType?: string; value?: unknown; confidence?: number }> : [];
    for (const extracted of extractedFacts) {
      if (extracted.factType && extracted.value !== undefined) {
        if (extracted.factType === 'contact.callAttempts' || extracted.factType === 'contact.writtenInteractions') {
          const channel = extracted.factType === 'contact.callAttempts' ? 'CALL' : 'WRITTEN';
          const rawEvents = Array.isArray(extracted.value) ? extracted.value : [];
          const rawCollection = extracted.value && typeof extracted.value === 'object' && !Array.isArray(extracted.value)
            ? extracted.value as { events?: unknown[]; sourceCompleteness?: SourceCompleteness; warnings?: string[] }
            : null;
          const numericCount = typeof extracted.value === 'number'
            ? extracted.value
            : typeof extracted.value === 'string' && /^\d+$/.test(extracted.value) ? Number(extracted.value) : null;
          if (numericCount !== null) {
            observedCounts[channel] = Math.max(observedCounts[channel], numericCount);
            completeness[channel] = 'UNKNOWN';
          }
          completeness[channel] = rawCollection?.sourceCompleteness ?? completeness[channel];
          if (rawCollection?.warnings?.length) warnings.push(...rawCollection.warnings);
          for (const raw of rawCollection?.events ?? rawEvents) {
            if (!raw || typeof raw !== 'object') continue;
            const event = raw as Partial<ContactAttempt> & { channel?: string; dateTime?: string };
            if (!event.occurredAt && !event.dateTime) continue;
            const eventKind = event.kind ?? (event.channel === 'CALL' ? 'CALL' : event.channel === 'EMAIL' ? 'EMAIL' : event.channel === 'WHATSAPP' ? 'WHATSAPP' : channel === 'CALL' ? 'CALL' : 'OTHER_WRITTEN');
            const normalized: ContactAttempt = {
              id: event.id ?? `attempt-${attempts.length + 1}`,
              kind: eventKind,
              occurredAt: event.occurredAt ?? event.dateTime ?? '',
              successful: event.successful,
              status: event.status,
              campaign: event.campaign,
              confidence: event.confidence ?? extracted.confidence ?? 0.7,
              evidenceRefs: [{ ...source }],
            };
            const identity = `${normalized.kind}|${normalized.occurredAt}|${normalized.status ?? ''}`;
            if (!observedIdentity.has(identity)) {
              observedIdentity.add(identity);
              attempts.push(normalized);
            }
          }
        } else if (extracted.factType === 'student.name') studentName = typeof extracted.value === 'string' ? extracted.value : studentName;
        else if (extracted.factType === 'student.enrollment') studentEnrollment = typeof extracted.value === 'string' ? extracted.value : studentEnrollment;
        else if (extracted.factType === 'academic.lastCourseAccess') lastCourseAccess = typeof extracted.value === 'string' ? extracted.value : lastCourseAccess;
        else if (extracted.factType === 'academic.platformAccessEvents') platformAccessEvents = extracted.value;
        else facts.push({ auditId: input.auditId, runId: input.runId, factType: extracted.factType, value: extracted.value, sourceRef: source, confidence: extracted.confidence ?? 0.7 });
      }
    }
    for (const match of text.matchAll(CONTACT_RE)) {
      const raw = match[0].toUpperCase();
      const kind = raw.includes('CALL') || raw.includes('LLAMADA') ? 'CALL' : 'WRITTEN';
      const normalized: ContactAttempt = { id: `attempt-${attempts.length + 1}`, kind, occurredAt: `${match[1]}T${match[2] ?? '12:00'}:00.000Z`, successful: false, evidenceRefs: [source], confidence: 0.65 };
      const identity = `${normalized.kind}|${normalized.occurredAt}|`;
      if (!observedIdentity.has(identity)) { observedIdentity.add(identity); attempts.push(normalized); }
    }
    if (/NO\s+CONTACTO\s+EFECTIVO|SIN\s+CONTACTO\s+EFECTIVO/i.test(text)) effectiveContact = false;
    if (/CONTACTO\s+EFECTIVO/i.test(text) && effectiveContact === undefined) effectiveContact = true;
    const level = text.match(/NIVEL\s*[:=-]\s*(LICENCIATURA|POSGRADO|BACHILLERATO)/i)?.[1];
    if (level) studentLevel = level.toUpperCase();
    const name = text.match(/(?:NOMBRE|ESTUDIANTE)\s*[:=-]\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .'-]{3,})/i)?.[1]?.trim();
    if (name) studentName ??= name;
    const enrollment = text.match(/(?:MATR[IÍ]CULA|MATRICULA|ID\s+ALUMNO)\s*[:=-]\s*([A-Z0-9-]+)/i)?.[1]?.trim();
    if (enrollment) studentEnrollment ??= enrollment;
    if (/SIN\s+LOGIN|NO\s+LOGIN/i.test(text)) classroomHasLogin = false;
    if (/CON\s+LOGIN|SI\s+LOGIN/i.test(text)) classroomHasLogin = true;
    if (/SIN\s+MODALIDAD|NO\s+MODALIDAD/i.test(text)) classroomHasEvaluationMode = false;
    if (/CON\s+MODALIDAD|SI\s+MODALIDAD/i.test(text)) classroomHasEvaluationMode = true;
    if (/SIN\s+ACTIVIDAD/i.test(text)) classroomHasActivities = false;
    if (/CON\s+ACTIVIDAD/i.test(text)) classroomHasActivities = true;
    if (/(?:SIN|NO HAY|NINGUNO).*?(?:REGISTRO|ACTIVIDAD)|ÚLTIMO ACCESO.*?NUNCA|ULTIMO ACCESO.*?NUNCA/i.test(text)) {
      lastCourseAccess = 'NEVER';
      classroomHasActivities = false;
    }
    if (/(?:P[ÁA]GINA\s+\d+\s+DE\s+\d+|MOSTRANDO\s+\d+\s+DE|SIGUIENTE|ANTERIOR|REGISTROS\s+POR\s+P[ÁA]GINA|SCROLL)/i.test(text)) {
      completeness.CALL = completeness.CALL === 'COMPLETE' ? 'PARTIAL' : completeness.CALL;
      completeness.WRITTEN = 'PARTIAL';
      warnings.push('POTENTIALLY_PARTIAL_LIST');
    }
  }

  const source = primarySource ?? { evidenceId: '', artifactId: '', extractor: 'deterministic-v1' };
  const calls = attempts.filter((attempt) => attempt.kind === 'CALL');
  const written = attempts.filter((attempt) => attempt.kind !== 'CALL');
  facts.push({ auditId: input.auditId, runId: input.runId, factType: 'contact.callAttempts', value: { events: calls, observedCount: Math.max(observedCounts.CALL, calls.length), sourceCompleteness: completeness.CALL, warnings }, sourceRef: source, confidence: 0.85 });
  facts.push({ auditId: input.auditId, runId: input.runId, factType: 'contact.writtenInteractions', value: { events: written, observedCount: Math.max(observedCounts.WRITTEN, written.length), sourceCompleteness: completeness.WRITTEN, warnings }, sourceRef: source, confidence: 0.85 });
  if (effectiveContact !== undefined) facts.push({ auditId: input.auditId, runId: input.runId, factType: 'contact.effectiveContact', value: effectiveContact, sourceRef: source, confidence: 0.8 });
  if (studentLevel) facts.push({ auditId: input.auditId, runId: input.runId, factType: 'student.level', value: studentLevel, sourceRef: source, confidence: 0.8 });
  if (studentName) facts.push({ auditId: input.auditId, runId: input.runId, factType: 'student.name', value: studentName, sourceRef: source, confidence: 0.8 });
  if (studentEnrollment) facts.push({ auditId: input.auditId, runId: input.runId, factType: 'student.enrollment', value: studentEnrollment, sourceRef: source, confidence: 0.8 });
  if (classroomHasLogin !== undefined) facts.push({ auditId: input.auditId, runId: input.runId, factType: 'classroom.hasLogin', value: classroomHasLogin, sourceRef: source, confidence: 0.8 });
  if (classroomHasEvaluationMode !== undefined) facts.push({ auditId: input.auditId, runId: input.runId, factType: 'classroom.hasEvaluationMode', value: classroomHasEvaluationMode, sourceRef: source, confidence: 0.8 });
  if (classroomHasActivities !== undefined) facts.push({ auditId: input.auditId, runId: input.runId, factType: 'classroom.hasActivities', value: classroomHasActivities, sourceRef: source, confidence: 0.8 });
  if (lastCourseAccess) facts.push({ auditId: input.auditId, runId: input.runId, factType: 'academic.lastCourseAccess', value: lastCourseAccess, sourceRef: source, confidence: 0.8 });
  if (platformAccessEvents !== undefined) facts.push({ auditId: input.auditId, runId: input.runId, factType: 'academic.platformAccessEvents', value: platformAccessEvents, sourceRef: source, confidence: 0.8 });
  return facts;
}

export function textArtifactResult(text: string, extra: Record<string, unknown> = {}) {
  return { text, textSha256: createHash('sha256').update(text).digest('hex'), ...extra };
}
