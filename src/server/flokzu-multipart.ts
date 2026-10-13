import { ApiError } from './errors.js';

export interface UploadedXlsx {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

export function parseSingleXlsxMultipart(contentType: string, body: Buffer): UploadedXlsx {
  const boundaryMatch = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary || boundary.length > 70 || /[\r\n]/.test(boundary)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'La carga multipart no tiene un separador válido.');
  }
  const marker = Buffer.from(`--${boundary}`, 'ascii');
  const first = body.indexOf(marker);
  if (first !== 0) throw new ApiError(400, 'VALIDATION_ERROR', 'La carga multipart está mal formada.');
  const next = body.indexOf(marker, first + marker.length);
  if (next < 0 || body.indexOf(marker, next + marker.length) !== -1) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Sube exactamente un archivo Excel.');
  }
  const partStart = first + marker.length + 2;
  const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), partStart);
  if (headerEnd < 0 || headerEnd > next) throw new ApiError(400, 'VALIDATION_ERROR', 'La carga multipart está mal formada.');
  const headerText = body.subarray(partStart, headerEnd).toString('latin1');
  const disposition = /^content-disposition:\s*form-data;\s*name="file";\s*filename="([^"]*)"\s*$/im.exec(headerText);
  if (!disposition) throw new ApiError(400, 'VALIDATION_ERROR', 'El formulario debe contener un campo “file”.');
  const mimeMatch = /^content-type:\s*([^\r\n]+)$/im.exec(headerText);
  const mimeType = mimeMatch?.[1]?.trim().toLowerCase() ?? '';
  const filename = disposition[1] ?? '';
  const extension = filename.split(/[\\/]/).at(-1)?.toLowerCase().endsWith('.xlsx') ?? false;
  if (!extension || !['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'].includes(mimeType)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Selecciona un archivo .xlsx válido.');
  }
  const contentEnd = next - 2;
  const buffer = body.subarray(headerEnd + 4, contentEnd);
  if (buffer.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'El archivo Excel está vacío.');
  return { filename: filename.split(/[\\/]/).at(-1) ?? 'archivo.xlsx', mimeType, buffer };
}
