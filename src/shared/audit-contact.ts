import { z } from 'zod';

/** Solo la respuesta y el intento observado vienen del cliente. */
export const ContactAnswerSchema = z.object({
  auditId: z.string().min(1).max(100).nullable(),
  evidenceFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  performed: z.boolean(),
}).strict();
export type ContactAnswer = z.infer<typeof ContactAnswerSchema>;

/** Atribución y alcance compuestos exclusivamente por el servidor. */
export const ContactConfirmationSchema = z.object({
  performed: z.boolean(),
  actorId: z.string().min(1),
  confirmedAt: z.string().datetime(),
  evidenceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sourceAuditId: z.string().min(1).nullable(),
}).strict();
export type ContactConfirmation = z.infer<typeof ContactConfirmationSchema>;

export function readContactConfirmation(metadata: unknown): ContactConfirmation | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const parsed = ContactConfirmationSchema.safeParse((metadata as Record<string, unknown>).contactConfirmation);
  return parsed.success ? parsed.data : null;
}

interface ContactAudit {
  status: string;
  resultJson?: unknown;
  providerMetadata?: {
    contactConfirmation?: { performed: boolean };
    openrouterAttempts?: Array<{ failureCategory?: string | null; detail?: string | null; failureReason?: string | null }>;
  } | null;
}

/** Señal de presentación; los permisos y la vigencia se verifican en servidor. */
export function needsContactConfirmation(audit: ContactAudit | null): boolean {
  if (!audit || audit.providerMetadata?.contactConfirmation?.performed === true) return false;
  if (audit.status === 'ERROR') {
    return audit.providerMetadata?.openrouterAttempts?.some(attempt =>
      attempt.failureCategory === 'SCHEMA_VALIDATION_ERROR'
      && /5\.2/.test(`${attempt.detail ?? ''} ${attempt.failureReason ?? ''}`),
    ) ?? false;
  }
  const result = audit.resultJson as { audit?: { result?: string; missingEvidence?: Array<{ relatedProcedureSection: string; blocking: boolean }> } } | null;
  return audit.status === 'COMPLETED' && result?.audit?.result === 'TICKET_RECHAZADO'
    && (result.audit.missingEvidence?.some(item => item.blocking && /(^|\D)5\.2(\D|$)/.test(item.relatedProcedureSection)) ?? false);
}
