import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import type { InsForgeClient } from '../../src/server/insforge';

/** PostgreSQL efímero; nunca usa credenciales ni un backend remoto. */
export async function dashboardPostgres(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE project_admin;
    CREATE TABLE cases(id uuid PRIMARY KEY,status text DEFAULT 'COMPLETED',student_identifier text,
      country text,channel text,campus text,modality text,project text,responsible text,guideline text,
      created_by uuid,is_test boolean DEFAULT false,assigned_to uuid,flokzu_data jsonb,external_case_id text,
      created_at timestamptz DEFAULT now(),merged_into_case_id uuid,cycle_start_date date);
    CREATE TABLE audits(id uuid PRIMARY KEY,case_id uuid REFERENCES cases(id),status text,
      model text,provider text,latency_ms bigint,error_category text,attempt_number integer DEFAULT 1,
      created_at timestamptz,result_json jsonb,provider_metadata jsonb,evidence_fingerprint text,retired_at timestamptz);
    CREATE TABLE evidence(id uuid PRIMARY KEY,case_id uuid REFERENCES cases(id),hash text,transcript_json jsonb);
    CREATE TABLE case_reviews(id uuid PRIMARY KEY,case_id uuid REFERENCES cases(id),audit_id uuid REFERENCES audits(id),
      result text,coordinator_decision text,coordinator_resolution text,coordinator_created_at timestamptz);
    CREATE TABLE case_comparisons(id uuid PRIMARY KEY,case_review_id uuid REFERENCES case_reviews(id),audit_id uuid REFERENCES audits(id),
      status text,result_json jsonb,provider text,model text,latency_ms bigint,error_category text,
      attempt_count integer DEFAULT 1,created_at timestamptz);
    CREATE TABLE case_area_comments(case_id uuid,area text,comment text);
    CREATE TABLE app_memberships(user_id uuid,role text);
  `);
  await db.exec(await readFile('migrations/20261013100000_dashboard-execution-evaluation-metrics.sql', 'utf8'));
  await db.exec(await readFile('migrations/20261015100000_dashboard-sales-channel-flokzu.sql', 'utf8'));
  return db;
}

/** Adaptador REST de solo lectura: los filtros de producción se ejecutan en SQL real. */
export function postgresDashboardClient(db: PGlite): InsForgeClient {
  const identifier = (value: string): string => {
    if (!/^[a-z_]+$/.test(value)) throw new Error('Identificador SQL inválido en el test');
    return `"${value}"`;
  };
  return { database: { from(table: string) {
    const where: string[] = [];
    const params: unknown[] = [];
    const orders: string[] = [];
    let columns = '*';
    const condition = (column: string, op: string, value: unknown) => {
      params.push(value); where.push(`${identifier(column)} ${op} $${params.length}`); return chain;
    };
    const chain = {
      select(value: string) { columns = value === '*' || value.startsWith('*,') ? '*' : value.split(',').map(column => identifier(column.trim())).join(','); return chain; },
      eq(column: string, value: unknown) { return condition(column, '=', value); },
      is(column: string, value: unknown) { where.push(`${identifier(column)} IS ${value === null ? 'NULL' : 'NOT NULL'}`); return chain; },
      in(column: string, values: unknown[]) {
        const slots = values.map(value => { params.push(value); return `$${params.length}`; });
        where.push(slots.length ? `${identifier(column)} IN (${slots.join(',')})` : 'FALSE'); return chain;
      },
      gte(column: string, value: unknown) { return condition(column, '>=', value); },
      lte(column: string, value: unknown) { return condition(column, '<=', value); },
      order(column: string, options: { ascending?: boolean }) { orders.push(`${identifier(column)} ${options.ascending ? 'ASC' : 'DESC'}`); return chain; },
      async range(from: number, to: number) {
        const result = await db.query(`SELECT ${columns} FROM ${identifier(table)} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ${orders.length ? `ORDER BY ${orders.join(',')}` : ''} LIMIT ${to - from + 1} OFFSET ${from}`, params);
        return { data: result.rows, error: null };
      },
      async limit(count: number) { return chain.range(0, count - 1); },
    };
    return chain;
  } } } as unknown as InsForgeClient;
}
