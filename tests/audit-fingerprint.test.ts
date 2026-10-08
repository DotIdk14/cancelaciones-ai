import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  AUDIT_PIPELINE_VERSION,
  computeEvidenceFingerprint,
  computeEvidenceFingerprintFor,
} from '../src/server/audit-service';
import type { EvidenceRow } from '../src/server/cases';

const evidence = (id: string): EvidenceRow =>
  ({ id, hash: `hash-${id}`, transcript_json: null }) as unknown as EvidenceRow;

/**
 * Reproduce el payload canónico LEGADO (el anterior a la fecha del equipo).
 *
 * Es la fórmula vieja, escrita aquí a mano y A PROPÓSITO duplicada: es lo único
 * que puede fijar que la huella no se movió ni un byte para los casos que nunca
 * capturan la fecha. Usa filas sin transcripción para que el `derivedHash` sea
 * reproducible sin copiar `readTranscriptFromJson`.
 */
function legacyPayload(version: string, rows: EvidenceRow[]): string {
  const canonical = rows
    .map((row) => ({ id: row.id, hash: row.hash, derivedHash: null }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ pipeline: version, evidence: canonical });
}

function legacyFingerprint(version: string, rows: EvidenceRow[]): string {
  return createHash('sha256').update(legacyPayload(version, rows)).digest('hex');
}

describe('huella del expediente', () => {
  it('la misma evidencia con el mismo pipeline da la misma huella', () => {
    const rows = [evidence('ev-1'), evidence('ev-2')];

    expect(computeEvidenceFingerprint(rows)).toBe(computeEvidenceFingerprint(rows));
  });

  it('la versión del pipeline forma parte de la huella', () => {
    const rows = [evidence('ev-1')];

    const anterior = computeEvidenceFingerprintFor('audit-v5-pipeline-1', rows);
    const vigente = computeEvidenceFingerprintFor('audit-v5-pipeline-2', rows);

    expect(anterior).not.toBe(vigente);
    expect(computeEvidenceFingerprint(rows)).toBe(computeEvidenceFingerprintFor(AUDIT_PIPELINE_VERSION, rows));
  });

  it('un byte distinto en una evidencia cambia la huella', () => {
    const base = [{ ...evidence('ev-1'), hash: 'hash-a' } as unknown as EvidenceRow];
    const cambiado = [{ ...evidence('ev-1'), hash: 'hash-b' } as unknown as EvidenceRow];

    expect(computeEvidenceFingerprint(base)).not.toBe(computeEvidenceFingerprint(cambiado));
  });
});

// La fecha de inicio que captura el equipo cambia lo que el modelo ve, así que
// tiene que formar parte de QUÉ se audita: sin ella en la huella, "Volver a
// auditar" devolvía el dictamen cacheado y la fecha nunca entraba al análisis.
describe('huella del expediente — fecha de inicio aportada por el equipo', () => {
  it('SIN captura, la huella es BYTE A BYTE la del cálculo anterior (nadie se re-audita)', () => {
    // ESTA es la prueba que evita la reauditoría masiva. Si alguien agrega
    // siempre el campo (aunque valga null o '') la huella cambia, este test
    // falla y todos los dictámenes existentes se invalidan de golpe.
    const rows = [evidence('ev-1'), evidence('ev-2')];
    const legacy = legacyFingerprint(AUDIT_PIPELINE_VERSION, rows);

    expect(computeEvidenceFingerprint(rows)).toBe(legacy);
    // Columna ausente (undefined), explícitamente nula, o cadena vacía: los tres
    // significan "no hay captura" y conservan la huella heredada.
    expect(computeEvidenceFingerprint(rows, undefined)).toBe(legacy);
    expect(computeEvidenceFingerprint(rows, null)).toBe(legacy);
    expect(computeEvidenceFingerprint(rows, '')).toBe(legacy);
    // Tampoco por el otro punto de entrada, que es el de producción.
    expect(computeEvidenceFingerprintFor(AUDIT_PIPELINE_VERSION, rows, null)).toBe(legacy);
  });

  it('CON captura, la huella cambia y el dictamen cacheado deja de ser reutilizable', () => {
    const rows = [evidence('ev-1'), evidence('ev-2')];

    const sinFecha = computeEvidenceFingerprint(rows);
    const conFecha = computeEvidenceFingerprint(rows, '2026-08-21');

    expect(conFecha).not.toBe(sinFecha);
    expect(conFecha).not.toBe(legacyFingerprint(AUDIT_PIPELINE_VERSION, rows));
  });

  it('el valor que entra es EXACTAMENTE el de la columna, no otro', () => {
    // Se fija contra el payload completo, con la fecha leída de la columna: si
    // el código normalizara, truncara o completara el valor, este hash no
    // coincidiría.
    const rows = [evidence('ev-1')];
    const capturada = '2026-08-21';
    const canonical = [{ id: 'ev-1', hash: 'hash-ev-1', derivedHash: null }];
    const esperado = createHash('sha256')
      .update(JSON.stringify({ pipeline: AUDIT_PIPELINE_VERSION, evidence: canonical, humanCycleStartDate: capturada }))
      .digest('hex');

    expect(computeEvidenceFingerprint(rows, capturada)).toBe(esperado);
  });

  it('dos fechas distintas dan huellas distintas y la misma fecha repetida da la misma (idempotente)', () => {
    const rows = [evidence('ev-1')];

    const primera = computeEvidenceFingerprint(rows, '2026-08-21');
    const otra = computeEvidenceFingerprint(rows, '2026-09-01');

    expect(primera).not.toBe(otra);
    expect(computeEvidenceFingerprint(rows, '2026-08-21')).toBe(primera);
  });
});