import { describe, expect, it } from 'vitest';
import {
  buildEvidenceStorageKey,
  detectEvidenceKind,
  getEvidenceTypeRule,
  MAX_EVIDENCE_FILE_BYTES,
  sanitizeFilename,
  sha256Hex,
  validateEvidenceFile,
} from './evidence';

function bytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
}

const PNG_REAL = bytes('89504e470d0a1a0a0000000d49484452');
const PDF_REAL = bytes('255044462d312e370a25e2e3cfd30a');
const SCRIPT_RENOMBRADO = bytes('4d5a9000030000000400');

describe('validateEvidenceFile', () => {
  it('acepta un PNG real y devuelve el mime detectado por los bytes', () => {
    const resultado = validateEvidenceFile({
      filename: 'Captura de Pantalla.PNG',
      declaredMimeType: 'image/png',
      sizeBytes: 2048,
      firstBytes: PNG_REAL,
    });

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.detectedMimeType).toBe('image/png');
      expect(resultado.kind).toBe('IMAGE');
      expect(resultado.safeFilename).toBe('captura_de_pantalla.png');
    }
  });

  it('rechaza un .png cuyos bytes no corresponden a una imagen', () => {
    const resultado = validateEvidenceFile({
      filename: 'evidencia.png',
      declaredMimeType: 'image/png',
      sizeBytes: 2048,
      firstBytes: SCRIPT_RENOMBRADO,
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.reason).toContain('no corresponde');
    }
  });

  it('rechaza una extensión que no está en la tabla de tipos permitidos', () => {
    const resultado = validateEvidenceFile({
      filename: 'inventario.exe',
      declaredMimeType: 'application/x-msdownload',
      sizeBytes: 2048,
      firstBytes: SCRIPT_RENOMBRADO,
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.reason).toContain('no permitido');
    }
  });

  it('rechaza cuando la extensión y el mime declarado se contradicen', () => {
    expect(getEvidenceTypeRule('contrato.pdf', 'image/png')).toBeNull();
    expect(getEvidenceTypeRule('contrato.pdf', 'application/pdf')).not.toBeNull();
  });

  it('rechaza un archivo vacío y uno por encima del límite', () => {
    const vacio = validateEvidenceFile({
      filename: 'contrato.pdf',
      declaredMimeType: 'application/pdf',
      sizeBytes: 0,
      firstBytes: PDF_REAL,
    });
    expect(vacio.ok).toBe(false);
    if (!vacio.ok) expect(vacio.reason).toContain('vacío');

    const excedido = validateEvidenceFile({
      filename: 'contrato.pdf',
      declaredMimeType: 'application/pdf',
      sizeBytes: MAX_EVIDENCE_FILE_BYTES + 1,
      firstBytes: PDF_REAL,
    });
    expect(excedido.ok).toBe(false);
    if (!excedido.ok) expect(excedido.reason).toContain('límite');
  });
});

describe('sanitizeFilename', () => {
  it('neutraliza el recorrido de directorios y deja solo el nombre final', () => {
    const seguro = sanitizeFilename('../../etc/passwd');
    expect(seguro).toBe('passwd');
    expect(seguro).not.toContain('/');
    expect(seguro).not.toContain('..');
  });

  it('elimina acentos y caracteres no portables sin perder la extensión', () => {
    expect(sanitizeFilename('Acta de Ingreso Ñandú.pdf')).toBe('acta_de_ingreso_nandu.pdf');
    expect(sanitizeFilename('C:\\Users\\Ana Pérez\\contrato final.pdf')).toBe('contrato_final.pdf');
  });

  it('devuelve un nombre utilizable cuando la entrada se queda sin caracteres válidos', () => {
    expect(sanitizeFilename('   ')).toBe('evidencia');
  });
});

describe('detectEvidenceKind', () => {
  it('clasifica pdf, audio, hoja de cálculo y documento', () => {
    expect(detectEvidenceKind('procedimiento.pdf', 'application/pdf')).toBe('PDF');
    expect(detectEvidenceKind('entrevista.mp3', 'audio/mpeg')).toBe('AUDIO');
    expect(detectEvidenceKind('listado.csv', 'text/csv')).toBe('SPREADSHEET');
    expect(detectEvidenceKind('acta.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(
      'DOCUMENT',
    );
    expect(detectEvidenceKind('desconocido.bin', 'application/octet-stream')).toBeNull();
  });
});

describe('buildEvidenceStorageKey', () => {
  it('arma una clave por caso y evidencia sin permitir escapes del prefijo', () => {
    const clave = buildEvidenceStorageKey({
      auditId: 'audit_1',
      evidenceId: 'ev_1',
      safeFilename: sanitizeFilename('Carta de Desistimiento.pdf'),
    });

    expect(clave).toBe('audit_1/ev_1/carta_de_desistimiento.pdf');
    expect(clave).not.toContain('..');
  });

  it('sanea un identificador manipulado en vez de confiar en él', () => {
    const clave = buildEvidenceStorageKey({
      auditId: '../../otra_carpeta',
      evidenceId: 'ev_2',
      safeFilename: 'documento.pdf',
    });

    expect(clave).not.toContain('..');
    expect(clave.split('/')).toHaveLength(3);
    expect(clave.split('/')[1]).toBe('ev_2');
  });
});

describe('sha256Hex', () => {
  it('produce el hash conocido de una cadena vacía', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
