/**
 * Adaptador HTTP de la frontera del motor de auditoría.
 *
 * Traduce `AuditEngineNotImplementedError` a una respuesta 501 explícita.
 * No ejecuta lógica de auditoría ni contiene vocabulario normativo.
 */
import { NextResponse } from 'next/server';

import {
  AUDIT_ENGINE_NOT_IMPLEMENTED,
  NORMATIVE_SOURCE_CODE,
  isAuditEngineNotImplemented,
  type AuditEngineCapability,
} from './boundary';

/** Respuesta 501 para cualquier ruta que requiera un resultado normativo. */
export function auditEngineNotImplemented(capability: AuditEngineCapability) {
  return NextResponse.json(
    {
      error: AUDIT_ENGINE_NOT_IMPLEMENTED,
      capability,
      normativeSource: NORMATIVE_SOURCE_CODE,
      message:
        'El motor de auditoría no está implementado. Ninguna auditoría normativa puede ejecutarse en esta fase.',
    },
    { status: 501 },
  );
}

/** Traduce el error de frontera a 501; re-lanza cualquier otro error. */
export function toAuditEngineErrorResponse(error: unknown) {
  if (isAuditEngineNotImplemented(error)) {
    return NextResponse.json(error.toDetails(), { status: error.status });
  }
  throw error;
}
