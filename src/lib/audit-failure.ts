interface FailureAttempt {
  failureCategory: string | null;
  path?: string | null;
  detail?: string | null;
  failureReason?: string | null;
}

/** Explica el último fallo real, no el primer formato rechazado por el proveedor. */
export function auditFailureMessage(category: string, attempts: FailureAttempt[], fallback: string): string {
  const last = attempts.filter(attempt => attempt.failureCategory != null).at(-1);
  const failure = last && (last.failureCategory === category || category === 'INVALID_AI_RESPONSE')
    ? last.failureCategory : category;
  const retry = 'Puedes reintentar la auditoría. Si vuelve a fallar, usa «Reportar problema» e incluye la referencia.';
  if (failure === 'SCHEMA_VALIDATION_ERROR' || failure === 'INVALID_AI_RESPONSE') {
    if (last?.path === 'audit.result' && /5[._]2/.test(last.detail ?? last.failureReason ?? '')) {
      return `La IA emitió una resolución que contradice su propia evaluación de los intentos mínimos de contacto de la sección 5.2. No se guardó un dictamen de este intento. ${retry}`;
    }
    if (last?.path === 'audit.observations') {
      return `La IA devolvió las observaciones en un formato incorrecto. No se guardó un dictamen de este intento. ${retry}`;
    }
    return `La respuesta de la IA no pasó la revisión de formato o coherencia. No se guardó un dictamen de este intento. ${retry}`;
  }
  if (failure === 'INVALID_EVIDENCE_REFERENCE') {
    return `La IA citó una evidencia que no corresponde al expediente. Los archivos originales siguen disponibles. ${retry}`;
  }
  if (failure === 'PROVIDER_BAD_REQUEST' || failure === 'UNSUPPORTED_MODEL_CAPABILITY') {
    return 'El proveedor de IA rechazó la configuración de la solicitud. Usa «Reportar problema» con la referencia para que el equipo técnico la revise.';
  }
  if (failure === 'TIMEOUT' || failure === 'PROVIDER_UNAVAILABLE' || failure === 'AI_PROVIDER_ERROR') {
    return `El servicio de IA no completó la solicitud a tiempo. ${retry}`;
  }
  return fallback;
}
