import { zodToJsonSchema } from 'zod-to-json-schema';

export type ProviderSchemaProfile = 'gemini' | 'openai';

const GEMINI_ALLOWED_KEYWORDS = new Set([
  'type', 'properties', 'required', 'items', 'enum', 'anyOf', 'oneOf', 'additionalProperties',
]);

function inlineRootReference(schema: Record<string, unknown>): Record<string, unknown> {
  const reference = schema.$ref;
  const definitions = schema.definitions;
  if (typeof reference !== 'string' || !reference.startsWith('#/definitions/') || !definitions || typeof definitions !== 'object') {
    return schema;
  }
  const name = reference.slice('#/definitions/'.length).replace(/~1/g, '/').replace(/~0/g, '~');
  const definition = (definitions as Record<string, unknown>)[name];
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return schema;
  return definition as Record<string, unknown>;
}

function project(node: unknown, profile: ProviderSchemaProfile): unknown {
  if (Array.isArray(node)) return node.map((item) => project(item, profile));
  if (!node || typeof node !== 'object') return node;

  const input = node as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === '$schema' || key === '$ref' || key === 'definitions') continue;
    if (profile === 'gemini' && !GEMINI_ALLOWED_KEYWORDS.has(key)) continue;
    if (profile === 'gemini' && key === 'anyOf' && Array.isArray(value)) {
      const alternatives = value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
      if (alternatives.length === value.length && alternatives.every((item) => typeof item.type === 'string' && Object.keys(item).length === 1)) {
        output.type = alternatives.map((item) => item.type);
        continue;
      }
    }
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      output.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([propertyName, propertySchema]) => [propertyName, project(propertySchema, profile)]),
      );
    } else {
      output[key] = project(value, profile);
    }
  }

  if (profile === 'openai' && output.type === 'object' && output.properties && typeof output.properties === 'object') {
    output.additionalProperties = false;
  }
  if (profile === 'gemini' && output.type === 'object' && output.properties && typeof output.properties === 'object') {
    output.additionalProperties = false;
  }
  return output;
}

export function buildProviderJsonSchema(zodSchema: unknown, profile: ProviderSchemaProfile): Record<string, unknown> {
  const generated = zodToJsonSchema(zodSchema as never, { $refStrategy: 'none' });
  const root = inlineRootReference(generated as unknown as Record<string, unknown>);
  const projected = project(root, profile);
  assertProviderSchemaCompatible(projected, profile);
  return projected as Record<string, unknown>;
}

export function assertProviderSchemaCompatible(schema: unknown, profile: ProviderSchemaProfile): void {
  const visit = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!node || typeof node !== 'object') return;

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const isPropertyName = path.endsWith('.properties');
      if (profile === 'gemini' && !isPropertyName && !GEMINI_ALLOWED_KEYWORDS.has(key)) {
        throw new Error(`Provider schema keyword not supported by ${profile}: ${path}.${key}`);
      }
      visit(value, `${path}.${key}`);
    }
  };
  visit(schema, '$');
}

export function buildJsonObjectContract(schema: Record<string, unknown>): string {
  return [
    'Devuelve exclusivamente un objeto JSON que cumpla esta estructura completa. Todas las propiedades listadas son obligatorias salvo que su tipo admita null. No agregues texto fuera del JSON.',
    JSON.stringify(schema),
  ].join('\n');
}
