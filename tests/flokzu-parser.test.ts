import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { parseFlokzuWorkbook } from '../src/server/flokzu-parser.js';

const headers = JSON.parse(readFileSync(new URL('./fixtures/flokzu-headers.json', import.meta.url), 'utf8')) as string[];

async function sampleWorkbook(rows: Array<Record<string, string>> = []): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('FLOKZU-CaVe-2026-10-12');
  sheet.addRow(['FLOKZU', null, null, '2026-10-12', 'fixture sintético', 'CaVe']);
  sheet.addRow(headers);
  for (const [index, values] of rows.entries()) {
    const row = new Array<string | null>(headers.length).fill(null);
    for (const [name, value] of Object.entries(values)) {
      const column = headers.indexOf(name);
      if (column >= 0) row[column] = value;
    }
    sheet.addRow(row);
    sheet.getRow(index + 3).commit();
  }
  const result = await workbook.xlsx.writeBuffer();
  return Buffer.from(result);
}

const row = (id: string, matrícula: string, task: string, date: string): Record<string, string> => ({
  Identificador: id,
  'Matricula (CaVe)': matrícula,
  'Nombre del estudiante (CaVe)': 'Estudiante sintético',
  'Campus (CaVe)': 'UTEL ECUADOR',
  'Programa (CaVe)': 'Programa de prueba',
  'Politica que aplica (CaVe)': '07 Alumno Ilocalizable',
  'Motivo (CaVe)': '99',
  'Fecha de ingreso (CaVe)': date,
  'Fecha de solicitud (CaVe)': '12/10/2026',
  'Fecha Inicio': '2026-10-12',
  'Tarea Actual': task,
  'Area del solicitante (CaVe)': 'Exito estudiantil',
  'Evidencia acceso al Aula (CaVe)': 'captura-referencial.pdf',
});

describe('parseFlokzuWorkbook', () => {
  it('lee encabezados de la fila 2, conserva matrículas como texto y normaliza 99 y fechas', async () => {
    const parsed = await parseFlokzuWorkbook(await sampleWorkbook([
      row('CaVe-31024', '000123456', '[BACKOFFICE] [REVISION BO] [CV]', '12/10/2026'),
      row('CaVe-31025', '000123456', '[HD] [REVISION REPLICA] [CV]', '01/11/2026'),
    ]));

    expect(parsed.headers).toHaveLength(92);
    expect(parsed.totalDataRows).toBe(2);
    expect(parsed.rows.map((item) => item.externalCaseId)).toEqual(['CaVe-31024', 'CaVe-31025']);
    expect(parsed.rows.map((item) => item.studentIdentifier)).toEqual(['000123456', '000123456']);
    expect(parsed.rows.map((item) => item.eligibleForAuditAssignment)).toEqual([true, false]);
    expect(parsed.rows[0]?.flokzuData.academic.entryDate).toBe('2026-10-12');
    expect(parsed.rows[0]?.flokzuData.academic.countryReported).toBe('Ecuador');
    expect(parsed.rows[1]?.flokzuData.academic.entryDate).toBe('2026-11-01');
    expect(parsed.rows[0]?.flokzuData.procedure.motive).toBeNull();
    expect(parsed.rows[0]?.flokzuData.evidenceReferences).toEqual([{ label: 'Evidencia de acceso al aula', value: 'captura-referencial.pdf' }]);
    expect(parsed.issues).toEqual([]);
  });

  it('marks repeated CaVe identifiers as row errors without merging repeated matrícula values', async () => {
    const parsed = await parseFlokzuWorkbook(await sampleWorkbook([
      row('CaVe-31024', '000123456', '[BACKOFFICE] [REVISION BO] [CV]', '12/10/2026'),
      row('CaVe-31024', '000123456', '[BACKOFFICE] [REVISION BO] [CV]', '12/10/2026'),
    ]));

    expect(parsed.rows).toEqual([]);
    expect(parsed.issues).toHaveLength(2);
    expect(parsed.issues.every((issue) => issue.message.includes('aparece más de una vez'))).toBe(true);
  });

  it('rejects a workbook missing a mandatory header and rejects non-XLSX bytes', async () => {
    const missingHeader = headers.filter((header) => header !== 'Matricula (CaVe)');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Flokzu');
    sheet.addRow(['FLOKZU', null, null, '2026-10-12']);
    sheet.addRow(missingHeader);
    sheet.addRow(['CaVe-31024']);
    await expect(parseFlokzuWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()))).rejects.toThrow('Falta la columna obligatoria');
    await expect(parseFlokzuWorkbook(Buffer.from('esto no es xlsx'))).rejects.toThrow('no es un libro XLSX válido');
  });
});
