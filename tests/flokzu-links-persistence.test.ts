import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import { createFlokzuPreview } from '../src/server/flokzu-import';
import type { InsForgeClient } from '../src/server/insforge';
import { fakeAuthContext } from './helpers/auth';

async function workbook(url: string): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Flokzu');
  sheet.addRow(['FLOKZU']);
  sheet.addRow(['Identificador', 'Matricula (CaVe)', 'Nombre del estudiante (CaVe)', 'Evidencia acceso al Aula (CaVe)']);
  sheet.addRow(['CaVe-1', 'TEST-1', 'Estudiante sintético', { text: 'archivo.png', hyperlink: url }]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe('persistencia de referencias externas', () => {
  it('guarda la URL normalizada, detecta reimportación idéntica y actualiza el JSON sin tocar archivos ni auditorías', async () => {
    const existing: Array<Record<string, unknown>> = [];
    const batches: Array<Record<string, unknown>> = [];
    const tables: string[] = [];
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const client = { database: { rpc, from(table: string) {
      tables.push(table);
      const query = {
        select() { return query; }, eq() { return query; }, in() { return query; }, order() { return query; },
        insert(rows: Array<Record<string, unknown>>) { batches.push(...rows); return query; },
        single() { return Promise.resolve({ data: { id: `batch-${batches.length}` }, error: null }); },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: table === 'cases' ? existing : [], error: null }).then(resolve); },
      };
      return query;
    } } } as unknown as InsForgeClient;
    const first = await createFlokzuPreview(client, fakeAuthContext('coordinator'), await workbook('https://EXAMPLE.org/uno'));
    expect(first.newRows).toBe(1);
    const staged = (batches[0]!.staged_rows as Array<{ flokzuData: Record<string, unknown> }>)[0]!;
    expect(staged.flokzuData.evidenceReferences).toEqual([{ label: 'Evidencia de acceso al aula', value: 'archivo.png', url: 'https://example.org/uno' }]);
    existing.push({ id: 'case-1', external_case_id: 'CaVe-1', student_identifier: 'TEST-1', student_name: 'Estudiante sintético', flokzu_data: staged.flokzuData, assigned_to: 'advisor-a', created_by: 'importer' });
    const repeated = await createFlokzuPreview(client, fakeAuthContext('coordinator'), await workbook('https://example.org/uno'));
    expect(repeated.unchangedRows).toBe(1);
    expect(repeated.changedRows).toBe(0);
    const changed = await createFlokzuPreview(client, fakeAuthContext('coordinator'), await workbook('https://example.org/dos'));
    expect(changed.changedRows).toBe(1);
    const updated = (batches[2]!.staged_rows as Array<{ flokzuData: Record<string, unknown> }>)[0]!;
    expect(updated.flokzuData.evidenceReferences).toEqual([{ label: 'Evidencia de acceso al aula', value: 'archivo.png', url: 'https://example.org/dos' }]);
    expect(existing[0]).toMatchObject({ assigned_to: 'advisor-a', created_by: 'importer' });
    expect(tables).not.toContain('evidence');
    expect(tables).not.toContain('audits');
    expect(rpc.mock.calls.every(([name]) => name === 'expire_flokzu_import_previews')).toBe(true);
  });
});
