// =============================================================================
// Vista segura de `audits.provider_metadata`: qué sobrevive al DTO y al log.
//
// Por qué existe: una auditoría murió en producción con
// `INVALID_EVIDENCE_REFERENCE` y no hubo forma de saber qué pasó. Con
// `path`/`detail` en el diagnóstico, el allowlist es la ÚNICA puerta que
// decide si esa información llega a la API — y es también la última línea antes
// de que algo crudo del modelo sezeigt en pantalla.
//
// Lo que fija:
//   1) `failureCategory`, `path` y `detail` de un intento fallido se conservan.
//   2) Siguen acotados y en una sola línea.
//   3) Un `detail` con caracteres que nuestros emisores NUNCA producen (texto
//      libre del modelo, JSON, acentos, saltos) se neutraliza: `provider_metadata`
//      es JSONB libre y podría traer cualquier cosa de una escritura vieja.
// =============================================================================

import { describe, expect, it } from 'vitest';
import {
  buildAuditFailureLog,
  sanitizeAttemptDiagnostic,
  sanitizeProviderMetadata,
} from '../src/server/audit-observability';
import type { OpenRouterAttemptDiagnostic } from '../src/server/openrouter';

/** Intento que el transporte sí produce tras un fallo por referencia a evidencia. */
function referenceAttempt(overrides: Partial<OpenRouterAttemptDiagnostic> = {}): OpenRouterAttemptDiagnostic {
  return {
    model: 'google/gemini-2.5-flash-lite',
    format: 'json_schema',
    status: 200,
    providerErrorType: null,
    finishReason: 'stop',
    latencyMs: 9_120,
    promptTokens: 18_204,
    completionTokens: 4_096,
    totalTokens: 22_300,
    cost: 0.00041,
    maxOutputTokensRequested: 16_384,
    capabilitiesVerified: true,
    retryable: false,
    failureCategory: 'INVALID_EVIDENCE_REFERENCE',
    failureReason: 'unknown evidence reference at facts.3.evidenceIds: evidencia inexistente ev-falso',
    path: 'facts.3.evidenceIds',
    detail: 'evidencia inexistente ev-falso',
    ...overrides,
  };
}

describe('saneo de provider_metadata: ruta y detalle del fallo', () => {
  it('conserva failureCategory, path y detail de un intento fallido', () => {
    const view = sanitizeAttemptDiagnostic(referenceAttempt());

    expect(view).toMatchObject({
      failureCategory: 'INVALID_EVIDENCE_REFERENCE',
      path: 'facts.3.evidenceIds',
      detail: 'evidencia inexistente ev-falso',
      failureReason: 'unknown evidence reference at facts.3.evidenceIds: evidencia inexistente ev-falso',
    });
  });

  it('un intento sin ruta ni detalle los expone como null, no como claves ausentes', () => {
    // Forma estable: el consumidor no tiene que distinguir "no vino" de "es null".
    const view = sanitizeAttemptDiagnostic({
      format: 'json_schema',
      failureCategory: 'RATE_LIMIT',
      status: 429,
      latencyMs: 800,
    });

    expect(view).not.toBeNull();
    expect(view?.path).toBeNull();
    expect(view?.detail).toBeNull();
  });

  it('acota el largo y colapsa saltos de línea', () => {
    const view = sanitizeAttemptDiagnostic({
      format: 'json_schema',
      path: 'facts.3.evidenceIds',
      detail: `evidencia inexistente ev-falso\n${'x'.repeat(400)}`,
    });

    expect(view?.detail).not.toContain('\n');
    expect(view?.detail?.length).toBeLessThanOrEqual(200);
    expect(view?.detail).toContain('evidencia inexistente ev-falso');
  });

  it.each([
    ['texto libre del modelo', '{"studentName":"María Pérez"}'],
    ['acentos y eñes', 'evidencia inexistente: la alumna noStemó'],
    ['marcas de plantilla', '<script>alert(1)</script>'],
    ['comillas y saltos', 'evidencia "inexistente"\nUTEL-2026-001'],
  ])('neutraliza un detail con %s', (_label, detail) => {
    const view = sanitizeAttemptDiagnostic({ format: 'json_schema', failureCategory: 'INVALID_EVIDENCE_REFERENCE', detail });

    // El detalle que no parece un texto ATESTIGUADO por nosotros no se publica.
    expect(view?.detail).toBeNull();
    expect(JSON.stringify(view)).not.toContain('María Pérez');
    expect(JSON.stringify(view)).not.toContain('UTEL-2026-001');
    expect(JSON.stringify(view)).not.toContain('script');
  });

  it('el detalle del diagnóstico tampoco se cuela por una clave no permitida', () => {
    const view = sanitizeProviderMetadata({
      openrouterAttempts: [
        {
          ...referenceAttempt(),
          detail: 'evidencia inexistente ev-falso',
          rawModelOutput: '{"case":{"studentName":"María Pérez"}}',
          prompt: 'PROCEDIMIENTO V5 + expediente',
        },
      ],
    });

    const serialized = JSON.stringify(view);
    expect(view?.openrouterAttempts?.[0]?.detail).toBe('evidencia inexistente ev-falso');
    expect(serialized).not.toContain('María Pérez');
    expect(serialized).not.toContain('PROCEDIMIENTO V5');
    expect(serialized).not.toContain('rawModelOutput');
  });

  it('el log de fallo lleva la ruta y el detalle, y solo los campos permitidos', () => {
    const log = buildAuditFailureLog({
      auditId: 'audit-1',
      caseId: 'case-1',
      errorCategory: 'INVALID_EVIDENCE_REFERENCE',
      error: new Error('mensaje crudo que no debe aparecer en el log'),
      model: 'google/gemini-2.5-flash-lite',
      latencyMs: 21_700,
      diagnostics: [referenceAttempt()],
    });

    const attempt = log.openrouterAttempts[0];
    expect(attempt).toMatchObject({
      failureCategory: 'INVALID_EVIDENCE_REFERENCE',
      path: 'facts.3.evidenceIds',
      detail: 'evidencia inexistente ev-falso',
    });
    expect(Object.keys(attempt).sort()).toEqual(
      [
        'capabilitiesVerified',
        'completionTokens',
        'detail',
        'failureCategory',
        'failureReason',
        'finishReason',
        'format',
        'latencyMs',
        'path',
        'promptTokens',
        'retryable',
        'status',
      ].sort(),
    );
    expect(JSON.stringify(log)).not.toContain('mensaje crudo');
  });
});