import { z } from 'zod';

const insforgeEnvSchema = z.object({
  NEXT_PUBLIC_INSFORGE_URL: z.string().url('NEXT_PUBLIC_INSFORGE_URL debe ser una URL valida'),
  NEXT_PUBLIC_INSFORGE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_INSFORGE_ANON_KEY es obligatoria'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
});

const aiEnvSchema = insforgeEnvSchema.extend({
  OPENROUTER_API_KEY: z.string().min(1, 'OPENROUTER_API_KEY es obligatoria'),
  OPENROUTER_MODEL: z.string().default('google/gemini-2.5-flash'),
  ASSEMBLYAI_API_KEY: z.string().min(1).optional(),
});

export type InsForgeEnv = z.output<typeof insforgeEnvSchema>;
export type AiEnv = z.output<typeof aiEnvSchema>;

function readRawEnv() {
  return {
    NEXT_PUBLIC_INSFORGE_URL: process.env.NEXT_PUBLIC_INSFORGE_URL,
    NEXT_PUBLIC_INSFORGE_ANON_KEY: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
    ASSEMBLYAI_API_KEY: process.env.ASSEMBLYAI_API_KEY,
  };
}

function parseEnv<T extends z.ZodTypeAny>(schema: T): z.output<T> {
  const parsed = schema.safeParse(readRawEnv());

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join('; ');
    throw new Error(`Configuracion de entorno invalida: ${message}`);
  }

  return parsed.data;
}

export function getInsForgeEnv(): InsForgeEnv {
  return parseEnv(insforgeEnvSchema);
}

export function getAiEnv(): AiEnv {
  return parseEnv(aiEnvSchema);
}

export const getServerEnv = getAiEnv;
