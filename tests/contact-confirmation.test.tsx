// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContactConfirmationNotice } from '../src/components/ContactConfirmationNotice';
import { ContactAnswerSchema, needsContactConfirmation, readContactConfirmation } from '../src/shared/audit-contact';
import { fingerprintWithContactContext } from '../src/server/audit-fingerprint';
import { sanitizeProviderMetadata } from '../src/server/audit-observability';
import { parseAuditResult } from '../src/skills/audit/schema';
import { buildAuditMessages } from '../src/skills/audit/execute';
import { validAuditResult } from './fixtures/audit-result';
import type { AuditDetail } from '../src/lib/api';

const base = 'a'.repeat(64);
const contact = { performed: true, actorId: 'server-user', confirmedAt: '2026-10-21T21:46:53.000Z', evidenceFingerprint: base, sourceAuditId: 'audit-1' };
const failed = {
  id: 'audit-1', status: 'ERROR',
  providerMetadata: { openrouterAttempts: [{ failureCategory: 'SCHEMA_VALIDATION_ERROR', detail: '5.2 observedValues exactos', failureReason: null }] },
} as AuditDetail;
afterEach(cleanup);

describe('confirmación humana de contacto', () => {
  it('solo admite Sí/No y el intento observado, sin atribución enviada por el cliente', () => {
    expect(ContactAnswerSchema.safeParse({ auditId: 'audit-1', performed: 'sí' }).success).toBe(false);
    expect(ContactAnswerSchema.safeParse({ auditId: 'audit-1', performed: true, actorId: 'otro' }).success).toBe(false);
    expect(ContactAnswerSchema.parse({ auditId: 'audit-1', performed: false }).performed).toBe(false);
  });

  it('la confirmación es durable, acotada al expediente y no modifica huellas históricas sin confirmación', () => {
    const metadata = { contactConfirmation: contact };
    expect(readContactConfirmation(metadata)).toEqual(contact);
    const confirmed = fingerprintWithContactContext(base, metadata);
    expect(confirmed).not.toBe(base);
    expect(fingerprintWithContactContext(base, metadata)).toBe(confirmed);
    expect(fingerprintWithContactContext('b'.repeat(64), metadata)).toBe('b'.repeat(64));
    expect(fingerprintWithContactContext(base, { contactConfirmation: { ...contact, performed: false } })).toBe(base);
    expect(fingerprintWithContactContext(base, undefined)).toBe(base);
    expect(readContactConfirmation({ contactConfirmation: { performed: true } })).toBeNull();
    expect(sanitizeProviderMetadata(metadata)?.contactConfirmation).toEqual({ performed: true, confirmedAt: contact.confirmedAt });
    expect(sanitizeProviderMetadata(metadata)?.contactConfirmation).not.toHaveProperty('actorId');
  });

  it('ofrece la confirmación para fallos 5.2 y rechazos con registros faltantes, sin confundir otros fallos', () => {
    expect(needsContactConfirmation(failed)).toBe(true);
    expect(needsContactConfirmation({ ...failed, providerMetadata: { openrouterAttempts: [{ failureCategory: 'TIMEOUT', detail: '5.2' }] } })).toBe(false);
    expect(needsContactConfirmation({ status: 'COMPLETED', resultJson: { audit: { result: 'TICKET_RECHAZADO', missingEvidence: [{ blocking: true, relatedProcedureSection: '5.2' }] } } })).toBe(true);
    expect(needsContactConfirmation({ ...failed, providerMetadata: { ...failed.providerMetadata, contactConfirmation: { performed: true } } })).toBe(false);
  });

  it('permite continuar sin fabricar conteos y mantiene las demás validaciones', () => {
    const assessment = structuredClone(validAuditResult);
    assessment.audit.procedureChecks[0]!.observedValues = [];
    assessment.audit.procedureChecks[0]!.evidenceIds = [];
    assessment.audit.procedureChecks[0]!.status = 'NO_DETERMINABLE';
    expect(() => parseAuditResult(assessment)).toThrow();
    expect(parseAuditResult(assessment, { humanContactPerformed: true }).audit.result).toBe(assessment.audit.result);
    expect(assessment.audit.procedureChecks[0]!.observedValues).toEqual([]);
    expect(() => parseAuditResult(assessment, { humanContactPerformed: false })).toThrow();
    assessment.origin.evidenceIds = [];
    expect(() => parseAuditResult(assessment, { humanContactPerformed: true })).toThrow();
  });

  it('informa al modelo del origen humano sin crear evidencia ficticia', () => {
    const input = { caseId: 'case-1', studentIdentifier: null, evidences: [], humanContactPerformed: true };
    expect(buildAuditMessages(input).system).toContain('CONFIRMACIÓN HUMANA DE CONTACTO');
    expect(buildAuditMessages({ ...input, humanContactPerformed: false }).system).not.toContain('CONFIRMACIÓN HUMANA DE CONTACTO');
  });

  it('Sí solicita continuar y No solo registra la respuesta; sin permiso no muestra acciones', () => {
    const answer = vi.fn();
    const request = { auditId: 'audit-1', evidenceFingerprint: base };
    const view = render(<ContactConfirmationNotice audit={failed} request={request} canConfirm busy={false} onAnswer={answer} />);
    fireEvent.click(screen.getByRole('button', { name: /Sí, se realizó contacto/ }));
    expect(answer).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'No se realizó contacto' }));
    expect(answer).toHaveBeenLastCalledWith(false);
    view.rerender(<ContactConfirmationNotice audit={failed} canConfirm={false} busy={false} onAnswer={answer} />);
    expect(screen.queryByRole('button')).toBeNull();
    view.rerender(<ContactConfirmationNotice audit={{ ...failed, providerMetadata: { ...failed.providerMetadata, contactConfirmation: { performed: false, confirmedAt: contact.confirmedAt } } }} canConfirm busy={false} onAnswer={answer} />);
    expect(screen.getByRole('status').textContent).toContain('permanece detenida');
    view.rerender(<ContactConfirmationNotice audit={failed} request={request} canConfirm busy onAnswer={answer} />);
    expect((screen.getByRole('button', { name: /Sí, se realizó contacto/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
