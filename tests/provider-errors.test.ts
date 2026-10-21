import { describe, expect, it } from 'vitest';
import { providerRejectionReason } from '../src/server/ai/provider-errors';

describe('diagnóstico seguro del error anidado del proveedor', () => {
  it('identifica el rechazo real de Google aunque OpenRouter sólo diga Provider returned error', () => {
    const reason = providerRejectionReason({ error: { message: 'Provider returned error', metadata: { raw: JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'The specified schema produces a constraint that has too many states for serving. private-student@example.invalid' } }) } } });
    expect(reason).toBe('provider schema complexity limit exceeded');
    expect(reason).not.toContain('private-student');
  });
  it.each([
    [{ error: { message: 'Unsupported minLength' } }, 'provider rejected schema/parameter: minLength'],
    [{ error: { metadata: { raw: { error: { message: 'Invalid image format' } } } } }, 'provider rejected an invalid or unsupported image'],
    [{ error: { metadata: { raw: 'Maximum context token limit exceeded' } } }, 'provider input or output token limit exceeded'],
    [{ error: { message: 'opaque error with private-token-123' } }, 'provider rejected request'],
    [null, 'provider rejected request'],
  ])('clasifica %j sin copiar texto libre', (input, reason) => {
    expect(providerRejectionReason(input)).toBe(reason);
  });
});
