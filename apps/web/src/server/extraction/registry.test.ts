import type { JobArtifact } from '@cancelaciones/db';
import type { ExtractionTool, ExtractionToolContext } from './contracts';
import { extractionToolOutputSchema } from './contracts';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createDefaultExtractionToolRegistry, createExtractionToolRegistry } from './registry';
import { extractDatesTool } from './tools/extract-dates';

function tool(id = 'extract_dates'): ExtractionTool<{ value: string }> {
  return {
    id,
    version: '1.0.0',
    inputSchemaVersion: '1.0.0',
    outputSchemaVersion: '1.0.0',
    deterministic: true,
    inputSchema: z.object({ value: z.string().min(1) }).strict(),
    outputSchema: extractionToolOutputSchema,
    execute: vi.fn(async () => ({ facts: [] })),
  };
}

describe('ExtractionToolRegistry', () => {
  it('expone metadata estable y ejecuta el tool registrado', async () => {
    const registeredTool = tool();
    const registry = createExtractionToolRegistry([registeredTool]);
    const context: ExtractionToolContext = {
      auditId: 'audit-1',
      mode: 'SHADOW',
      evidences: [{ id: 'evidence-1', auditId: 'audit-1', sha256: 'evidence-hash-1', documentRole: 'EVIDENCE' }],
      artifacts: [],
      allowedEvidenceIds: ['evidence-1'],
    };

    expect(registry.get('extract_dates')).not.toBe(registeredTool);
    expect(Object.isFrozen(registry.get('extract_dates'))).toBe(true);
    const metadata = registry.list();
    expect(metadata).toEqual([{
      id: 'extract_dates',
      version: '1.0.0',
      inputSchemaVersion: '1.0.0',
      outputSchemaVersion: '1.0.0',
      deterministic: true,
    }]);
    expect(Object.isFrozen(metadata[0])).toBe(true);
    expect(registry.get('extract_dates').inputSchema).toBe(registeredTool.inputSchema);
    expect(registry.get('extract_dates').outputSchema).toBe(registeredTool.outputSchema);
    registeredTool.id = 'mutated';
    registeredTool.version = '9.9.9';
    expect(registry.list()[0]).toEqual({
      id: 'extract_dates',
      version: '1.0.0',
      inputSchemaVersion: '1.0.0',
      outputSchemaVersion: '1.0.0',
      deterministic: true,
    });
    await expect(registry.execute('extract_dates', { value: '2026-09-25T10:00:00Z' }, context)).resolves.toEqual({ facts: [] });
    expect(registeredTool.execute).toHaveBeenCalledWith({ value: '2026-09-25T10:00:00Z' }, context);
  });

  it('rechaza modos runtime inválidos antes de ejecutar cualquier tool', async () => {
    for (const mode of ['PROD', 'LEGACY'] as const) {
      const registeredTool = tool(`invalid_mode_${mode}`);
      const registry = createExtractionToolRegistry([registeredTool]);
      const context: ExtractionToolContext = {
        auditId: 'audit-1',
        mode: mode as never,
        evidences: [],
        artifacts: [],
        allowedEvidenceIds: [],
      };

      await expect(registry.execute(registeredTool.id, { value: 'ok' }, context)).rejects.toThrow('EXTRACTION_CONTEXT_INVALID');
      expect(registeredTool.execute).not.toHaveBeenCalled();
    }
  });

  it('rechaza input y output que no pasan sus schemas', async () => {
    const registry = createExtractionToolRegistry([tool()]);
    const leakingTool = tool('extract_contact_attempts');
    leakingTool.execute = vi.fn(async () => ({ facts: [], outcome: 'CANCELACION_VENTA' } as never));
    registry.register(leakingTool);
    const context: ExtractionToolContext = {
      auditId: 'audit-1',
      mode: 'SHADOW',
      evidences: [],
      artifacts: [],
      allowedEvidenceIds: [],
    };

    await expect(registry.execute('extract_dates', { value: '' }, context)).rejects.toThrow('EXTRACTION_INPUT_INVALID');
    await expect(registry.execute('extract_dates', { value: 'ok', outcome: 'CANCELACION_VENTA' }, context)).rejects.toThrow('EXTRACTION_INPUT_INVALID');
    await expect(registry.execute('extract_contact_attempts', { value: 'ok' }, context)).rejects.toThrow('EXTRACTION_OUTPUT_INVALID');
  });

  it('rechaza en runtime schemas que permiten campos normativos', () => {
    for (const forbidden of ['outcome', 'suggestedOutcome', 'decision', 'resolution', 'ruleId', 'matchedRule', 'policyDecision']) {
      const sentinel = tool(`sentinel_${forbidden}`);
      sentinel.outputSchema = z.object({ facts: z.array(z.unknown()), [forbidden]: z.unknown() }).strict() as never;
      expect(() => createExtractionToolRegistry([sentinel])).toThrow('EXTRACTION_OUTPUT_SCHEMA_INVALID');
    }

    const passthrough = tool('passthrough');
    passthrough.outputSchema = z.object({ facts: z.array(z.unknown()) }).passthrough() as never;
    expect(() => createExtractionToolRegistry([passthrough])).toThrow('EXTRACTION_OUTPUT_SCHEMA_INVALID');
  });

  it('rechaza metadata runtime inválida antes de registrar', () => {
    const invalidMetadataTools = [
      { id: '', field: 'id' },
      { id: 'invalid_version', field: 'version' },
      { id: 'invalid_input_schema_version', field: 'inputSchemaVersion' },
      { id: 'invalid_output_schema_version', field: 'outputSchemaVersion' },
    ];

    for (const { id, field } of invalidMetadataTools) {
      const invalid = tool(id);
      invalid[field as 'id' | 'version' | 'inputSchemaVersion' | 'outputSchemaVersion'] = '';
      expect(() => createExtractionToolRegistry([invalid])).toThrow('EXTRACTION_TOOL_METADATA_INVALID');
    }

    const invalidDeterministic = tool('invalid_deterministic');
    invalidDeterministic.deterministic = 'yes' as never;
    expect(() => createExtractionToolRegistry([invalidDeterministic])).toThrow('EXTRACTION_TOOL_METADATA_INVALID');

    const invalidInputSchema = tool('invalid_input_schema');
    invalidInputSchema.inputSchema = {} as never;
    expect(() => createExtractionToolRegistry([invalidInputSchema])).toThrow('EXTRACTION_TOOL_METADATA_INVALID');

    const invalidOutputSchema = tool('invalid_output_schema');
    invalidOutputSchema.outputSchema = {} as never;
    expect(() => createExtractionToolRegistry([invalidOutputSchema])).toThrow('EXTRACTION_TOOL_METADATA_INVALID');
  });

  it('rechaza artifacts inválidos antes de leer result aunque no haya facts', async () => {
    const registry = createDefaultExtractionToolRegistry();
    const artifact: JobArtifact = {
      id: 'artifact-1',
      jobId: 'job-1',
      evidenceId: 'evidence-1',
      artifactType: 'document-text',
      result: {},
      contentSha256: 'artifact-hash-1',
      createdAt: '2026-09-25T00:00:00Z',
    };
    const baseContext: ExtractionToolContext = {
      auditId: 'audit-1',
      mode: 'SHADOW',
      evidences: [{ id: 'evidence-1', auditId: 'audit-1', sha256: 'evidence-hash-1', documentRole: 'EVIDENCE' }],
      artifacts: [artifact],
      allowedEvidenceIds: ['evidence-1'],
    };

    await expect(registry.execute('extract_dates', { artifact }, {
      ...baseContext,
      mode: 'BLIND',
      evidences: [{ ...baseContext.evidences[0], documentRole: 'HUMAN_DECISION_DOCUMENT' }],
    })).rejects.toThrow('EXTRACTION_REFERENCE_INVALID');
    await expect(registry.execute('extract_dates', { artifact }, {
      ...baseContext,
      evidences: [{ ...baseContext.evidences[0], auditId: 'audit-2' }],
    })).rejects.toThrow('EXTRACTION_REFERENCE_INVALID');
    await expect(registry.execute('extract_dates', { artifact }, {
      ...baseContext,
      allowedEvidenceIds: [],
    })).rejects.toThrow('EXTRACTION_REFERENCE_INVALID');
  });

  it('rechaza un schema de output que no valida facts canónicos', async () => {
    const weakSchemaTool = tool('weak_schema');
    weakSchemaTool.outputSchema = z.object({ facts: z.array(z.unknown()) }).strict() as never;
    weakSchemaTool.execute = vi.fn(async () => ({ facts: [null] }) as never);
    const registry = createExtractionToolRegistry([weakSchemaTool]);

    await expect(registry.execute('weak_schema', { value: 'ok' }, {
      auditId: 'audit-1',
      mode: 'SHADOW',
      evidences: [],
      artifacts: [],
      allowedEvidenceIds: [],
    })).rejects.toThrow('EXTRACTION_OUTPUT_INVALID');
  });

  it('falla la segunda barrera si el output referencia evidencia no permitida', async () => {
    const leakingTool = tool('invalid_reference');
    leakingTool.execute = vi.fn(async () => ({
      facts: [{
        factType: 'date',
        value: '2026-09-25T10:00:00Z',
        state: 'OBSERVED' as const,
        provenance: [{
          evidenceId: 'evidence-2',
          artifactId: 'artifact-1',
          artifactHash: 'artifact-hash-1',
          extractionMethod: 'DETERMINISTIC' as const,
          extractorId: 'test',
          extractorVersion: '1.0.0',
        }],
      }],
    }));
    const registry = createExtractionToolRegistry([leakingTool]);

    await expect(registry.execute('invalid_reference', { value: 'ok' }, {
      auditId: 'audit-1',
      mode: 'SHADOW',
      evidences: [{ id: 'evidence-1', auditId: 'audit-1', sha256: 'evidence-hash-1', documentRole: 'EVIDENCE' }],
      artifacts: [],
      allowedEvidenceIds: ['evidence-1'],
    })).rejects.toThrow('EXTRACTION_REFERENCE_INVALID');
  });

  it('registra por defecto únicamente los tools shadow extract_dates y extract_contact_attempts', async () => {
    const registry = createDefaultExtractionToolRegistry();
    const artifact: JobArtifact = {
      id: 'artifact-1',
      jobId: 'job-1',
      evidenceId: 'evidence-1',
      artifactType: 'document-text',
      result: { extractedFacts: [{ factType: 'date', value: '2026-09-25T10:00:00Z' }] },
      contentSha256: 'artifact-hash-1',
      createdAt: '2026-09-25T00:00:00Z',
    };

    expect(registry.get('extract_dates')).not.toBe(extractDatesTool);
    expect(registry.list()).toEqual([
      { id: 'extract_dates', version: '1.0.0', inputSchemaVersion: '1.0.0', outputSchemaVersion: '1.0.0', deterministic: true },
      { id: 'extract_contact_attempts', version: '1.0.0', inputSchemaVersion: '1.0.0', outputSchemaVersion: '1.0.0', deterministic: true },
    ]);
    await expect(registry.execute('extract_dates', { artifact }, {
      auditId: 'audit-1',
      mode: 'SHADOW',
      evidences: [{ id: 'evidence-1', auditId: 'audit-1', sha256: 'evidence-hash-1', documentRole: 'EVIDENCE' }],
      artifacts: [artifact],
      allowedEvidenceIds: ['evidence-1'],
    })).resolves.toEqual({
      facts: [{
        factType: 'date',
        value: '2026-09-25T10:00:00Z',
        state: 'OBSERVED',
        provenance: [{
          evidenceId: 'evidence-1',
          artifactId: 'artifact-1',
          artifactHash: 'artifact-hash-1',
          extractionMethod: 'DETERMINISTIC',
          extractorId: 'extract_dates',
          extractorVersion: '1.0.0',
        }],
      }],
    });
  });

  it('rechaza tools duplicados', () => {
    const registry = createExtractionToolRegistry([tool()]);
    expect(() => registry.register(tool())).toThrow('EXTRACTION_TOOL_DUPLICATE');
  });

  it('rechaza ejecutar un tool inexistente', async () => {
    const registry = createExtractionToolRegistry();
    await expect(registry.execute('missing', {}, {
      auditId: 'audit-1',
      mode: 'SHADOW',
      evidences: [],
      artifacts: [],
      allowedEvidenceIds: [],
    })).rejects.toThrow('EXTRACTION_TOOL_NOT_FOUND');
  });
});
