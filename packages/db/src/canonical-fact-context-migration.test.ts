import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('canonical fact context migration', () => {
  it('declara tablas canónicas, provenance JSONB y contexto temporal sin borrar legacy', () => {
    const sql = readFileSync(resolve(process.cwd(), '../../migrations/20260927120000_canonical_fact_context.sql'), 'utf8');

    expect(sql).toContain('create table if not exists public.canonical_fact_runs');
    expect(sql).toContain('create table if not exists public.canonical_fact_candidates');
    expect(sql).toContain('create table if not exists public.canonical_facts');
    expect(sql).toContain('create table if not exists public.audit_temporal_context');
    expect(sql).toContain('provenance jsonb not null');
    expect(sql).toContain('extraction_confidence numeric');
    expect(sql).toContain("state text not null check (state in ('KNOWN','UNKNOWN','NOT_APPLICABLE','CONTRADICTED'))");
    expect(sql).not.toMatch(/drop\s+table\s+.*facts/i);
  });
});
