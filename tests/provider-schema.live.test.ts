import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditSkill } from '../src/skills/audit/execute';
import { parseAuditResult } from '../src/skills/audit/schema';

describe.skipIf(process.env.RUN_AI_SMOKE !== '1' || !process.env.OPENROUTER_API_KEY)('regresión live de complejidad Gemini con siete imágenes sintéticas', () => {
  it('genera un assessment validado sin gastar un intento en rechazo del schema', async () => {
    const image = readFileSync(resolve('tests/fixtures/synthetic-blank.png'));
    const execution = await auditSkill.executeWithMetadata({
      caseId: 'synthetic-schema-states-case', studentIdentifier: null,
      evidences: Array.from({ length: 7 }, (_, index) => ({
        evidenceId: randomUUID(), filename: `imagen-sintetica-${index + 1}.png`,
        mimeType: 'image/png', kind: 'IMAGE' as const, sizeBytes: image.length,
        sha256: 'synthetic-image-not-real-evidence', createdAt: '2026-10-20T12:00:00Z',
        imageBase64: `data:image/png;base64,${image.toString('base64')}`,
        text: 'Prueba técnica con imagen en blanco y sin datos personales. No acredita matrícula, fechas ni contactos.',
      })),
    });
    expect(execution.attempts.length).toBeGreaterThan(0);
    expect(execution.attempts.length).toBeLessThanOrEqual(2);
    expect(execution.attempts.every(attempt => attempt.format === 'json_schema')).toBe(true);
    expect(execution.attempts.some(attempt => attempt.failureCategory === 'PROVIDER_BAD_REQUEST')).toBe(false);
    expect(parseAuditResult(execution.result)).toEqual(execution.result);
    process.stdout.write(`AI_SCHEMA_SMOKE_COMPLETED images=7 attempts=${execution.attempts.length} model=${execution.model}\n`);
  }, 180_000);
});
