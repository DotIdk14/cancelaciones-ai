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
    const rootFields = ['case', 'evidenceSummary', 'facts', 'timeline', 'conflicts', 'temporalAnalysis', 'audit'];
    for (const field of rootFields) {
      expect(properties).toHaveProperty(field);
      expect(required).toContain(field);
    }
    const caseSchema = properties.case as { properties: Record<string, { type?: unknown }>; required: string[] };
    expect(caseSchema.properties.matricula).toEqual({ type: ['string', 'null'] });
    // El contrato enviado a OpenRouter ya NO exige la fecha de inicio en `case`:
    // la deriva el servidor. Exigirla aquí era lo que obligaba al modelo a emitir
    // una segunda copia que solo podía compararse después de su respuesta.
    expect(caseSchema.properties).not.toHaveProperty('cycleStartDate');
    expect(caseSchema.required).not.toContain('cycleStartDate');
  });

  it('expone el análisis temporal con su vocabulario cerrado de relaciones', () => {
    const providerSchema = buildProviderJsonSchema(AiAuditAssessmentSchema, 'gemini');
    const temporal = (providerSchema.properties as Record<string, unknown>).temporalAnalysis as {
      properties: Record<string, { enum?: string[]; type?: unknown }>;
      required: string[];
    };

    // El provider debe recibir el bloque y TODAS sus claves como obligatorias:
    // es lo que obliga al modelo a emitirlo en cada auditoría.
    for (const field of [
      'cycleStartDate',
      'cycleStartEvidenceIds',
      'cycleStartEvidenceText',
      'cancellationRequestDate',
      'cancellationRequestEvidenceIds',
      'relationToCycleStart',
      'reasoning',
    ]) {
      expect(temporal.properties[field]).toBeDefined();
      expect(temporal.required).toContain(field);
    }

    // El enum viaja completo: sin él, el modelo podría inventar una relación.
    expect(temporal.properties.relationToCycleStart.enum).toEqual([
      'ANTES_DEL_INICIO',
      'MISMO_DIA_DEL_INICIO',
      'DESPUES_DEL_INICIO',
      'NO_DETERMINABLE',
    ]);
  });

  it('falla el contract check si se introduce una keyword incompatible', () => {
    expect(() => assertProviderSchemaCompatible({ type: 'string', minLength: 1 }, 'gemini'))
      .toThrow('minLength');
  });

  it('genera el contrato json_object del mismo schema de negocio', () => {
    const contract = buildJsonObjectContract(buildProviderJsonSchema(AiAuditAssessmentSchema, 'gemini'));
    for (const field of ['case', 'evidenceSummary', 'facts', 'timeline', 'conflicts', 'temporalAnalysis', 'audit']) {
      expect(contract).toContain(`"${field}"`);
    }
    expect(contract).toContain('exclusivamente un objeto JSON');
  });
});
