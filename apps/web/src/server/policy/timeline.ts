import type { AuditManualComments, HumanDecisionExtract, StoredFact } from '@cancelaciones/db';

export type TimelineEventKind = 'TICKET' | 'COMMENT' | 'CONTACT_ATTEMPT' | 'REPLICA' | 'REOPENING' | 'ASSIGNMENT' | 'CLASSROOM' | 'DICTAMEN';

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  occurredAt: string;
  title: string;
  detail: string;
  sourceType: 'fact' | 'comment' | 'human-decision' | 'manual';
  sourceRef?: Record<string, unknown>;
  /** Solo el dictamen final (o resolución humana) cuenta como resolución. */
  isFinalResolution?: boolean;
}

export interface CaseTimeline {
  events: TimelineEvent[];
  finalResolution: TimelineEvent | null;
  warnings: string[];
}

interface ContactEventLike {
  id?: string;
  kind?: string;
  occurredAt?: string;
  dateTime?: string;
  status?: string;
  campaign?: string;
}

function eventOf(attempt: ContactEventLike, sourceRef: Record<string, unknown>, channel: string): TimelineEvent | null {
  const occurredAt = attempt.occurredAt ?? attempt.dateTime;
  if (!occurredAt) return null;
  const kind: TimelineEventKind = channel === 'CALL' ? 'CONTACT_ATTEMPT' : 'CONTACT_ATTEMPT';
  return {
    id: attempt.id ?? `attempt-${occurredAt}`,
    kind,
    occurredAt,
    title: `${channel === 'CALL' ? 'Llamada' : 'Interaccion escrita'} ${attempt.status ? `(${attempt.status})` : ''}`.trim(),
    detail: attempt.campaign ? `Campana: ${attempt.campaign}` : '',
    sourceType: 'fact',
    sourceRef,
  };
}

/**
 * Construye la línea de tiempo del caso en orden cronológico: ticket, comentarios,
 * intentos de contacto, réplicas/reaperturas, asignaciones y dictamen final.
 *
 * Regla clave: los comentarios tempranos (p. ej. "se rechaza") NO son la
 * resolución final; solo el dictamen oficial (human decision) la determina.
 */
export function buildCaseTimeline(input: {
  auditId: string;
  storedFacts: StoredFact[];
  manualComments: AuditManualComments | null;
  humanDecisionExtract: HumanDecisionExtract | null;
}): CaseTimeline {
  const events: TimelineEvent[] = [];
  const warnings: string[] = [];

  for (const fact of input.storedFacts) {
    const raw = fact.value;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const collection = raw as { events?: ContactEventLike[] };
    if (!Array.isArray(collection.events)) continue;
    const channel = fact.factType.includes('callAttempts') ? 'CALL' : 'WRITTEN';
    for (const attempt of collection.events) {
      const event = eventOf(attempt, fact.sourceRef, channel);
      if (event) events.push(event);
    }
  }

  const comments = input.manualComments;
  if (comments) {
    const commentEntries: Array<[string, string | null]> = [
      ['Back Office', comments.backOfficeComment],
      ['Helpdesk', comments.helpdeskComment],
      ['Servicios Escolares', comments.schoolServicesComment],
      ['Finanzas', comments.financeComment],
      ['Adicional', comments.additionalComment],
    ];
    for (const [area, comment] of commentEntries) {
      if (!comment || !comment.trim()) continue;
      events.push({
        id: `comment-${area.toLowerCase().replace(/\s+/g, '-')}`,
        kind: 'COMMENT',
        occurredAt: comments.createdAt,
        title: `Comentario ${area}`,
        detail: comment.trim().slice(0, 240),
        sourceType: 'comment',
        sourceRef: { commentArea: area },
      });
    }
  }

  const human = input.humanDecisionExtract;
  if (human && human.decisionDate) {
    events.push({
      id: `dictamen-${human.id}`,
      kind: 'DICTAMEN',
      occurredAt: human.decisionDate,
      title: `Dictamen humano: ${human.resolution ?? 'sin resolucion declarada'}`,
      detail: human.motives.join('; ').slice(0, 240),
      sourceType: 'human-decision',
      sourceRef: { extractId: human.id },
      isFinalResolution: true,
    });
  }

  events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const earlyRejections = events.filter((event) => event.kind === 'COMMENT' && /rechaz/i.test(event.detail));
  if (earlyRejections.length > 0 && !events.some((event) => event.isFinalResolution)) {
    warnings.push('Existen comentarios de rechazo previos sin dictamen final; no se trataron como resolucion.');
  }

  const finalResolution = events.find((event) => event.isFinalResolution) ?? null;
  return { events, finalResolution, warnings };
}