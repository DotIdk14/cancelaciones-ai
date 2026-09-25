import { describe, expect, it } from 'vitest';
import { classifyJobError, retryDelaySeconds } from './error-taxonomy';

/**
 * Test de regresión del incidente del 2026-09-25.
 *
 * El defecto: `executeClaimedJob` hacía
 *   catch (error) { scheduleRetry(..., 'SYNTHETIC_TRANSIENT_ERROR', message, 30) }
 * Es decir, TODO error era transitorio. Y `FACT_RUN_NOT_PROCESSING: DRAFT` es
 * determinista: el run seguía en DRAFT, así que en el reintento seguía en
 * DRAFT. Se consumieron 2 de 3 intentos en algo que no podía funcionar nunca, y
 * el job quedó en RETRY_SCHEDULED, que es el estado que mantiene vivo el bucle
 * de POST del incidente.
 */

describe('classifyJobError — el error exacto del incidente', () => {
  it('FACT_RUN_NOT_PROCESSING es TERMINAL, no reintentable', () => {
    const result = classifyJobError(new Error('FACT_RUN_NOT_PROCESSING: DRAFT'));
    expect(result.retryable).toBe(false);
    expect(result.code).toBe('DETERMINISTIC_STATE_ERROR');
  });

  it('el estado ya FROZEN es determinista también', () => {
    expect(classifyJobError(new Error('FACT_RUN_NOT_PROCESSING: FROZEN')).retryable).toBe(false);
  });

  it('un run no congelable también', () => {
    expect(classifyJobError(new Error('FACT_RUN_STATE_NOT_PROCESSABLE: FAILED')).retryable).toBe(false);
  });

  it('nunca se marca como cobrado un error que no lo pudo cobrar', () => {
    expect(classifyJobError(new Error('FACT_RUN_NOT_PROCESSING: DRAFT')).costMayHaveBeenCharged).toBe(false);
  });
});

describe('classifyJobError — transientes', () => {
  it.each([
    ['429 Too Many Requests', 'RATE_LIMITED'],
    ['ETIMEDOUT', 'TIMEOUT'],
    ['ECONNRESET', 'NETWORK_ERROR'],
    ['fetch failed', 'NETWORK_ERROR'],
    ['DEPENDENCY_NOT_READY: hay EVIDENCE_PROCESSING sin terminar', 'DEPENDENCY_NOT_READY'],
    ['EVIDENCE_NOT_FOUND', 'DEPENDENCY_NOT_READY'],
    ['ENOENT: no such file or directory', 'DEPENDENCY_NOT_READY'],
    ['OPENROUTER_ERROR_503', 'TRANSIENT_PROVIDER_ERROR'],
  ])('clasifica %s como reintentable', (message, code) => {
    const result = classifyJobError(new Error(message));
    expect(result.retryable).toBe(true);
    expect(result.code).toBe(code);
  });
});

describe('classifyJobError — terminales', () => {
  it.each([
    ['FORBIDDEN', 'PERMISSION_ERROR'],
    ['AUTH_REQUIRED', 'AUTH_ERROR'],
    ['FACT_RUN_EMPTY', 'VALIDATION_ERROR'],
    ['FROZEN_SNAPSHOT_PAYLOAD_INVALID: facts[0].type ausente', 'VALIDATION_ERROR'],
    ['APPEND_ONLY_TABLE: ai_decision_snapshots', 'PERSISTENCE_ERROR'],
    ['duplicate key value violates unique constraint "ai_usage_..."', 'PERSISTENCE_ERROR'],
    ['value in column "fact_type" violates not-null constraint', 'PERSISTENCE_ERROR'],
    ['PROVIDER_RESULT_UNKNOWN: la llamada anterior no tiene resultado', 'PROVIDER_RESULT_UNKNOWN'],
    ['ASSEMBLYAI_API_KEY_NOT_CONFIGURED', 'PROVIDER_PERMANENT_ERROR'],
  ])('clasifica %s como terminal', (message, code) => {
    const result = classifyJobError(new Error(message));
    expect(result.retryable).toBe(false);
    expect(result.code).toBe(code);
  });

  it('un 4xx de proveedor es PERMANENTE, aunque el mensaje diga 4xx', () => {
    // El orden importa: TERMINAL se evalúa antes que RETRYABLE para que un
    // "400" dentro de un error de proveedor no se lea como transitorio.
    expect(classifyJobError(new Error('OPENROUTER_ERROR_400: bad request')).code).toBe('PROVIDER_PERMANENT_ERROR');
  });

  it('sólo PROVIDER_RESULT_UNKNOWN puede llevar la marca de coste', () => {
    expect(classifyJobError(new Error('PROVIDER_RESULT_UNKNOWN')).costMayHaveBeenCharged).toBe(true);
    expect(classifyJobError(new Error('TIMEOUT')).costMayHaveBeenCharged).toBe(false);
  });
});

describe('classifyJobError — el fallback importa', () => {
  it('un error NO reconocido es TERMINAL, no retryable', () => {
    // Este es el punto. La alternativa ("reintentar por si acaso") es
    // exactamente lo que causó el incidente: un error no reconocido se
    // reintentaba, el reintento fallaba igual, y el job se quedaba en
    // RETRY_SCHEDULED. Ante la duda, parar es reversible; cobrar dos veces, no.
    const result = classifyJobError(new Error('algo raro que no conozco'));
    expect(result.retryable).toBe(false);
    expect(result.code).toBe('DETERMINISTIC_STATE_ERROR');
  });

  it('nunca devuelve el nombre del fixture de test', () => {
    const codes = ['algo raro', 'x'.repeat(50), '', 'EVIDENCE_NOT_FOUND', '429'].map((message) => classifyJobError(new Error(message)).code);
    expect(codes).not.toContain('SYNTHETIC_TRANSIENT_ERROR');
  });

  it('un error no-Error con mensaje de reserva también se clasifica', () => {
    expect(classifyJobError(undefined, 'FACT_RUN_NOT_PROCESSING: DRAFT').retryable).toBe(false);
  });
});

describe('retryDelaySeconds', () => {
  it('crece con el intento y tiene tope', () => {
    expect(retryDelaySeconds(1)).toBe(30);
    expect(retryDelaySeconds(2)).toBe(60);
    expect(retryDelaySeconds(3)).toBe(120);
    // No crece hasta el infinito: un backoff sin tope意味着 un job invisible.
    expect(retryDelaySeconds(50)).toBe(15 * 60);
  });

  it('un intento 0 o negativo no rompe nada', () => {
    expect(retryDelaySeconds(0)).toBe(30);
    expect(retryDelaySeconds(-5)).toBe(30);
  });
});
