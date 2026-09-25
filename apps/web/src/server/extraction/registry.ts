import type { JobArtifact } from '@cancelaciones/db';
import type { ExtractionToolOutputV1 } from '@cancelaciones/domain';
import type { ExtractionTool, ExtractionToolContext } from './contracts';
import { extractionToolOutputSchema } from './contracts';
import { validateExtractionArtifactInput, validateExtractionMode, validateExtractionToolOutputReferences } from './evidence-reference-validation';
import { z } from 'zod';
import { extractContactAttemptsTool } from './tools/extract-contact-attempts';
import { extractDatesTool } from './tools/extract-dates';

const forbiddenOutputFields = ['outcome', 'suggestedOutcome', 'decision', 'resolution', 'ruleId', 'matchedRule', 'policyDecision'] as const;

type SchemaDefinition = {
  typeName?: string;
  shape?: () => Record<string, z.ZodTypeAny>;
  unknownKeys?: string;
  catchall?: z.ZodTypeAny;
  options?: z.ZodTypeAny[];
  schema?: z.ZodTypeAny;
  innerType?: z.ZodTypeAny;
  in?: z.ZodTypeAny;
  out?: z.ZodTypeAny;
  type?: z.ZodTypeAny;
};

export interface ExtractionToolMetadata {
  id: string;
  version: string;
  inputSchemaVersion: string;
  outputSchemaVersion: string;
  deterministic: boolean;
}

export interface ExtractionToolRegistry {
  register<TInput>(tool: ExtractionTool<TInput>): void;
  get<TInput = unknown>(id: string): ExtractionTool<TInput>;
  list(): ExtractionToolMetadata[];
  execute<TInput = unknown>(id: string, input: TInput, context: ExtractionToolContext): Promise<ExtractionToolOutputV1>;
}

type AnyExtractionTool = Omit<ExtractionTool<unknown>, 'inputSchema' | 'outputSchema' | 'execute'> & {
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodType<ExtractionToolOutputV1>;
  execute: (input: never, context: ExtractionToolContext) => Promise<ExtractionToolOutputV1>;
};

type RegisteredExtractionTool = ExtractionToolMetadata & {
  tool: AnyExtractionTool;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodType<ExtractionToolOutputV1>;
  execute: (input: unknown, context: ExtractionToolContext) => Promise<ExtractionToolOutputV1>;
};

function registerableTool<TInput>(tool: ExtractionTool<TInput>): AnyExtractionTool {
  return tool as unknown as AnyExtractionTool;
}

function definitionOf(schema: z.ZodTypeAny): SchemaDefinition {
  return (schema as unknown as { _def?: SchemaDefinition })._def ?? {};
}

function schemaAllowsField(schema: z.ZodTypeAny, field: string): boolean {
  const sentinel = { facts: [], [field]: 'SENTINEL' };
  if (schema.safeParse(sentinel).success) return true;

  const definition = definitionOf(schema);
  const shape = definition.shape?.();
  if (shape && Object.prototype.hasOwnProperty.call(shape, field)) return true;
  if (definition.unknownKeys === 'passthrough') return true;
  if (definition.catchall && schemaAllowsField(definition.catchall, field)) return true;
  if (definition.options?.some((option) => schemaAllowsField(option, field))) return true;

  const nested = [definition.schema, definition.innerType, definition.out, definition.type];
  return nested.some((candidate) => candidate ? schemaAllowsField(candidate, field) : false);
}

function validateOutputSchema(schema: z.ZodType<ExtractionToolOutputV1>): void {
  if (forbiddenOutputFields.some((field) => schemaAllowsField(schema, field))) {
    throw new Error('EXTRACTION_OUTPUT_SCHEMA_INVALID');
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateToolMetadata(tool: AnyExtractionTool): void {
  if (
    !isNonEmptyString(tool.id)
    || !isNonEmptyString(tool.version)
    || !isNonEmptyString(tool.inputSchemaVersion)
    || !isNonEmptyString(tool.outputSchemaVersion)
    || typeof tool.deterministic !== 'boolean'
    || !(tool.inputSchema instanceof z.ZodType)
    || !(tool.outputSchema instanceof z.ZodType)
  ) {
    throw new Error('EXTRACTION_TOOL_METADATA_INVALID');
  }
}

function registeredTool<TInput>(tool: ExtractionTool<TInput>): RegisteredExtractionTool {
  const normalized = registerableTool(tool);
  validateToolMetadata(normalized);
  validateOutputSchema(normalized.outputSchema);
  const metadata: ExtractionToolMetadata = Object.freeze({
    id: normalized.id,
    version: normalized.version,
    inputSchemaVersion: normalized.inputSchemaVersion,
    outputSchemaVersion: normalized.outputSchemaVersion,
    deterministic: normalized.deterministic,
  });
  const frozenTool = Object.freeze({ ...normalized });
  return Object.freeze({
    ...metadata,
    tool: frozenTool,
    inputSchema: normalized.inputSchema,
    outputSchema: normalized.outputSchema,
    execute: normalized.execute as (input: unknown, context: ExtractionToolContext) => Promise<ExtractionToolOutputV1>,
  });
}

export function createExtractionToolRegistry(tools: readonly AnyExtractionTool[] = []): ExtractionToolRegistry {
  const registered = new Map<string, RegisteredExtractionTool>();

  const register = <TInput>(tool: ExtractionTool<TInput>): void => {
    const normalized = registeredTool(tool);
    if (registered.has(normalized.id)) throw new Error('EXTRACTION_TOOL_DUPLICATE');
    registered.set(normalized.id, normalized);
  };

  for (const tool of tools) register(registerableTool(tool));

  return {
    register,
    get<TInput>(id: string): ExtractionTool<TInput> {
      const entry = registered.get(id);
      if (!entry) throw new Error('EXTRACTION_TOOL_NOT_FOUND');
      return Object.freeze({ ...entry.tool }) as unknown as ExtractionTool<TInput>;
    },
    list(): ExtractionToolMetadata[] {
      return [...registered.values()].map(({ id, version, inputSchemaVersion, outputSchemaVersion, deterministic }) => Object.freeze({
        id,
        version,
        inputSchemaVersion,
        outputSchemaVersion,
        deterministic,
      }));
    },
    async execute<TInput>(id: string, input: TInput, context: ExtractionToolContext): Promise<ExtractionToolOutputV1> {
      const entry = registered.get(id);
      if (!entry) throw new Error('EXTRACTION_TOOL_NOT_FOUND');
      validateExtractionMode(context.mode);
      if (typeof input === 'object' && input !== null && 'artifact' in input) {
        validateExtractionArtifactInput((input as { artifact: JobArtifact }).artifact, context);
      }
      const parsedInput = entry.inputSchema.safeParse(input);
      if (!parsedInput.success) throw new Error('EXTRACTION_INPUT_INVALID');
      const output = await entry.execute(parsedInput.data, context);
      const parsedOutput = entry.outputSchema.safeParse(output);
      if (!parsedOutput.success) throw new Error('EXTRACTION_OUTPUT_INVALID');
      const canonicalOutput = extractionToolOutputSchema.safeParse(parsedOutput.data);
      if (!canonicalOutput.success) throw new Error('EXTRACTION_OUTPUT_INVALID');
      validateExtractionToolOutputReferences(canonicalOutput.data, context);
      return canonicalOutput.data;
    },
  };
}

export function createDefaultExtractionToolRegistry(): ExtractionToolRegistry {
  return createExtractionToolRegistry([extractDatesTool, extractContactAttemptsTool]);
}
