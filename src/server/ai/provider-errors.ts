function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Lee el error anidado de OpenRouter sólo para clasificarlo; nunca lo publica. */
export function providerRejectionReason(payload: unknown): string {
  const error = record(record(payload)?.error);
  const raw = record(error?.metadata)?.raw;
  let nested: unknown = raw;
  if (typeof raw === 'string') {
    try { nested = JSON.parse(raw.slice(0, 65_536)); } catch { nested = { message: raw.slice(0, 4096) }; }
  }
  const nestedError = record(record(nested)?.error) ?? record(nested);
  const messages = [error?.message, nestedError?.message]
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.slice(0, 4096)).join(' ');
  if (/schema|constraint/i.test(messages) && /too many states|too complex|complexity|too many nesting/i.test(messages)) {
    return 'provider schema complexity limit exceeded';
  }
  if (/image/i.test(messages) && /invalid|corrupt|decode|unsupported/i.test(messages)) {
    return 'provider rejected an invalid or unsupported image';
  }
  if (/context|token/i.test(messages) && /exceed|too long|too many|limit/i.test(messages)) {
    return 'provider input or output token limit exceeded';
  }
  const keywords = ['minLength', 'maxLength', 'minimum', 'maximum', 'additionalProperties', 'anyOf', 'minItems', 'enum', 'max_tokens', 'response_format'];
  const keyword = keywords.find(candidate => messages.toLowerCase().includes(candidate.toLowerCase()));
  if (keyword) return `provider rejected schema/parameter: ${keyword}`;
  if (/unsupported|not supported/i.test(messages)) return 'provider rejected an unsupported parameter';
  return 'provider rejected request';
}
