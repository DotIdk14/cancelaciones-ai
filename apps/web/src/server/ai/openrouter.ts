import { getAiEnv } from '@/server/config/env';

export interface LlmContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface StructuredOutput {
  content: string;
  provider: string;
  model: string;
}

/**
 * Solicitud de completion estructurada a OpenRouter (JSON o texto plano).
 * No guarda cadena de pensamiento: solo pide el JSON estructurado final.
 * Reutilizada por HUMAN_DECISION_EXTRACTION y AI_RECONCILIATION (una sola
 * implementacion de la capacidad LLM canalizada).
 */
export async function requestStructuredCompletion(input: {
  system?: string;
  user: string;
  parts?: LlmContentPart[];
  json?: boolean;
}): Promise<StructuredOutput> {
  const env = getAiEnv();
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'content-type': 'application/json',
      'http-referer': env.NEXT_PUBLIC_APP_URL,
      'x-title': 'Cancelaciones AI',
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL,
      temperature: 0,
      ...(input.json !== false ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        ...(input.system ? [{ role: 'system', content: input.system }] : []),
        { role: 'user', content: input.parts && input.parts.length ? input.parts : input.user },
      ],
    }),
  });
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`OPENROUTER_ERROR_${response.status}${details ? `: ${details.slice(0, 240)}` : ''}`);
  }
  const completion = (await response.json()) as { choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }> };
  const content = completion.choices?.[0]?.message?.content;
  const raw = Array.isArray(content) ? content.map((part) => part.text ?? '').join('') : content ?? '';
  if (!raw) throw new Error('OPENROUTER_EMPTY_RESPONSE');
  return { content: raw, provider: 'OpenRouter', model: env.OPENROUTER_MODEL };
}

export function parseJsonFromCompletion<T>(raw: string): T {
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(cleaned) as T;
}