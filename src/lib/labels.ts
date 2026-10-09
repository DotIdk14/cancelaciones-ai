// =============================================================================
// Etiquetas en español. Solo traducción de vocabulario: no decide nada.
// Las enumeraciones vienen de `src/skills/audit/types.ts`.
// =============================================================================

import type {
  AuditResultType,
  CaseStatus,
  EvidenceChannel,
  EvidenceCountry,
  EvidenceKind,
  EvidenceStatus,
} from '../skills/audit/types';
// El vocabulario de áreas vive en el cliente (`api.ts`) y no en `src/server`,
// que arrastraría el cliente de InsForge al bundle del navegador.
import type { AreaCommentArea } from './api';
import type { CoordinatorDecision, WorkflowState } from './api';
// Valores, no sólo tipos: el vocabulario cerrado y los límites de la revisión
// humana se IMPORTAN del módulo que los define, no se reescriben aquí.
import {
  HUMAN_RESOLUTIONS,
  REVIEW_COMMENT_MAX,
  REVIEW_COMMENT_MIN,
} from '../skills/review/types.js';
import { EVIDENCE_MIME_ALLOWLIST } from '../shared/evidence-formats.js';
import type { Tone } from '../components/ui';

// -----------------------------------------------------------------------------
// Resultado de la auditoría
// -----------------------------------------------------------------------------

export const RESULT_LABELS: Record<AuditResultType, string> = {
  CANCELACION_VENTA: 'Cancelación de venta',
  CANCELACION_VENTA_PETICION_CLIENTE: 'Cancelación por promesa no cumplida',
  BAJA: 'Baja',
  CANCELACION_VENTA_OPERATIVA: 'Cancelación de venta operativa',
  CANCELACION_MATRICULA: 'Cancelación de matrícula',
  DICTAMINACION: 'Dictaminación',
  TICKET_RECHAZADO: 'Ticket rechazado',
  EVIDENCIA_INSUFICIENTE: 'Evidencia insuficiente',
};

export const RESULT_DESCRIPTIONS: Record<AuditResultType, string> = {
  CANCELACION_VENTA: 'La evidencia sostiene una cancelación de venta.',
  CANCELACION_VENTA_PETICION_CLIENTE:
    'La evidencia acredita que el cliente solicitó cancelar la venta conforme al procedimiento.',
  BAJA: 'La evidencia sostiene una baja del estudiante.',
  CANCELACION_VENTA_OPERATIVA:
    'La evidencia sostiene una cancelación de venta resuelta operativamente.',
  CANCELACION_MATRICULA: 'La evidencia sostiene una cancelación de matrícula.',
  DICTAMINACION: 'La evidencia requiere un dictamen formal.',
  TICKET_RECHAZADO:
    'La sección 5.2 no acredita los intentos mínimos de contacto; el trámite se rechaza con su razón.',
  EVIDENCIA_INSUFICIENTE:
    'No fue posible emitir un dictamen confiable con la evidencia disponible.',
};

/** Tono del badge para cada resultado. Solo presentación: no altera el dictamen. */
export const RESULT_TONE: Record<AuditResultType, Tone> = {
  CANCELACION_VENTA: 'brand',
  CANCELACION_VENTA_PETICION_CLIENTE: 'brand',
  BAJA: 'warning',
  CANCELACION_VENTA_OPERATIVA: 'brand',
  CANCELACION_MATRICULA: 'brand',
  DICTAMINACION: 'success',
  TICKET_RECHAZADO: 'danger',
  EVIDENCIA_INSUFICIENTE: 'warning',
};

// -----------------------------------------------------------------------------
// Agrupación de resultados: lectura agregada, no un cambio de dictamen
// -----------------------------------------------------------------------------

/** Grupos de resolución: clasificación de lectura, no una decisión del backend. */
export const RESOLUTION_GROUPS = [
  'CONCEDIDAS',
  'REQUIERE_DICTAMINACION',
  'RECHAZADOS',
  'EVIDENCIA_INSUFICIENTE',
] as const;

export type ResolutionGroup = (typeof RESOLUTION_GROUPS)[number];

export const RESOLUTION_GROUP_LABELS: Record<ResolutionGroup, string> = {
  CONCEDIDAS: 'Concedidas',
  REQUIERE_DICTAMINACION: 'Requiere dictaminación',
  RECHAZADOS: 'Rechazados',
  EVIDENCIA_INSUFICIENTE: 'Evidencia insuficiente',
};

export const RESULT_TO_GROUP: Record<AuditResultType, ResolutionGroup> = {
  CANCELACION_VENTA: 'CONCEDIDAS',
  CANCELACION_VENTA_PETICION_CLIENTE: 'CONCEDIDAS',
  CANCELACION_VENTA_OPERATIVA: 'CONCEDIDAS',
  CANCELACION_MATRICULA: 'CONCEDIDAS',
  BAJA: 'CONCEDIDAS',
  DICTAMINACION: 'REQUIERE_DICTAMINACION',
  TICKET_RECHAZADO: 'RECHAZADOS',
  EVIDENCIA_INSUFICIENTE: 'EVIDENCIA_INSUFICIENTE',
};

/**
 * Color de series en gráficas. Es semántico y NO es el mismo mapa que
 * `RESULT_TONE` (ese da el tono del badge). Usa solo variables CSS ya
 * existentes para que las series respeten el tema, sin colores sueltos.
 */
export const RESOLUTION_GROUP_CHART_COLOR: Record<ResolutionGroup, string> = {
  CONCEDIDAS: 'var(--success)',
  REQUIERE_DICTAMINACION: 'var(--warning)',
  RECHAZADOS: 'var(--danger)',
  EVIDENCIA_INSUFICIENTE: 'var(--accent)',
};

/**
 * Color de serie de las distribuciones de origen.
 *
 * Cada dimensión tiene su color y NO se reutilizan los del grupo de resolución:
 * el país y el canal son otra cosa, y compartir color sugeriría una equivalencia
 * que no existe. Los dos tokens están contrastados contra `--surface-1` en
 * `scripts/contrast.mjs`.
 */
export const ORIGIN_CHART_COLOR: Record<'country' | 'channel', string> = {
  country: 'var(--chart-origin-country)',
  channel: 'var(--chart-origin-channel)',
};

// -----------------------------------------------------------------------------
// Bandas de confianza
// -----------------------------------------------------------------------------

/**
 * Bandas de confianza: son de PRESENTACIÓN sobre `audit.confidence` (0..1).
 * No reclasifican el dictamen, no alteran el resultado terminal y no se envían
 * al backend; solo eligen la etiqueta que ve la persona. Los umbrales viven
 * aquí como constantes para no dispersarlos por los componentes.
 */
export const CONFIDENCE_HIGH_THRESHOLD = 0.85;
export const CONFIDENCE_MEDIUM_THRESHOLD = 0.6;

export type ConfidenceBand = 'ALTA' | 'MEDIA' | 'BAJA';

export const CONFIDENCE_BAND_LABELS: Record<ConfidenceBand, string> = {
  ALTA: 'Alta confianza',
  MEDIA: 'Media confianza',
  BAJA: 'Baja confianza',
};

// -----------------------------------------------------------------------------
// Revisión humana: vocabulario, origen de la resolución y estados técnicos
// -----------------------------------------------------------------------------

/**
 * Opciones del selector de resolución final.
 *
 * NO es una lista escrita aquí: es el vocabulario cerrado que publica el módulo
 * de revisión (`HUMAN_RESOLUTIONS`, acotado a 6: la persona no resuelve
 * matrícula ni dictaminación). Duplicarlo permitiría que la UI ofreciera una
 * resolución que el servidor rechaza, que es la forma más silenciosa de romper
 * un contrato cerrado. El frontend ELIGE entre opciones; no decide
 * (NO_RULES_ENGINE).
 */
export const REVIEW_RESULT_OPTIONS: readonly AuditResultType[] = HUMAN_RESOLUTIONS;

/** Límites del comentario humano, tomados del validador del servidor. */
export const REVIEW_COMMENT_LIMITS = {
  min: REVIEW_COMMENT_MIN,
  max: REVIEW_COMMENT_MAX,
} as const;

/** Longitud válida del comentario ya recortado: la misma que valida el servidor. */
export function isValidReviewComment(trimmedLength: number): boolean {
  return trimmedLength >= REVIEW_COMMENT_MIN && trimmedLength <= REVIEW_COMMENT_MAX;
}

/**
 * Origen de la resolución que gobierna el caso.
 *
 * El distintivo se muestra en español (`Humano` / `IA`) manteniendo el token
 * interno (`HUMAN` / `AI`) sin traducir en el cable. Una resolución sin origen
 * no es auditable; la descripción lleva la aclaración para quien lee con
 * pantalla.
 */
export const RESOLUTION_SOURCE_LABELS: Record<'HUMAN' | 'AI', string> = {
  HUMAN: 'Humano',
  AI: 'IA',
};

export const RESOLUTION_SOURCE_DESCRIPTIONS: Record<'HUMAN' | 'AI', string> = {
  HUMAN: 'Resolución registrada por una persona. Es la resolución final del caso.',
  AI: 'Dictamen emitido por la IA. El caso no tiene revisión humana registrada.',
};

export const RESOLUTION_SOURCE_TONE: Record<'HUMAN' | 'AI', Tone> = {
  HUMAN: 'brand',
  AI: 'neutral',
};

/** Estados técnicos de la comparación (mismo vocabulario que `audits.status`). */
export const COMPARISON_STATUS_LABELS: Record<'RUNNING' | 'COMPLETED' | 'ERROR', string> = {
  RUNNING: 'Comparando',
  COMPLETED: 'Comparación terminada',
  ERROR: 'Comparación con error',
};

// -----------------------------------------------------------------------------
// Flujo humano de dos etapas y clasificación del caso
// -----------------------------------------------------------------------------

/** Rótulo del estado derivado del flujo de revisión (nunca `cases.status`). */
export const WORKFLOW_STATE_LABELS: Record<WorkflowState, string> = {
  PENDING_ADVISOR: 'Pendiente de Asesor',
  PENDING_COORDINATOR: 'Pendiente de Coordinador',
  FINALIZED: 'Finalizado',
};

export const WORKFLOW_STATE_TONE: Record<WorkflowState, Tone> = {
  PENDING_ADVISOR: 'warning',
  PENDING_COORDINATOR: 'brand',
  FINALIZED: 'success',
};

/** Rótulo de la decisión final del Coordinador. */
export const COORDINATOR_DECISION_LABELS: Record<CoordinatorDecision, string> = {
  APPROVE: 'Aprobada',
  CHANGE: 'Modificada',
};

/**
 * Clasificación explícita del caso: prueba o real. Es la etiqueta persistente que
 * distingue ambos tipos en lista y detalle; el backend además excluye las
 * pruebas de las métricas operativas (PROJECTION_IS_NOT_THE_DICTAMEN).
 */
export const CASE_KIND_LABELS = {
  test: 'Prueba',
  real: 'Real',
} as const;

/** Rótulo de la clasificación a partir del flag `isTest`. */
export function caseKindLabel(isTest: boolean | null | undefined): string {
  return isTest === true ? CASE_KIND_LABELS.test : CASE_KIND_LABELS.real;
}

/** Tono del badge de clasificación: prueba resaltada, real discreta. */
export function caseKindTone(isTest: boolean | null | undefined): Tone {
  return isTest === true ? 'warning' : 'neutral';
}

/**
 * Etiqueta de un resultado recibido por el cable.
 *
 * Indexa por `string` a propósito: `effectiveResolution.result` llega como texto
 * y una versión futura del servidor puede traer un valor que este bundle no
 * conhece. Ante eso se devuelve el texto crudo en vez de `undefined`: mostrar el
 * código desconocido es señal de desajuste; inventar una etiqueta sería peor.
 */
export function resolutionLabel(result: string | null | undefined): string {
  if (typeof result !== 'string' || result === '') return 'Resolución no informada';
  return RESULT_LABELS[result as AuditResultType] ?? result;
}

/** Tono del badge de un resultado recibido por el cable. */
export function resolutionTone(result: string | null | undefined): Tone {
  if (typeof result !== 'string' || result === '') return 'neutral';
  return RESULT_TONE[result as AuditResultType] ?? 'neutral';
}

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

/**
 * Tono del badge según el estado técnico del caso.
 *
 * Vive AQUÍ, y no duplicado en cada componente, por una razón concreta: la
 * copia de `CasesPanel` nació al extraer este mapa de `CaseListPage` y arrastró
 * la constante. Dos copias byte a byte divergen en silencio el día que alguien
 * cambie un tono en una de las dos, y ese fallo no lo detecta ni `tsc` ni la
 * suite: se ve en pantalla, semanas después, como un badge de otro color.
 */
export const CASE_STATUS_TONE: Record<CaseStatus, Tone> = {
  DRAFT: 'neutral',
  READY: 'brand',
  AUDITING: 'warning',
  COMPLETED: 'success',
  ERROR: 'danger',
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

/**
 * Lista de formatos que el picker de archivos ofrece al SO/browser.
 *
 * Debe mantenerse sincronizada con `EVIDENCE_MIME_ALLOWLIST` en
 * `src/shared/evidence-formats.ts`. No incluir wildcards como `image/*` ni
 * `audio/*`: permitirían seleccionar formatos que el servidor rechaza con 415
 * (p. ej. BMP, TIFF, FLAC, SVG), generando un mismatch entre UX y validación.
 */
export const EVIDENCE_ACCEPT =
  '.png,.jpg,.jpeg,.webp,.gif,.pdf,.mp3,.wav,.m4a,.ogg,.webm,.txt,' +
  'image/png,image/jpeg,image/webp,image/gif,' +
  'application/pdf,' +
  'audio/mpeg,audio/mp3,audio/wav,audio/mp4,audio/x-m4a,audio/m4a,audio/webm,audio/ogg,' +
  'text/plain';

/**
 * MIMEs que el servidor considera evidencia válida.
 *
 * Es la contraparte normalizada de `EVIDENCE_ACCEPT`; la usa el cliente para
 * rechazar localmente archivos que de todos modos fallarían en el endpoint,
 * dando feedback inmediato sin gastar request.
 *
 * La fuente de verdad vive en `src/shared/evidence-formats.ts` para evitar
 * drift entre cliente y servidor.
 */
const EVIDENCE_ACCEPT_MIMES = EVIDENCE_MIME_ALLOWLIST;

/** Mensaje mostrado cuando el usuario selecciona un formato no soportado. */
export const EVIDENCE_TYPE_REJECTED_MESSAGE =
  'Formato no soportado. Usa PNG, JPG, WEBP, GIF, PDF, MP3, WAV, M4A, OGG o TXT.';

/** Indica si un MIME reportado por el browser está en la allowlist del servidor. */
export function isAcceptedEvidenceMime(mimeType: string | null | undefined): boolean {
  if (typeof mimeType !== 'string' || mimeType === '') return false;
  return EVIDENCE_ACCEPT_MIMES.has(mimeType.toLowerCase().split(';')[0]?.trim() ?? '');
}

/** Etiqueta para un dato de origen que el modelo no pudo determinar. */
export const UNDETERMINED_LABEL = 'Sin determinar';

export const COUNTRY_LABELS: Record<EvidenceCountry, string> = {
  MX: 'México',
  CO: 'Colombia',
  AR: 'Argentina',
  CL: 'Chile',
  PE: 'Perú',
  BR: 'Brasil',
  EC: 'Ecuador',
  PA: 'Panamá',
  PR: 'Puerto Rico',
  DO: 'República Dominicana',
  GT: 'Guatemala',
};

export const CHANNEL_LABELS: Record<EvidenceChannel, string> = {
  WHATSAPP: 'WhatsApp',
  CRM: 'CRM',
  I6: 'I6',
  SIU: 'SIU',
  FLOKZU: 'Flokzu',
  EMAIL: 'Correo electrónico',
  CALL: 'Llamada',
};

/**
 * Etiqueta legible del país o del canal de origen de un caso.
 *
 * Un valor fuera de catálogo cae al valor crudo en vez de a "Sin determinar":
 * si la base guardara un código de un catálogo anterior, mostrarlo tal cual es un
 * hecho, mientras que "Sin determinar" sería un dato falso.
 */
export function originLabel(kind: 'country' | 'channel', value: string | null | undefined): string {
  if (value == null || value === '') return UNDETERMINED_LABEL;
  const labels: Record<string, string> = kind === 'country' ? COUNTRY_LABELS : CHANNEL_LABELS;
  return labels[value] ?? value;
}

/**
 * Nombre de cada área que puede comentar un caso.
 *
 * "Back Office" y "HelpDesk" son los nombres tal como aparecen en el
 * procedimiento V5 (secciones 5.6, 5.7, 5.9 y el organigrama de la 11): usar las
 * siglas internas del sistema como etiqueta haría que el operador no reconociera
 * a quién pertenece lo que está leyendo.
 */
export const AREA_COMMENT_LABELS: Record<AreaCommentArea, string> = {
  BACK_OFFICE: 'Back Office',
  HELPDESK: 'HelpDesk',
  SCHOOL_SERVICES: 'Servicios Escolares',
  FINANCE: 'Finanzas',
  ADDITIONAL: 'Adicional',
};

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
