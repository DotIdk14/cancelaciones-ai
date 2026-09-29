// =============================================================================
// Etiquetas en español. Solo traducción de vocabulario: no decide nada.
// Las enumeraciones vienen de `src/skills/audit/types.ts`.
// =============================================================================

import type {
  AuditResultType,
  CaseStatus,
  EvidenceKind,
  EvidenceStatus,
} from '../skills/audit/types';

// -----------------------------------------------------------------------------
// Resultado de la auditoría
// -----------------------------------------------------------------------------

export const RESULT_LABELS: Record<AuditResultType, string> = {
  CANCELACION_VENTA: 'Cancelación de venta',
  BAJA: 'Baja',
  CANCELACION_VENTA_OPERATIVA: 'Cancelación de venta operativa',
  CANCELACION_MATRICULA: 'Cancelación de matrícula',
  DICTAMINACION: 'Dictaminación',
  EVIDENCIA_INSUFICIENTE: 'Evidencia insuficiente',
};

export const RESULT_DESCRIPTIONS: Record<AuditResultType, string> = {
  CANCELACION_VENTA: 'La evidencia sostiene una cancelación de venta.',
  BAJA: 'La evidencia sostiene una baja del estudiante.',
  CANCELACION_VENTA_OPERATIVA:
    'La evidencia sostiene una cancelación de venta resuelta operativamente.',
  CANCELACION_MATRICULA: 'La evidencia sostiene una cancelación de matrícula.',
  DICTAMINACION: 'La evidencia requiere un dictamen formal.',
  EVIDENCIA_INSUFICIENTE:
    'No fue posible emitir un dictamen confiable con la evidencia disponible.',
};

// -----------------------------------------------------------------------------
// Estados de caso
// -----------------------------------------------------------------------------

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  DRAFT: 'Borrador',
  READY: 'Listo para auditar',
  AUDITING: 'Auditando',
  COMPLETED: 'Completado',
  ERROR: 'Error',
};

export const AUDIT_RUN_STATUS_LABELS: Record<'RUNNING' | 'COMPLETED' | 'ERROR', string> = {
  RUNNING: 'En curso',
  COMPLETED: 'Completada',
  ERROR: 'Con error',
};

// -----------------------------------------------------------------------------
// Estados y tipos de evidencia
// -----------------------------------------------------------------------------

export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
  UPLOADED: 'Subida',
  TRANSCRIBING: 'Transcribiendo…',
  READY: 'Lista',
  ERROR: 'Error',
};

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  IMAGE: 'Imagen',
  PDF: 'PDF',
  AUDIO: 'Audio',
  TEXT: 'Texto',
};

export const EVIDENCE_ACCEPT =
  '.png,.jpg,.jpeg,.webp,.pdf,.mp3,.wav,.m4a,.ogg,audio/*,image/*,application/pdf';

// -----------------------------------------------------------------------------
// Errores: mensaje legible a partir de la categoría que devuelve el servidor.
// `AuditDetail` solo trae `errorCategory`; el texto lo compone la UI.
// -----------------------------------------------------------------------------

/** Indexado por `string` a propósito: la categoría puede venir de otra versión. */
export const ERROR_CATEGORY_MESSAGES: Record<string, string> = {
  UPLOAD_ERROR: 'No se pudo subir la evidencia. Verifica el archivo e intenta de nuevo.',
  TRANSCRIPTION_ERROR: 'La transcripción del audio falló. Revisa el audio e inténtalo otra vez.',
  AI_PROVIDER_ERROR: 'El proveedor de IA no respondió correctamente. Intenta auditar otra vez.',
  INVALID_AI_RESPONSE:
    'La respuesta del modelo no cumple el formato esperado, por lo que no se emitió dictamen.',
  TRUNCATED_OUTPUT: 'La respuesta del modelo se truncó. Reduce el tamaño del expediente o vuelve a intentarlo.',
  SCHEMA_VALIDATION_ERROR: 'El modelo respondió, pero el resultado no cumplió el contrato de auditoría.',
  INVALID_EVIDENCE_REFERENCE: 'El modelo devolvió referencias de evidencia inexistentes; no se emitió dictamen.',
  RATE_LIMIT: 'El proveedor limitó temporalmente las solicitudes. Intenta de nuevo más tarde.',
  PAYMENT_REQUIRED: 'El proveedor requiere saldo disponible para procesar la auditoría.',
  PROVIDER_UNAVAILABLE: 'El proveedor de IA no está disponible temporalmente.',
  UNSUPPORTED_MODEL_CAPABILITY: 'El modelo configurado no admite las capacidades requeridas por la auditoría.',
  CAPABILITY_CATALOG_UNAVAILABLE: 'No se pudieron verificar temporalmente las capacidades del modelo.',
  STORAGE_ERROR: 'Hubo un problema al guardar el archivo en el almacenamiento.',
  DATABASE_ERROR: 'Hubo un problema al guardar los datos del caso. Intenta de nuevo.',
  AUTH_ERROR: 'Tu sesión expiró. Inicia sesión nuevamente.',
  NOT_FOUND: 'No se encontró el recurso solicitado.',
  VALIDATION_ERROR: 'Los datos enviados no son válidos.',
  UNKNOWN: 'Ocurrió un error inesperado. Intenta de nuevo.',
};

export const ERROR_CATEGORY_LABELS: Record<string, string> = {
  UPLOAD_ERROR: 'Error de subida',
  TRANSCRIPTION_ERROR: 'Error de transcripción',
  AI_PROVIDER_ERROR: 'Error del proveedor de IA',
  INVALID_AI_RESPONSE: 'Respuesta inválida del modelo',
  TRUNCATED_OUTPUT: 'Respuesta truncada',
  SCHEMA_VALIDATION_ERROR: 'Validación del resultado',
  INVALID_EVIDENCE_REFERENCE: 'Referencia de evidencia inválida',
  RATE_LIMIT: 'Límite temporal del proveedor',
  PAYMENT_REQUIRED: 'Saldo del proveedor requerido',
  PROVIDER_UNAVAILABLE: 'Proveedor no disponible',
  UNSUPPORTED_MODEL_CAPABILITY: 'Capability del modelo incompatible',
  CAPABILITY_CATALOG_UNAVAILABLE: 'Catálogo de modelos no disponible',
  STORAGE_ERROR: 'Error de almacenamiento',
  DATABASE_ERROR: 'Error de base de datos',
  AUTH_ERROR: 'Error de autenticación',
  NOT_FOUND: 'No encontrado',
  VALIDATION_ERROR: 'Error de validación',
  UNKNOWN: 'Error desconocido',
};

/** Categoría legible para mostrar junto al mensaje. */
export function errorCategoryLabel(category: string | null | undefined): string {
  if (typeof category !== 'string' || category === '') return 'ERROR';
  return ERROR_CATEGORY_LABELS[category] ?? category;
}

/** Mensaje legible para una categoría de error. */
export function errorCategoryMessage(category: string | null | undefined): string {
  if (typeof category !== 'string' || category === '') {
    return ERROR_CATEGORY_MESSAGES['UNKNOWN'] ?? 'Ocurrió un error inesperado.';
  }
  return ERROR_CATEGORY_MESSAGES[category] ?? ERROR_CATEGORY_MESSAGES['UNKNOWN'] ?? 'Error.';
}

// -----------------------------------------------------------------------------
// Clasificación por MIME
// -----------------------------------------------------------------------------

/** Deduce el tipo de evidencia a partir del `mimeType` reportado por el servidor. */
export function kindFromMime(mimeType: string | null | undefined): EvidenceKind {
  const mime = typeof mimeType === 'string' ? mimeType.toLowerCase() : '';
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('audio/')) return 'AUDIO';
  if (mime === 'application/pdf' || mime.includes('pdf')) return 'PDF';
  if (mime.startsWith('text/')) return 'TEXT';
  return 'TEXT';
}

export function isImageMime(mimeType: string | null | undefined): boolean {
  return kindFromMime(mimeType) === 'IMAGE';
}

export function isAudioMime(mimeType: string | null | undefined): boolean {
  return kindFromMime(mimeType) === 'AUDIO';
}

export function isPdfMime(mimeType: string | null | undefined): boolean {
  return kindFromMime(mimeType) === 'PDF';
}

/** Texto alternativo robusto para evidencias sin nombre interpretable. */
export function evidenceAltText(filename: string, mimeType: string | null | undefined): string {
  const kind = EVIDENCE_KIND_LABELS[kindFromMime(mimeType)].toLowerCase();
  return `${kind}: ${filename}`;
}
