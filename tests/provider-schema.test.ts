import { describe, expect, it } from 'vitest';
import { AiAuditAssessmentSchema } from '../src/skills/audit/schema';
import { assertProviderSchemaCompatible, buildJsonObjectContract, buildProviderJsonSchema } from '../src/server/ai/provider-schema';

function collectKeys(value: unknown, output: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => collectKeys(item, output));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      output.push(key);
      collectKeys(item, output);
    }
  }
  return output;
}

describe('provider schema proyectado desde Zod', () => {
  it('el perfil Gemini omite keywords fuera de su subconjunto compatible', () => {
    const providerSchema = buildProviderJsonSchema(AiAuditAssessmentSchema, 'gemini');
    expect(() => assertProviderSchemaCompatible(providerSchema, 'gemini')).not.toThrow();
    expect(collectKeys(providerSchema)).not.toContain('minLength');
    expect(collectKeys(providerSchema)).not.toContain('maximum');
    expect(collectKeys(providerSchema)).toContain('additionalProperties');
    expect(collectKeys(providerSchema)).not.toContain('nullable');
    expect(providerSchema).not.toHaveProperty('$ref');
    expect(providerSchema).not.toHaveProperty('definitions');
  });

  it('conserva todos los campos raíz obligatorios del contrato Zod', () => {
    const providerSchema = buildProviderJsonSchema(AiAuditAssessmentSchema, 'gemini');
    const properties = providerSchema.properties as Record<string, unknown>;
    const required = providerSchema.required as string[];
    const rootFields = ['case', 'evidenceSummary', 'facts', 'timeline', 'conflicts', 'audit'];
    for (const field of rootFields) {
      expect(properties).toHaveProperty(field);
      expect(required).toContain(field);
    }
    const caseSchema = properties.case as { properties: Record<string, { type?: unknown }> };
    expect(caseSchema.properties.matricula).toEqual({ type: ['string', 'null'] });
  });

  it('falla el contract check si se introduce una keyword incompatible', () => {
    expect(() => assertProviderSchemaCompatible({ type: 'string', minLength: 1 }, 'gemini'))
      .toThrow('minLength');
  });

  it('genera el contrato json_object del mismo schema de negocio', () => {
    const contract = buildJsonObjectContract(buildProviderJsonSchema(AiAuditAssessmentSchema, 'gemini'));
    for (const field of ['case', 'evidenceSummary', 'facts', 'timeline', 'conflicts', 'audit']) {
      expect(contract).toContain(`"${field}"`);
    }
    expect(contract).toContain('exclusivamente un objeto JSON');
  });
});
