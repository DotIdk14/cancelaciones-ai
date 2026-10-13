import { createHash } from 'node:crypto';
import { prepareFlokzuContext, normalizeAdministrativeText, usefulAdministrativeText, type FlokzuObservation } from '../lib/flokzu-administrative.js';
import ExcelJS from 'exceljs';
import { ApiError } from './errors.js';

export const FLOKZU_MAX_FILE_BYTES = 4 * 1024 * 1024;
export const FLOKZU_MAX_ROWS = 2_000;
const MAX_COLUMNS = 150;
const MAX_CELL_CHARS = 8_000;
const MAX_ZIP_ENTRIES = 300;
const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;

export interface FlokzuEvidenceReference {
  label: string;
  value: string;
}

export interface FlokzuCaseData {
  externalCaseId: string;
  studentIdentifier: string;
  studentName: string;
  academic: {
    campus: string | null;
    university: string | null;
    countryReported: string | null;
    program: string | null;
    level: string | null;
    block: string | null;
    programKey: string | null;
    entryDate: string | null;
  };
  procedure: {
    policyReported: string | null;
    motive: string | null;
    description: string | null;
    requestDate: string | null;
    administrativeStartDate: string | null;
  };
  operations: {
    currentTask: string | null;
    statusReported: string | null;
    finalizedReported: string | null;
    reviewerReported: string | null;
    supervisorReported: string | null;
    requesterReported: string | null;
    requesterArea: string | null;
  };
  observations?: FlokzuObservation[];
  evidenceReferences: FlokzuEvidenceReference[];
}

export interface FlokzuRowIssue {
  rowNumber: number;
  externalCaseId: string | null;
  message: string;
}

export interface ParsedFlokzuRow {
  rowNumber: number;
  externalCaseId: string;
  studentIdentifier: string;
  studentName: string;
  flokzuData: Omit<FlokzuCaseData, 'externalCaseId' | 'studentIdentifier' | 'studentName'>;
  eligibleForAuditAssignment: boolean;
}

export interface ParsedFlokzuWorkbook {
  metadata: { source: string | null; exportedAt: string | null };
  headers: string[];
  rows: ParsedFlokzuRow[];
  issues: FlokzuRowIssue[];
  totalDataRows: number;
}

const REQUIRED_HEADERS = [
  { key: 'identifier', aliases: ['identificador'] },
  { key: 'studentIdentifier', aliases: ['matricula (cave)', 'matrícula (cave)'] },
  { key: 'studentName', aliases: ['nombre del estudiante (cave)'] },
] as const;

const OPTIONAL_HEADER_ALIASES = {
  backOffice: ['comentario de backoffice (cave)'],
  helpDesk: ['comentarios helpdesk (cave)'],
  helpDeskComplement: ['complementario de helpdesk (cave)'],
  studentMessage: ['mensaje al estudiante (cave)'],
  campus: ['campus (cave)'],
  university: ['universidad. (cave)', 'universidad (cave)'],
  program: ['programa (cave)'],
  level: ['nivel (cave)'],
  block: ['bloque (cave)'],
  programKey: ['clave de programa (cave)'],
  entryDate: ['fecha de ingreso (cave)'],
  policy: ['politica que aplica (cave)', 'política que aplica (cave)'],
  motive: ['motivo (cave)'],
  description: ['descripcion (cave)', 'descripción (cave)'],
  requestDate: ['fecha de solicitud (cave)'],
  administrativeStartDate: ['fecha inicio'],
  currentTask: ['tarea actual'],
  status: ['estado (cave)'],
  finalized: ['finalizado'],
  reviewer: ['agente revisor cv (cave)'],
  supervisor: ['supervisor (cave)'],
  requester: ['iniciador'],
  requesterArea: ['area del solicitante (cave)', 'área del solicitante (cave)'],
} as const;

const EVIDENCE_HEADERS = [
  ['Evidencia de acceso al aula', ['evidencia acceso al aula (cave)']],
  ['Evidencia de documentos', ['evidencia de documentos (cave)']],
  ['Evidencia de intentos de contactación', ['evidencia de intentos de contactacion (cave)']],
  ['Evidencia de no calificación', ['evidencia de no calificacion (cave)']],
  ['Evidencia de no continuar', ['evidencia de no continuar (cave)']],
  ['Evidencia de seguimiento', ['evidencia de seguimiento (cave)']],
  ['Evidencia de fecha de inicio', ['evidencia fecha de inicio (cave)']],
  ['Evidencia de pago en SIU', ['evidencia pago en siu (cave)']],
  ['Evidencia UVE', ['evidencia uve. (cave)']],
  ['Registro de contacto', ['registro de contacto (cave)']],
  ['Llamada de asesor de ventas', ['llamada asesor de ventas (cave)']],
  ['Llamada de tutor', ['llamada tutor (cave)']],
  ['Tipo de evidencias', ['tipo de evidencias (cave)']],
] as const;

/** Normalización deliberadamente acotada a los encabezados conocidos de Flokzu. */
export function normalizeFlokzuHeader(value: string): string {
  return value
    .replace(/\uFFFD/g, 'o')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('es-MX')
    .replace(/[\t\r\n ]+/g, ' ');
}

function isMissing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' || trimmed === '99';
  }
  return typeof value === 'number' && value === 99;
}

function cellText(value: ExcelJS.CellValue): string | null {
  if (isMissing(value)) return null;
  if (typeof value === 'string') {
    if (value.length > MAX_CELL_CHARS) throw new Error('El valor de una celda supera el tamaño permitido.');
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object' && 'richText' in value) {
    const text = value.richText.map((part) => part.text).join('').trim();
    if (text.length > MAX_CELL_CHARS) throw new Error('El valor de una celda supera el tamaño permitido.');
    return isMissing(text) ? null : text;
  }
  if (value !== null && typeof value === 'object' && 'formula' in value) throw new Error('No se permiten fórmulas en las columnas importadas.');
  if (value !== null && typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text.trim() || null;
  throw new Error('El tipo de dato de una celda no es compatible.');
}

function parseDate(value: ExcelJS.CellValue): string | null {
  if (isMissing(value)) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 100_000) {
    const milliseconds = Math.round((value - 25_569) * 86_400_000);
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return null;
  const input = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(input);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(input);
  const parts = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : dmy
      ? [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])]
      : null;
  if (!parts) return null;
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function explicitCountryFromCampus(campus: string | null): string | null {
  const normalized = normalizeFlokzuHeader(campus ?? '');
  const match = /^utel (ecuador|colombia|dominicana|peru|argentina|espana)$/.exec(normalized);
  if (!match) return null;
  const country: Record<string, string> = {
    ecuador: 'Ecuador',
    colombia: 'Colombia',
    dominicana: 'República Dominicana',
    peru: 'Perú',
    argentina: 'Argentina',
    espana: 'España',
  };
  return country[match[1]!] ?? null;
}

function getColumnIndex(headers: string[], aliases: readonly string[]): number | null {
  const normalizedAliases = new Set(aliases.map(normalizeFlokzuHeader));
  const matches = headers.flatMap((header, index) => normalizedAliases.has(normalizeFlokzuHeader(header)) ? [index] : []);
  if (matches.length > 1) throw new ApiError(400, 'VALIDATION_ERROR', 'El archivo contiene encabezados ambiguos para un campo conocido.');
  return matches[0] ?? null;
}

function zipDirectoryLimits(buffer: Buffer): void {
  if (buffer.length < 22 || buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'El archivo no es un libro XLSX válido.');
  }
  const min = Math.max(0, buffer.length - 65_557);
  const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocd = buffer.lastIndexOf(eocdSignature);
  if (eocd < min || eocd + 22 > buffer.length) throw new ApiError(400, 'VALIDATION_ERROR', 'El archivo XLSX está incompleto o mal formado.');
  const disk = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entries === 0 || entries > MAX_ZIP_ENTRIES || centralSize > 2_000_000 || centralOffset + centralSize > eocd) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'El archivo XLSX tiene una estructura fuera de los límites permitidos.');
  }
  let cursor = centralOffset;
  let totalExpanded = 0;
  const paths = new Set<string>();
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > eocd || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new ApiError(400, 'VALIDATION_ERROR', 'El archivo XLSX tiene un índice ZIP inválido.');
    const flags = buffer.readUInt16LE(cursor + 8);
    const compressed = buffer.readUInt32LE(cursor + 20);
    const expanded = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if ((flags & 1) !== 0 || name.startsWith('/') || name.includes('..') || paths.has(name)) throw new ApiError(400, 'VALIDATION_ERROR', 'El archivo XLSX contiene entradas ZIP no permitidas.');
    paths.add(name);
    totalExpanded += expanded;
    if (totalExpanded > MAX_UNCOMPRESSED_BYTES || expanded > MAX_UNCOMPRESSED_BYTES || (compressed === 0 && expanded > 0) || (compressed > 0 && expanded / compressed > 100)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'El archivo XLSX excede los límites de descompresión permitidos.');
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (!paths.has('[Content_Types].xml') || !paths.has('xl/workbook.xml')) throw new ApiError(400, 'VALIDATION_ERROR', 'El archivo no contiene la estructura de un libro XLSX.');
}

export async function parseFlokzuWorkbook(buffer: Buffer): Promise<ParsedFlokzuWorkbook> {
  if (buffer.length === 0 || buffer.length > FLOKZU_MAX_FILE_BYTES) throw new ApiError(413, 'VALIDATION_ERROR', 'El archivo debe pesar como máximo 4 MB.');
  zipDirectoryLimits(buffer);
  let workbook: ExcelJS.Workbook;
  try {
    workbook = new ExcelJS.Workbook();
    const excelBuffer = buffer as unknown as Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(excelBuffer, { ignoreNodes: ['drawing', 'picture', 'table', 'conditionalFormatting', 'extLst'] });
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'No se pudo leer el libro XLSX. Verifica que no esté dañado o protegido con contraseña.');
  }
  if (workbook.worksheets.length !== 1) throw new ApiError(400, 'VALIDATION_ERROR', 'El archivo debe tener una sola hoja de exportación.');
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.columnCount > MAX_COLUMNS || sheet.rowCount > FLOKZU_MAX_ROWS + 2) throw new ApiError(400, 'VALIDATION_ERROR', 'El archivo supera el máximo de 150 columnas o 2,000 tickets.');
  const metadataValues = sheet.getRow(1).values as ExcelJS.CellValue[];
  const metadataSource = cellText(metadataValues[1] ?? null);
  if (metadataSource?.toLocaleUpperCase('en-US') !== 'FLOKZU') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'La primera fila no identifica una exportación de Flokzu.');
  }
  const headerValues = sheet.getRow(2).values as ExcelJS.CellValue[];
  const headers: string[] = [];
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    headers.push(cellText(headerValues[column] ?? null) ?? '');
  }
  if (headers.filter(Boolean).length < 3) throw new ApiError(400, 'VALIDATION_ERROR', 'No se encontraron encabezados de exportación en la segunda fila.');
  const indexes = new Map<string, number | null>();
  for (const required of REQUIRED_HEADERS) {
    const column = getColumnIndex(headers, required.aliases);
    if (column === null) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Falta la columna obligatoria “${required.aliases[0]}”.`);
    }
    indexes.set(required.key, column);
  }

  for (const [key, aliases] of Object.entries(OPTIONAL_HEADER_ALIASES)) indexes.set(key, getColumnIndex(headers, aliases));
  for (const [label, aliases] of EVIDENCE_HEADERS) indexes.set(`evidence:${label}`, getColumnIndex(headers, aliases));
  const requiredIndex = (key: string): number => indexes.get(key) ?? -1;
  const readText = (row: ExcelJS.Row, key: string): string | null => {
    const index = requiredIndex(key);
    if (index < 0) return null;
    return cellText(row.getCell(index + 1).value);
  };
  const readDate = (row: ExcelJS.Row, key: string, fieldLabel: string): string | null => {
    const index = requiredIndex(key);
    if (index < 0 || isMissing(row.getCell(index + 1).value)) return null;
    const parsed = parseDate(row.getCell(index + 1).value);
    if (!parsed) throw new Error(`La fecha de “${fieldLabel}” no tiene un formato válido.`);
    return parsed;
  };

  const rows: ParsedFlokzuRow[] = [];
  const issues: FlokzuRowIssue[] = [];
  const seenIds = new Map<string, number>();
  let totalDataRows = 0;
  for (let rowNumber = 3; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (Array.from({ length: sheet.columnCount }, (_, index) => row.getCell(index + 1).value).every((value) => isMissing(value))) continue;
    totalDataRows += 1;
    let externalCaseId: string | null = null;
    try {
      const rawId = readText(row, 'identifier');
      if (!rawId || !/^cave-\d{1,16}$/i.test(rawId)) throw new Error('El identificador debe tener el formato CaVe-<número>.');
      externalCaseId = `CaVe-${rawId.slice(rawId.indexOf('-') + 1)}`;
      const previousRow = seenIds.get(externalCaseId);
      if (previousRow !== undefined) {
        issues.push({ rowNumber: previousRow, externalCaseId, message: 'El identificador aparece más de una vez en el archivo.' });
        issues.push({ rowNumber, externalCaseId, message: 'El identificador aparece más de una vez en el archivo.' });
        continue;
      }
      seenIds.set(externalCaseId, rowNumber);
      const studentIdentifier = readText(row, 'studentIdentifier');
      if (!studentIdentifier) throw new Error('Falta la matrícula del estudiante.');
      const studentName = readText(row, 'studentName');
      if (!studentName) throw new Error('Falta el nombre del estudiante.');
      if (studentIdentifier.length > 100 || studentName.length > 200) throw new Error('La matrícula o el nombre exceden el tamaño permitido.');
      const evidenceReferences = EVIDENCE_HEADERS.flatMap(([label]) => {
        const value = readText(row, `evidence:${label}`);
        return value ? [{ label, value }] : [];
      });
      const campus = readText(row, 'campus');
      const flokzuData: ParsedFlokzuRow['flokzuData'] = {
        academic: {
          campus,
          university: readText(row, 'university'),
          countryReported: explicitCountryFromCampus(campus),
          program: readText(row, 'program'),
          level: readText(row, 'level'),
          block: readText(row, 'block'),
          programKey: readText(row, 'programKey'),
          entryDate: readDate(row, 'entryDate', 'Fecha de ingreso'),
        },
        procedure: {
          policyReported: readText(row, 'policy'),
          motive: readText(row, 'motive'),
          description: readText(row, 'description'),
          requestDate: readDate(row, 'requestDate', 'Fecha de solicitud'),
          administrativeStartDate: readDate(row, 'administrativeStartDate', 'Fecha Inicio'),
        },
        operations: {
          currentTask: readText(row, 'currentTask'),
          statusReported: readText(row, 'status'),
          finalizedReported: readText(row, 'finalized'),
          reviewerReported: readText(row, 'reviewer'),
          supervisorReported: readText(row, 'supervisor'),
          requesterReported: readText(row, 'requester'),
          requesterArea: readText(row, 'requesterArea'),
        },
        observations: (['backOffice', 'helpDesk', 'helpDeskComplement', 'description', 'studentMessage'] as const).flatMap((field) => {
          if (requiredIndex(field) < 0) return [];
          const raw = row.getCell(requiredIndex(field) + 1).value;
          const validated = readText(row, field);
          const original = typeof raw === 'string' && validated ? raw : validated;
          if (!original) return [];
          const text = normalizeAdministrativeText(original);
          if (!usefulAdministrativeText(text)) return [];
          return [{ field, original, text, externalCaseId: `CaVe-${rawId.slice(rawId.indexOf('-') + 1)}`, area: field === 'backOffice' ? 'BACK_OFFICE' as const : field.startsWith('helpDesk') ? 'HELPDESK' as const : 'ADMINISTRATIVE' as const, exportedAt: cellText(metadataValues[4] ?? null), version: createHash('sha256').update(text).digest('hex') }];
        }),
        evidenceReferences,
      };
      const currentTask = normalizeFlokzuHeader(flokzuData.operations.currentTask ?? '');
      rows.push({
        rowNumber,
        externalCaseId,
        studentIdentifier,
        studentName,
        flokzuData,
        // Routing observed in the supplied export: only current CaVe back-office review enters the audit queue.
        eligibleForAuditAssignment: currentTask === '[backoffice] [revision bo] [cv]' && prepareFlokzuContext(flokzuData).automaticEligible,
      });
    } catch (error) {
      issues.push({ rowNumber, externalCaseId, message: error instanceof Error ? error.message : 'La fila no tiene una estructura válida.' });
    }
  }
  for (const [id, rowNumber] of seenIds) {
    if (issues.some((issue) => issue.externalCaseId === id && issue.message.includes('más de una vez'))) {
      const index = rows.findIndex((row) => row.externalCaseId === id);
      if (index >= 0) rows.splice(index, 1);
      if (!issues.some((issue) => issue.rowNumber === rowNumber && issue.externalCaseId === id)) {
        issues.push({ rowNumber, externalCaseId: id, message: 'El identificador aparece más de una vez en el archivo.' });
      }
    }
  }
  if (totalDataRows === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'El archivo no contiene tickets debajo de los encabezados.');
  const exportedAt = cellText(metadataValues[4] ?? null);
  return { metadata: { source: metadataSource, exportedAt }, headers, rows, issues, totalDataRows };
}

export function syncedCaseFields(row: ParsedFlokzuRow): Record<string, unknown> {
  return {
    studentIdentifier: row.studentIdentifier,
    studentName: row.studentName,
    flokzuData: row.flokzuData,
  };
}
