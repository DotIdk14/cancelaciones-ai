import { expect, it } from 'vitest';
import { mapProviderError } from '../src/server/errors';

it('no expone HTML del gateway como mensaje de error del servicio de datos', () => {
  const error = mapProviderError({ message: '<html><head><title>502 Bad Gateway</title></head><body>openresty/1.31.1.1</body></html>' });
  expect(error.status).toBe(503);
  expect(error.message).toBe('No se pudo consultar el servicio de datos. Reintenta en unos momentos.');
  expect(error.category).toBe('DATABASE_ERROR');
});
