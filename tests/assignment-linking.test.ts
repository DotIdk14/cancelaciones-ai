import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const advisor = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const coordinator = '00000000-0000-4000-8000-000000000003';
const manager = '00000000-0000-4000-8000-000000000004';
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE project_admin;
    CREATE TABLE app_memberships(user_id uuid PRIMARY KEY,role text);
    CREATE TABLE cases(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),status text DEFAULT 'DRAFT',student_identifier text,student_name text,created_by uuid,
      is_test boolean DEFAULT false NOT NULL,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE audits(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid REFERENCES cases(id),status text,result_json jsonb,provider_metadata jsonb,created_at timestamptz DEFAULT now());
    CREATE TABLE evidence(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid REFERENCES cases(id),hash text,storage_path text,filename text);
    CREATE TABLE case_reviews(id uuid,case_id uuid,audit_id uuid,result text,coordinator_decision text,coordinator_resolution text);
    CREATE TABLE case_area_comments(case_id uuid,area text,comment text);
    INSERT INTO auth.users VALUES('${advisor}'),('${other}'),('${coordinator}'),('${manager}');
    INSERT INTO app_memberships VALUES('${advisor}','user'),('${other}','user'),('${coordinator}','coordinator'),('${manager}','manager');`);
  for (const filename of ['20261012100000_flokzu-case-import.sql','20261013103000_flokzu-administrative-review.sql','20261013120000_student-history-reconciliation.sql','20261014180000_case-assignment-and-linking.sql','20261014180100_manual-cave-reference-repair.sql','20261014180200_case-merge-history.sql','20261014180300_confirmed-case-consolidation.sql']) {
    await db.exec(await readFile('migrations/' + filename, 'utf8'));
  }
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => { await db.exec('TRUNCATE cases,case_import_batches CASCADE'); });
type Case = { id: string; assigned_to: string | null; created_by: string; external_case_id: string | null };
async function create(actor = advisor, mat = '000123', name = 'Estudiante sintético', request: string | null = null, cave: string | null = null, assigned: string | null = null) {
  return (await db.query<{ c: Case }>('SELECT create_assigned_case($1,$2,$3,$4,$5,$6,true) c', [actor,mat,name,request,cave,assigned])).rows[0]!.c;
}
const row = (cave = 'CaVe-123', mat = '000123') => ({ externalCaseId: cave, studentIdentifier: mat, studentName: 'Estudiante sintético', flokzuData: { operations: { currentTask: '[BACKOFFICE] [REVISION BO] [CV]' } }, classification: 'ACTIVE', classificationReason: 'Revisión BO', discrepancy: false, eligibleForAuditAssignment: true });
async function stage(rows = [row()]) {
  const matches = (await db.query<{ m: Record<string, unknown> }>('SELECT get_flokzu_manual_matches($1) m', [JSON.stringify(rows)])).rows[0]!.m;
  const staged = rows.map(r => ({ ...r, manualMatch: matches[r.externalCaseId] }));
  const batch = (await db.query<{id:string}>(`INSERT INTO case_import_batches(imported_by,total_rows,valid_rows,new_rows,changed_rows,unchanged_rows,error_rows,staged_rows)
    VALUES($1,$2,$2,$2,0,0,0,$3) RETURNING id`, [coordinator,rows.length,JSON.stringify(staged)])).rows[0]!.id;
  return { batch, matches };
}
async function commit(batch: string, resolutions: Array<{ externalCaseId: string; caseId: string | null }> = []) {
  return (await db.query<{ r: { created: number; linked: number } }>('SELECT commit_flokzu_import($1,$2,$3) r',[batch,coordinator,JSON.stringify(resolutions)])).rows[0]!.r;
}
describe('asignación y vinculación transaccional', () => {
  it('el Asesor conserva autor y responsable; Coordinación reparte por carga o elige', async () => {
    const first = await create();
    expect(first).toMatchObject({ assigned_to: advisor, created_by: advisor });
    expect((await create(coordinator,'000124')).assigned_to).toBe(other);
    expect((await create(coordinator,'000125',undefined,null,null,advisor)).assigned_to).toBe(advisor);
  });
  it('rechaza Gerentes, actores sin membership y responsables no elegibles', async () => {
    await expect(create(manager)).rejects.toThrow('Sin permiso');
    await expect(create(advisor,undefined,undefined,null,null,other)).rejects.toThrow('sí mismo');
    await expect(create(coordinator,undefined,undefined,null,null,manager)).rejects.toThrow('elegible');
  });
  it('reutiliza la solicitud persistida y rechaza identidad ajena o datos distintos', async () => {
    const key='00000000-0000-4000-8000-000000000099';
    const first=await create(advisor,undefined,undefined,key);
    expect((await create(advisor,undefined,undefined,key)).id).toBe(first.id);
    await expect(create(other,undefined,undefined,key)).rejects.toThrow('no encontrado');
    await expect(create(advisor,'otra',undefined,key)).rejects.toThrow('utilizada');
    expect((await db.query('SELECT id FROM cases')).rows).toHaveLength(1);
  });
  it('CaVe manual impide una segunda ficha al importar y conserva la asignación', async () => {
    const first=await create(advisor,undefined,undefined,null,'CaVe-123');
    const {batch}=await stage();
    expect(await commit(batch)).toMatchObject({created:0,linked:0});
    expect((await db.query<Case>('SELECT * FROM cases')).rows).toMatchObject([{id:first.id,assigned_to:advisor}]);
    await expect(create(other,undefined,undefined,null,'CaVe-123')).rejects.toThrow('unique');
  });
  it('vincula el único manual reciente y conserva ID, evidencias, dictámenes y autor', async () => {
    const first=await create();
    await db.query("INSERT INTO evidence(case_id,hash,storage_path) VALUES($1,'hash','original')",[first.id]);
    await db.query("INSERT INTO audits(case_id,status,result_json) VALUES($1,'COMPLETED','{\"immutable\":true}')",[first.id]);
    const before=(await db.query('SELECT * FROM audits')).rows;
    const {batch}=await stage();
    expect(await commit(batch)).toMatchObject({created:0,linked:1});
    expect(await commit(batch)).toMatchObject({created:0,linked:1});
    expect((await db.query<Case>('SELECT * FROM cases')).rows).toMatchObject([{id:first.id,assigned_to:advisor,created_by:advisor,external_case_id:'CaVe-123'}]);
    expect((await db.query('SELECT * FROM audits')).rows).toEqual(before);
    expect((await db.query('SELECT hash,storage_path,case_id FROM evidence')).rows).toEqual([{hash:'hash',storage_path:'original',case_id:first.id}]);
  });
  it('varios manuales exigen selección y una decisión explícita vincula solo uno', async () => {
    await create(); const second=await create();
    const {batch,matches}=await stage();
    expect(matches['CaVe-123']).toMatchObject({requiresSelection:true,linkCaseId:null});
    await expect(commit(batch)).rejects.toThrow('Selecciona');
    expect(await commit(batch,[{externalCaseId:'CaVe-123',caseId:second.id}])).toMatchObject({linked:1,created:0});
  });
  it('dos tickets de la misma matrícula no se unen automáticamente', async () => {
    await create(); const {batch,matches}=await stage([row(),row('CaVe-124')]);
    expect(Object.values(matches)).toEqual(expect.arrayContaining([expect.objectContaining({requiresSelection:true})]));
    await expect(commit(batch)).rejects.toThrow('Selecciona');
    expect(await commit(batch,[{externalCaseId:'CaVe-123',caseId:null},{externalCaseId:'CaVe-124',caseId:null}])).toMatchObject({created:2,linked:0});
  });
  it('una matrícula distinta o ceros diferentes no vinculan; un cambio tras preview falla cerrado', async () => {
    await create(advisor,'123');
    expect(await commit((await stage()).batch)).toMatchObject({created:1,linked:0});
    await db.exec('TRUNCATE cases,case_import_batches CASCADE');
    await create(); const {batch}=await stage(); await create();
    await expect(commit(batch)).rejects.toThrow('coincidencias cambiaron');
    expect((await db.query("SELECT * FROM cases WHERE external_source='FLOKZU'")).rows).toHaveLength(0);
  });
  it('ni nombre diferente ni manual antiguo se vinculan sin selección', async () => {
    await create(advisor,undefined,'Otra persona');
    expect((await stage()).matches['CaVe-123']).toMatchObject({requiresSelection:true});
    await db.exec("UPDATE cases SET student_name='Estudiante sintético',created_at=now()-interval '30 days'");
    expect((await stage()).matches['CaVe-123']).toMatchObject({requiresSelection:true});
  });
  it('los RPC no son ejecutables por navegador', async () => {
    expect((await db.query<{allowed:boolean}>("SELECT has_function_privilege('authenticated','get_flokzu_manual_matches(jsonb)','EXECUTE') allowed")).rows[0]!.allowed).toBe(false);
  });
  it('las inserciones del servidor desplegado también asignan al creador', async () => {
    const inserted=(await db.query<Case>("INSERT INTO cases(student_identifier,created_by) VALUES('legacy',$1) RETURNING *",[advisor])).rows[0]!;
    expect(inserted.assigned_to).toBe(advisor);
  });
  it('rechaza un manual creado después del Excel salvo confirmación de otra solicitud', async () => {
    await create(coordinator,undefined,undefined,null,'CaVe-123');
    await expect(db.query('SELECT create_assigned_case($1,$2,$3)',[advisor,'000123','Estudiante sintético'])).rejects.toThrow('Ya existe');
    expect((await create()).assigned_to).toBe(advisor);
  });
  it('consolida una ficha importada vacía conservando el manual y el historial', async () => {
    const manual=await create();
    await db.query("INSERT INTO evidence(case_id,hash,storage_path) VALUES($1,'hash','original')",[manual.id]);
    const imported=await create(coordinator,undefined,undefined,null,'CaVe-123');
    const before=(await db.query('SELECT * FROM evidence')).rows;
    await db.query('SELECT merge_empty_flokzu_shell($1,$2,$3)',[manual.id,imported.id,'Consolidación de prueba autorizada']);
    expect((await db.query('SELECT * FROM evidence')).rows).toEqual(before);
    const primary=(await db.query<Case>('SELECT * FROM cases WHERE id=$1',[manual.id])).rows[0]!;
    expect(primary).toMatchObject({external_case_id:'CaVe-123',assigned_to:advisor,created_by:advisor});
    expect((await db.query<{merged_into_case_id:string}>('SELECT merged_into_case_id FROM cases WHERE id=$1',[imported.id])).rows[0]!.merged_into_case_id).toBe(manual.id);
    expect((await db.query('SELECT * FROM case_merge_events')).rows).toHaveLength(1);
    await expect(db.query('SELECT assign_manual_case($1,$2,$3)',[imported.id,other,coordinator])).rejects.toThrow('no encontrado');
  });
  it('no consolida un importado con evidencia ni cuando hay más solicitudes del estudiante', async () => {
    const manual=await create(); const imported=await create(coordinator,undefined,undefined,null,'CaVe-123');
    await db.query("INSERT INTO evidence(case_id,hash,storage_path) VALUES($1,'hash','original')",[imported.id]);
    await expect(db.query('SELECT merge_empty_flokzu_shell($1,$2,$3)',[manual.id,imported.id,'Consolidación de prueba autorizada'])).rejects.toThrow('inequívoco');
    expect((await db.query('SELECT * FROM case_merge_events')).rows).toHaveLength(0);
  });
  it('solo completa un CaVe con referencia inequívoca del archivo original', async () => {
    const manual=await create();
    await expect(db.query('SELECT link_manual_cave_reference($1,$2,$3)',[manual.id,'CaVe-987','Referencia sintética verificada'])).rejects.toThrow('inequívoca');
    await db.query("INSERT INTO evidence(case_id,hash,storage_path,filename) VALUES($1,'hash','original','Solicitud CaVe-987.pdf')",[manual.id]);
    const before=(await db.query('SELECT * FROM evidence')).rows;
    await db.query('SELECT link_manual_cave_reference($1,$2,$3)',[manual.id,'CaVe-987','Referencia sintética verificada']);
    expect((await db.query<Case>('SELECT * FROM cases WHERE id=$1',[manual.id])).rows[0]!.external_case_id).toBe('CaVe-987');
    expect((await db.query('SELECT * FROM evidence')).rows).toEqual(before);
  });
  it('consolida manuales confirmados sin trasladar archivos ni retirar el dictamen', async () => {
    const primary=await create(advisor,undefined,undefined,null,'CaVe-987');
    const secondary=await create(other);
    await db.query("INSERT INTO evidence(case_id,hash,storage_path) VALUES($1,'hash-1','original-1'),($2,'hash-2','original-2')",[primary.id,secondary.id]);
    await db.query("INSERT INTO audits(case_id,status,result_json) VALUES($1,'COMPLETED','{\"immutable\":true}')",[primary.id]);
    const files=(await db.query('SELECT * FROM evidence')).rows, audits=(await db.query('SELECT * FROM audits')).rows;
    await db.query('SELECT consolidate_confirmed_cases($1,$2,$3)',[primary.id,secondary.id,'Misma solicitud confirmada por el propietario']);
    expect((await db.query('SELECT * FROM evidence')).rows).toEqual(files);
    expect((await db.query('SELECT * FROM audits')).rows).toEqual(audits);
    const history=(await db.query<{data:{uniqueRequests:number;totalEvidence:number;totalCases:number}}>('SELECT student_case_history($1,$2) data',[primary.id,coordinator])).rows[0]!.data;
    expect(history).toMatchObject({uniqueRequests:1,totalEvidence:2,totalCases:2});
    const preflight=(await db.query<{data:{blocked:boolean;primaryId:string}}>('SELECT audit_relation_preflight($1) data',[secondary.id])).rows[0]!.data;
    expect(preflight).toEqual({blocked:true,primaryId:primary.id});
  });
});
