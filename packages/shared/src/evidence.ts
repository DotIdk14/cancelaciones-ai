import { createHash } from 'node:crypto';

/** Tope de tamaño por archivo: por encima el proveedores de transcripción y visión fallan o cuestan de más. */
export const MAX_EVIDENCE_FILE_BYTES = 50 * 1024 * 1024;
export const EVIDENCE_BUCKET = 'dictamen-evidencias';

export const EVIDENCE_KINDS = ['PDF', 'IMAGE', 'AUDIO', 'TEXT', 'SPREADSHEET', 'DOCUMENT'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_STATUSES = ['PENDING', 'STORED', 'FAILED'] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

/** Estado del contenido transcrito/extraído, que va por detrás del estado del archivo: puede seguir pendiente con el archivo ya almacenado. */
export const EVIDENCE_CONTENT_STATUSES = ['PENDING', 'READY', 'FAILED', 'WAITING_EXTERNAL'] as const;
export type EvidenceContentStatus = (typeof EVIDENCE_CONTENT_STATUSES)[number];

/**
 * Tabla de tipos permitidos: extension, mimeType, kind, firmas hexadecimales iniciales.
 * Las firmas son la defensa real contra un `.png` que en realidad es un script:
 * el nombre y el mime los elige el cliente, los bytes no.
 */
export const ALLOWED_EVIDENCE_TYPES = [
  { extension: 'pdf', mimeType: 'application/pdf', kind: 'PDF', signatures: ['25504446'] },
  { extension: 'png', mimeType: 'image/png', kind: 'IMAGE', signatures: ['89504e47'] },
  { extension: 'jpg', mimeType: 'image/jpeg', kind: 'IMAGE', signatures: ['ffd8ff'] },
  { extension: 'jpeg', mimeType: 'image/jpeg', kind: 'IMAGE', signatures: ['ffd8ff'] },
  { extension: 'webp', mimeType: 'image/webp', kind: 'IMAGE', signatures: ['52494646'] },
  { extension: 'mp3', mimeType: 'audio/mpeg', kind: 'AUDIO', signatures: ['494433', 'fffb', 'fff3', 'fff2'] },
  { extension: 'wav', mimeType: 'audio/wav', kind: 'AUDIO', signatures: ['52494646'] },
  { extension: 'm4a', mimeType: 'audio/mp4', kind: 'AUDIO', signatures: ['000000'] },
  { extension: 'txt', mimeType: 'text/plain', kind: 'TEXT', signatures: [] },
  { extension: 'csv', mimeType: 'text/csv', kind: 'SPREADSHEET', signatures: [] },
  {
    extension: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'DOCUMENT',
    signatures: ['504b0304'],
  },
  {
    extension: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kind: 'SPREADSHEET',
    signatures: ['504b0304'],
  },
] as const;

export type EvidenceTypeRule = (typeof ALLOWED_EVIDENCE_TYPES)[number];

/**
 * mimes que algunos navegadores reportan en lugar del canónico de la tabla.
 * Sin esta tolerancia un `.m4a` grabado en Safari se rechazaría por un tecnicismo
 * del cliente, no por su contenido.
 */
const DECLARED_MIME_ALIASES: Record<string, readonly string[]> = {
  jpeg: ['image/jpg'],
  wav: ['audio/x-wav', 'audio/wave'],
  m4a: ['audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/mp4'],
  mp3: ['audio/mpeg3', 'audio/x-mpeg'],
  csv: ['text/plain'],
};

/** Mimes que no describen nada: se acepta la extensión y la verifican los bytes. */
const OPAQUE_DECLARED_MIME_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

const MAX_SAFE_FILENAME_CHARS = 120;

/**
 * Deja un nombre apto para construir una clave de storage: sin rutas, sin
 * traversal y sin acentos. Los acentos se eliminan porque una clave con
 * caracteres combinantes se rompe justo cuando hay que reconstruirla a mano
 * para diagnosticar una evidencia.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const withoutControlChars = base.replace(/[\u0000-\u001f\u007f]/g, '');
  const withoutAccents = withoutControlChars.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const collapsed = withoutAccents
    .replace(/\.{2,}/g, '_')
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._-]+/, '')
    .replace(/[._-]+$/, '');

  if (!collapsed || collapsed === '.') return 'evidencia';
  return truncatePreservingExtension(collapsed, MAX_SAFE_FILENAME_CHARS);
}

function truncatePreservingExtension(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const dotIndex = value.lastIndexOf('.');
  if (dotIndex <= 0) return value.slice(0, maxChars);
  const extension = value.slice(dotIndex);
  const stem = value.slice(0, Math.max(1, maxChars - extension.length));
  return `${stem}${extension}`;
}

export function getFileExtension(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const dotIndex = base.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === base.length - 1) return '';
  return base.slice(dotIndex + 1).toLowerCase();
}

function normalizeDeclaredMimeType(declaredMimeType: string): string {
  return (declaredMimeType ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * Resuelve la regla por extensión y confirma que el mime declarado no la
 * contradiga. Un mime que no encaja con la extensión es el mismo síntoma que un
 * archivo renombrado, así que se rechaza en vez de "corregir" en silencio.
 */
export function getEvidenceTypeRule(filename: string, declaredMimeType: string): EvidenceTypeRule | null {
  const extension = getFileExtension(filename);
  const rule = ALLOWED_EVIDENCE_TYPES.find((candidate) => candidate.extension === extension);
  if (!rule) return null;

  const declared = normalizeDeclaredMimeType(declaredMimeType);
  if (OPAQUE_DECLARED_MIME_TYPES.has(declared)) return rule;
  if (declared === rule.mimeType) return rule;
  if ((DECLARED_MIME_ALIASES[rule.extension] ?? []).includes(declared)) return rule;
  return null;
}

export function detectEvidenceKind(filename: string, declaredMimeType: string): EvidenceKind | null {
  return getEvidenceTypeRule(filename, declaredMimeType)?.kind ?? null;
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Una lista de firmas vacía significa "no hay firma que verificar": se acepta el mime declarado. */
function matchesSignature(hex: string, signatures: readonly string[]): boolean {
  if (signatures.length === 0) return true;
  return signatures.some((signature) => hex.startsWith(signature));
}

export function validateEvidenceFile(input: {
  filename: string;
  declaredMimeType: string;
  sizeBytes: number;
  firstBytes: Uint8Array;
}):
  | { ok: true; detectedMimeType: string; safeFilename: string; kind: EvidenceKind }
  | { ok: false; reason: string } {
  const { filename, declaredMimeType, sizeBytes, firstBytes } = input;

  if (!filename || !filename.trim()) {
    return { ok: false, reason: 'El archivo no tiene nombre: no hay forma de verificar su tipo.' };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, reason: 'El archivo está vacío (0 bytes): no hay evidencia que procesar.' };
  }
  if (sizeBytes > MAX_EVIDENCE_FILE_BYTES) {
    const limitMb = Math.floor(MAX_EVIDENCE_FILE_BYTES / (1024 * 1024));
    return { ok: false, reason: `El archivo supera el límite de ${limitMb} MB permitido por evidencia.` };
  }

  const rule = getEvidenceTypeRule(filename, declaredMimeType);
  if (!rule) {
    const extension = getFileExtension(filename) || '(sin extensión)';
    return {
      ok: false,
      reason: `Tipo de archivo no permitido: extensión "${extension}" con mime "${normalizeDeclaredMimeType(declaredMimeType) || '(sin mime)'}".`,
    };
  }

  const hex = toHex(firstBytes);
  if (!matchesSignature(hex, rule.signatures)) {
    return {
      ok: false,
      reason: `El contenido no corresponde a un archivo ${rule.extension.toUpperCase()}: la firma de los primeros bytes no coincide.`,
    };
  }

  return {
    ok: true,
    detectedMimeType: rule.mimeType,
    safeFilename: sanitizeFilename(filename),
    kind: rule.kind,
  };
}

/**
 * Clave de storage `auditId/evidenceId/archivo`. Cada segmento se sanea por
 * separado porque un identificador manipulado con `../` podría sacar la clave
 * del prefijo del caso y sobrescribir evidencia de otro.
 */
export function buildEvidenceStorageKey(input: {
  auditId: string;
  evidenceId: string;
  safeFilename: string;
}): string {
  const auditSegment = sanitizeStorageSegment(input.auditId, 'auditoria');
  const evidenceSegment = sanitizeStorageSegment(input.evidenceId, 'evidencia');
  const fileSegment = sanitizeFilename(input.safeFilename);
  return `${auditSegment}/${evidenceSegment}/${fileSegment}`;
}

function sanitizeStorageSegment(value: string, fallback: string): string {
  const segment = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '_');
  if (!segment || segment === '.' || segment === '..') return fallback;
  return segment;
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}
