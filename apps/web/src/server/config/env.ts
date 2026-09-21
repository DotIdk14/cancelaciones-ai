import { z } from 'zod';

const serverEnvSchema = z.object({
  NEXT_PUBLIC_INSFORGE_URL: z.string().url('NEXT_PUBLIC_INSFORGE_URL debe ser una URL valida'),
  NEXT_PUBLIC_INSFORGE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_INSFORGE_ANON_KEY es obligatoria'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function getServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse({
    NEXT_PUBLIC_INSFORGE_URL: process.env.NEXT_PUBLIC_INSFORGE_URL,
    NEXT_PUBLIC_INSFORGE_ANON_KEY: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join('; ');
    throw new Error(`Configuracion de entorno invalida: ${message}`);
  }

  return parsed.data;
}
