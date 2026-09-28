import { z } from 'zod';

const DEFAULT_MODEL = 'google/gemini-2.5-flash';

const insforgeEnvSchema = z.object({
  NEXT_PUBLIC_INSFORGE_URL: z.string().url('NEXT_PUBLIC_INSFORGE_URL debe ser una URL valida'),
  NEXT_PUBLIC_INSFORGE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_INSFORGE_ANON_KEY es obligatoria'),
  NEXT_PUBLIC_APP_URL: z.string().url('NEXT_PUBLIC_APP_URL debe ser una URL valida').default('http://localhost:3000'),
});

const aiEnvSchema = insforgeEnvSchema.extend({
  OPENROUTER_API_KEY: z.string().min(1, 'OPENROUTER_API_KEY es obligatoria'),
  OPENROUTER_FAST_MODEL: z.string().min(1, 'OPENROUTER_FAST_MODEL no puede estar vacia').default(DEFAULT_MODEL),
  OPENROUTER_ANALYST_MODEL: z.string().min(1, 'OPENROUTER_ANALYST_MODEL no puede estar vacia').default(DEFAULT_MODEL),
  OPENROUTER_REVIEWER_MODEL: z.string().min(1, 'OPENROUTER_REVIEWER_MODEL no puede estar vacia').default(DEFAULT_MODEL),
  OPENROUTER_VISION_MODEL: z.string().min(1, 'OPENROUTER_VISION_MODEL no puede estar vacia').default(DEFAULT_MODEL),
  ASSEMBLYAI_API_KEY: z.string().min(1, 'ASSEMBLYAI_API_KEY no puede estar vacia').optional(),
  ASSEMBLYAI_WEBHOOK_SECRET: z.string().min(1, 'ASSEMBLYAI_WEBHOOK_SECRET no puede estar vacia').optional(),
});

export type InsForgeEnv = z.output<typeof insforgeEnvSchema>;
export type AiEnv = z.output<typeof aiEnvSchema>;

function readRawEnv() {
  return {
    NEXT_PUBLIC_INSFORGE_URL: process.env.NEXT_PUBLIC_INSFORGE_URL,
    NEXT_PUBLIC_INSFORGE_ANON_KEY: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_FAST_MODEL: process.env.OPENROUTER_FAST_MODEL,
    OPENROUTER_ANALYST_MODEL: process.env.OPENROUTER_ANALYST_MODEL,
    OPENROUTER_REVIEWER_MODEL: process.env.OPENROUTER_REVIEWER_MODEL,
    OPENROUTER_VISION_MODEL: process.env.OPENROUTER_VISION_MODEL,
    ASSEMBLYAI_API_KEY: process.env.ASSEMBLYAI_API_KEY,
    ASSEMBLYAI_WEBHOOK_SECRET: process.env.ASSEMBLYAI_WEBHOOK_SECRET,
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
