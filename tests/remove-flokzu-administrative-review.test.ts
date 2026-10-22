import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  await db.query("INSERT INTO cases(id,student_identifier,student_name,created_by,assigned_to,external_source,external_case_id,flokzu_data,flokzu_audit_eligible) VALUES($1,'000000001','Estudiante sintético',$2,$3,'FLOKZU','CaVe-101','{}',false)", ['00000000-0000-4000-8000-000000000010',coordinator,advisor]);
  await db.exec(`INSERT INTO evidence(case_id,hash,storage_path) VALUES('00000000-0000-4000-8000-000000000010','original-hash','original/path');
    INSERT INTO audits(case_id,status,result_json) VALUES('00000000-0000-4000-8000-000000000010','COMPLETED','{"preserved":true}');`);
  await db.exec(await readFile('migrations/20261022163849_remove-flokzu-administrative-review.sql', 'utf8'));
}, 30000);

afterAll(async () => { await db?.close(); });
describe('retiro del flujo administrativo Excel', () => {
  it('retira tablas, columnas y RPC antiguos conservando expediente, originales y dictamen', async () => {
    expect((await db.query("SELECT to_regclass('public.case_import_batches') batches,to_regclass('public.flokzu_admin_events') events")).rows[0]).toEqual({ batches: null, events: null });
    const data = (await db.query<Record<string,unknown>>("SELECT * FROM cases WHERE external_case_id='CaVe-101'")).rows[0]!;
    expect(data.assigned_to).toBe(advisor);
    expect(data.created_by).toBe(coordinator);
    expect(data).not.toHaveProperty('flokzu_audit_eligible');
    expect((await db.query('SELECT hash,storage_path FROM evidence')).rows).toEqual([{hash:'original-hash',storage_path:'original/path'}]);
    expect((await db.query('SELECT result_json FROM audits')).rows).toEqual([{result_json:{preserved:true}}]);
  });
  it('reasigna un CaVe con la capacidad administrativa normal y valida roles y responsable', async () => {
    const id = '00000000-0000-4000-8000-000000000010';
    await expect(db.query('SELECT assign_case($1,$2,$3)',[id,other,advisor])).rejects.toThrow('Sin permiso');
    await expect(db.query('SELECT assign_case($1,$2,$3)',[id,manager,coordinator])).rejects.toThrow('elegible');
    await db.query('SELECT assign_case($1,$2,$3)',[id,other,coordinator]);
    expect((await db.query('SELECT assigned_to FROM cases WHERE id=$1',[id])).rows[0]).toEqual({assigned_to:other});
  });
  it('la creación y el reparto siguen funcionando sin columnas de revisión Flokzu', async () => {
    const result=await db.query<{c:{assigned_to:string}}>("SELECT create_assigned_case($1,'000000002','Estudiante dos',NULL,'CaVe-102',NULL,true) c",[coordinator]);
    expect([advisor,other]).toContain(result.rows[0]!.c.assigned_to);
  });
});
