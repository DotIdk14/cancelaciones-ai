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
  unmetPreconditions,
  type AuditEngineCapability,
} from './boundary';

/**
 * Respuesta 501 para cualquier ruta que requiera un resultado normativo.
 *
 * Incluye las precondiciones pendientes para que quien reciba el error sepa qué
 * construir, no sólo que algo falta. Un 501 sin ese detalle obliga a investigar;
 * con él, es una lista de trabajo.
 */
export function auditEngineNotImplemented(capability: AuditEngineCapability) {
  const unmet = unmetPreconditions(capability);
  return NextResponse.json(
    {
      error: AUDIT_ENGINE_NOT_IMPLEMENTED,
      capability,
      normativeSource: NORMATIVE_SOURCE_CODE,
      message:
        'El motor de auditoría no puede ejecutar esta capacidad todavía. ' +
        'Ninguna auditoría normativa puede ejecutarse en esta fase.',
      unmetPreconditions: unmet,
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
